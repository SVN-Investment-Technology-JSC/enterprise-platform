import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SYSTEM_REQUEST_TYPES } from '../infrastructure/hrm-request-types';
import { HrmRequestTypeController } from './hrm-request-type.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const ACTOR = '00000000-0000-4000-8000-0000000000bb';
const MANAGE = ['hrm.read', 'hrm.leave.manage'];
const READ_ONLY = ['hrm.read'];
const req = { headers: {} } as Request;

interface TypeRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  description: string | null;
  engine: string;
  time_mode: string;
  requires_attachment: boolean;
  fields: unknown[];
  icon: string | null;
  is_system: boolean;
  active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function createFake() {
  const rows: TypeRow[] = [];
  const usage = new Map<string, number>();
  const reasonsSoftDeleted: string[] = [];
  const runningLinks = new Map<string, number>();
  const bindingsDeactivated: { kind: string; subType: string | null }[] = [];
  const audit: { action: string; entityId: string; detail: any }[] = [];
  let seq = 0;
  let clock = 0;
  const live = (r: TypeRow) => r.deleted_at === null;
  const view = (r: TypeRow) => ({ ...r, usage_count: usage.get(r.id) ?? 0 });
  const stamp = () => new Date(Date.UTC(2026, 9, 1, 0, 0, ++clock));

  const add = (over: Partial<TypeRow> & { code: string; name: string }): TypeRow => {
    const row: TypeRow = {
      id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
      tenant_id: TENANT,
      description: null,
      engine: 'GENERIC',
      time_mode: 'RANGE_DATETIME',
      requires_attachment: false,
      fields: [],
      icon: null,
      is_system: false,
      active: true,
      sort_order: 10,
      created_at: stamp(),
      updated_at: stamp(),
      deleted_at: null,
      ...over,
    };
    rows.push(row);
    return row;
  };

  const query = jest.fn(async (rawSql: string, params: any[] = []) => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    const result = (found: unknown[]) => ({ rows: found, rowCount: found.length });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: null };
    if (sql.startsWith('INSERT INTO hrm_schema.audit_log')) {
      audit.push({ action: params[2], entityId: params[3], detail: JSON.parse(params[4]) });
      return result([]);
    }
    if (sql.startsWith('SELECT count(*)::int AS n FROM hrm_schema.request_reason_categories')) {
      return result([{ n: rows.filter((r) => r.is_system && r.tenant_id === params[0]).length }]);
    }
    if (sql.startsWith('INSERT INTO hrm_schema.request_reason_categories') && sql.includes('unnest(')) {
      const [tenant, codes, names, descriptions, engines, modes, sorts] = params as [
        string, string[], string[], string[], string[], string[], number[],
      ];
      const created = codes
        .map((code, i) => ({ code, i }))
        .filter(({ code }) => !rows.some((r) => live(r) && r.tenant_id === tenant && r.code.toUpperCase() === code))
        .map(({ code, i }) =>
          add({
            code,
            name: names[i],
            description: descriptions[i],
            engine: engines[i],
            time_mode: modes[i],
            is_system: true,
            sort_order: sorts[i],
          }),
        );
      return result(created.map((r) => ({ id: r.id })));
    }
    if (sql.startsWith('INSERT INTO hrm_schema.request_reason_categories')) {
      const [tenant, code, name, description, timeMode, requiresAttachment, fields, icon, active, sortOrder] = params;
      const max = Math.max(0, ...rows.filter(live).map((r) => r.sort_order));
      const row = add({
        tenant_id: tenant,
        code,
        name,
        description,
        time_mode: timeMode,
        requires_attachment: requiresAttachment,
        fields: JSON.parse(fields),
        icon,
        active,
        sort_order: sortOrder ?? max + 10,
      });
      return result([{ id: row.id }]);
    }
    if (sql.startsWith('SELECT upper(code) AS code FROM hrm_schema.request_reason_categories')) {
      return result(rows.filter((r) => r.tenant_id === params[0]).map((r) => ({ code: r.code.toUpperCase() })));
    }
    if (sql.startsWith('SELECT 1 FROM hrm_schema.request_reason_categories')) {
      const [tenant, name, exceptId] = params;
      return result(
        rows.filter(
          (r) => live(r) && r.tenant_id === tenant && r.name.toLowerCase() === String(name).toLowerCase() && r.id !== exceptId,
        ),
      );
    }
    if (sql.startsWith('SELECT c.* FROM hrm_schema.request_reason_categories c')) {
      return result(
        rows
          .filter((r) => live(r) && r.tenant_id === params[0] && r.active)
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
      );
    }
    if (sql.startsWith('SELECT c.*,')) {
      if (sql.includes('c.id = $2'))
        return result(rows.filter((r) => live(r) && r.tenant_id === params[0] && r.id === params[1]).map(view));
      return result(
        rows
          .filter((r) => live(r) && r.tenant_id === params[0])
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
          .map(view),
      );
    }
    if (sql.startsWith('UPDATE hrm_schema.request_reason_categories')) {
      const row = rows.find((r) => r.tenant_id === params[0] && r.id === params[1]);
      if (!row) return result([]);
      if (sql.includes('deleted_at = now()')) {
        row.deleted_at = new Date();
        row.active = false;
      } else if (sql.includes('SET active = false')) {
        row.active = false;
        row.updated_at = stamp();
      } else if (sql.includes('name = COALESCE($3, name)')) {
        const [, , name, descSet, description, mode, attach, fields, iconSet, icon, active, sort] = params;
        if (name !== null) row.name = name;
        if (descSet) row.description = description;
        if (mode !== null) row.time_mode = mode;
        if (attach !== null) row.requires_attachment = attach;
        if (fields !== null) row.fields = JSON.parse(fields);
        if (iconSet) row.icon = icon;
        if (active !== null) row.active = active;
        if (sort !== null) row.sort_order = sort;
        row.updated_at = stamp();
      } else throw new Error(`UPDATE không nhận diện được: ${sql}`);
      return result([{ id: row.id }]);
    }
    if (sql.startsWith("SELECT to_regclass('hrm_schema.procedure_links')")) return result([{ ok: true }]);
    if (sql.startsWith('SELECT count(*)::int AS n FROM hrm_schema.procedure_links'))
      return result([{ n: runningLinks.get(params[1]) ?? 0 }]);
    if (sql.startsWith('UPDATE hrm_schema.request_procedure_bindings')) {
      bindingsDeactivated.push({ kind: params[1], subType: params[2] });
      return result([]);
    }
    if (sql.startsWith('UPDATE hrm_schema.request_reasons SET deleted_at = now()')) {
      reasonsSoftDeleted.push(params[1]);
      return result([]);
    }
    throw new Error(`SQL không nhận diện được: ${sql}`);
  });

  const client = { query, release: jest.fn() };
  const pool = { connect: jest.fn(async () => client), query };
  return { rows, usage, reasonsSoftDeleted, runningLinks, bindingsDeactivated, audit, add, pool, live: () => rows.filter(live) };
}

function build(permissions: string[] = MANAGE) {
  const fake = createFake();
  const ctx = {
    getContext: jest.fn(async (_request: Request, required = 'hrm.read') => {
      if (!permissions.includes(required) && !permissions.includes('hrm.manage'))
        throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
      return { pool: fake.pool, tenantId: TENANT, principal: { userId: ACTOR, permissions } };
    }),
  };
  const controller = Object.create(HrmRequestTypeController.prototype) as HrmRequestTypeController;
  Object.assign(controller, { ctx });
  return { controller, ctx, fake };
}

describe('HrmRequestTypeController: danh sách', () => {
  it('lần đọc đầu tạo đủ 7 loại hệ thống; chỉ trả loại đang bật theo thứ tự hiển thị', async () => {
    const { controller, fake } = build(READ_ONLY);
    const result = await controller.list(req);
    expect(result.data.map((t) => t.code)).toEqual(SYSTEM_REQUEST_TYPES.map((t) => t.code));
    expect(result.data.every((t) => t.isSystem)).toBe(true);
    expect(result.data.find((t) => t.code === 'OVERTIME')).toMatchObject({ engine: 'OVERTIME', kind: 'ot' });
    expect(fake.live()).toHaveLength(7);
    // Gọi lại không tạo trùng.
    await controller.list(req);
    expect(fake.live()).toHaveLength(7);
  });

  it('loại đã ngừng không hiện ở danh sách người làm đơn nhưng hiện ở danh sách quản trị', async () => {
    const { controller, fake } = build();
    const custom = fake.add({ code: 'DE_XUAT', name: 'Đề xuất', active: false, sort_order: 80 });
    expect((await controller.list(req)).data.map((t) => t.id)).not.toContain(custom.id);
    const manage = await controller.listForManage(req);
    expect(manage.data.find((t) => t.id === custom.id)).toMatchObject({ active: false, usageCount: 0 });
  });

  it('danh sách quản trị cần hrm.leave.manage; đọc thường chỉ cần hrm.read', async () => {
    const { controller, ctx } = build(READ_ONLY);
    await expect(controller.listForManage(req)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.list(req)).resolves.toBeDefined();
    expect(ctx.getContext).toHaveBeenLastCalledWith(req, 'hrm.read');
  });
});

describe('HrmRequestTypeController: tạo loại đơn', () => {
  it('tạo loại GENERIC: mã tự sinh từ tên, mặc định RANGE_DATETIME, ghi audit', async () => {
    const { controller, fake } = build();
    const result = await controller.create(req, {
      name: 'Xin xác nhận công tác',
      fields: [{ key: 'noi_nhan', label: 'Nơi nhận', type: 'text', required: true }],
      requiresAttachment: true,
    });
    expect(result.data).toMatchObject({
      code: 'XIN_XAC_NHAN_CONG_TAC',
      engine: 'GENERIC',
      kind: 'custom',
      timeMode: 'RANGE_DATETIME',
      requiresAttachment: true,
      isSystem: false,
      active: true,
      usageCount: 0,
    });
    expect(result.data.fields).toHaveLength(1);
    expect(fake.audit.map((a) => a.action)).toEqual(['REQUEST_TYPE_CREATED']);
    // Loại hệ thống đã được tạo kèm theo; loại mới xếp sau cùng.
    expect(fake.live()).toHaveLength(8);
    expect(result.data.sortOrder).toBeGreaterThan(70);
  });

  it('mã sinh từ tên trùng mã loại hệ thống hoặc loại có sẵn thì thêm hậu tố', async () => {
    const { controller } = build();
    const a = await controller.create(req, { name: 'Leave' });
    expect(a.data.code).toBe('LEAVE_2');
    const b = await controller.create(req, { name: 'Đề xuất' });
    const c = await controller.create(req, { name: 'đề xuất ' }).catch((e) => e);
    // Trùng tên (không phân biệt hoa thường) bị từ chối trước khi tới mã.
    expect(c).toBeInstanceOf(ConflictException);
    expect(b.data.code).toBe('DE_XUAT');
  });

  it('mã nhập tay: chuyển chữ hoa, từ chối mã loại hệ thống hoặc đã có, sai định dạng', async () => {
    const { controller } = build();
    const ok = await controller.create(req, { name: 'Loại A', code: 'loai_a' });
    expect(ok.data.code).toBe('LOAI_A');
    await expect(controller.create(req, { name: 'Loại B', code: 'LOAI_A' })).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.create(req, { name: 'Loại C', code: 'overtime' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.create(req, { name: 'Loại D', code: '1x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('thiếu tên, kiểu dữ liệu sai, trường động sai: 400; thiếu quyền: 403', async () => {
    const { controller } = build();
    await expect(controller.create(req, {} as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(req, { name: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(req, { name: 'A', timeMode: 'HOURS' as never })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.create(req, { name: 'A', requiresAttachment: 'yes' as never })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.create(req, { name: 'A', fields: [{ key: 'X', label: 'x', type: 'text' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(req, null as never)).rejects.toBeInstanceOf(BadRequestException);
    const readOnly = build(READ_ONLY);
    await expect(readOnly.controller.create(req, { name: 'Được không' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('HrmRequestTypeController: sửa loại đơn', () => {
  it('loại tự tạo: đổi tên, thời gian, chứng từ, trường động, thứ tự; ghi audit trước và sau', async () => {
    const { controller, fake } = build();
    const created = await controller.create(req, { name: 'Đề xuất' });
    const result = await controller.update(req, created.data.id, {
      expectedUpdatedAt: created.data.updatedAt,
      name: 'Đề xuất mua sắm',
      timeMode: 'SINGLE_DATE',
      requiresAttachment: true,
      fields: [{ key: 'gia_tri', label: 'Giá trị', type: 'number' }],
      sortOrder: 5,
      active: false,
    });
    expect(result.data).toMatchObject({
      name: 'Đề xuất mua sắm',
      timeMode: 'SINGLE_DATE',
      requiresAttachment: true,
      sortOrder: 5,
      active: false,
      code: 'DE_XUAT',
    });
    const entry = fake.audit.find((a) => a.action === 'REQUEST_TYPE_UPDATED');
    expect(entry?.detail.before.name).toBe('Đề xuất');
    expect(entry?.detail.after.name).toBe('Đề xuất mua sắm');
  });

  it('loại hệ thống chỉ đổi tên, mô tả, thứ tự, biểu tượng, bật/tắt; không đổi thời gian, chứng từ, trường', async () => {
    const { controller } = build();
    const list = await controller.listForManage(req);
    const ot = list.data.find((t) => t.code === 'OVERTIME')!;
    const renamed = await controller.update(req, ot.id, {
      expectedUpdatedAt: ot.updatedAt,
      name: 'Tăng ca',
      description: 'Đăng ký tăng ca',
      icon: 'clock',
    });
    expect(renamed.data).toMatchObject({ name: 'Tăng ca', description: 'Đăng ký tăng ca', icon: 'clock', engine: 'OVERTIME' });
    for (const patch of [{ timeMode: 'NONE' as const }, { requiresAttachment: true }, { fields: [] }])
      await expect(
        controller.update(req, ot.id, { expectedUpdatedAt: renamed.data.updatedAt, ...patch }),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('không ngừng được loại Nghỉ phép; loại hệ thống khác ngừng được', async () => {
    const { controller } = build();
    const list = await controller.listForManage(req);
    const leave = list.data.find((t) => t.code === 'LEAVE')!;
    await expect(
      controller.update(req, leave.id, { expectedUpdatedAt: leave.updatedAt, active: false }),
    ).rejects.toBeInstanceOf(ConflictException);
    const advance = list.data.find((t) => t.code === 'ADVANCE')!;
    const off = await controller.update(req, advance.id, { expectedUpdatedAt: advance.updatedAt, active: false });
    expect(off.data.active).toBe(false);
  });

  it('không đổi mã; gửi lại đúng mã cũ thì bỏ qua; sai phiên bản: 409; thiếu expectedUpdatedAt: 400', async () => {
    const { controller } = build();
    const created = await controller.create(req, { name: 'Đề xuất' });
    await expect(
      controller.update(req, created.data.id, { expectedUpdatedAt: created.data.updatedAt, code: 'KHAC' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const ok = await controller.update(req, created.data.id, {
      expectedUpdatedAt: created.data.updatedAt,
      code: 'de_xuat',
      name: 'Đề xuất 2',
    });
    expect(ok.data.name).toBe('Đề xuất 2');
    await expect(
      controller.update(req, created.data.id, { expectedUpdatedAt: created.data.updatedAt, name: 'Cũ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.update(req, created.data.id, { name: 'Thiếu' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('đổi tên trùng loại khác: 409; không tìm thấy hoặc id sai: 404 và 400', async () => {
    const { controller } = build();
    const a = await controller.create(req, { name: 'A' });
    const b = await controller.create(req, { name: 'B' });
    await expect(
      controller.update(req, b.data.id, { expectedUpdatedAt: b.data.updatedAt, name: 'a' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(a.data.id).not.toBe(b.data.id);
    await expect(
      controller.update(req, '00000000-0000-4000-8000-00000000ffff', { expectedUpdatedAt: '2026-10-01T00:00:00Z', name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.update(req, 'abc', { name: 'X' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HrmRequestTypeController: xoá mềm loại đơn', () => {
  const off = async (controller: HrmRequestTypeController, id: string) => {
    const list = await controller.listForManage(req);
    const row = list.data.find((t) => t.id === id)!;
    await controller.update(req, id, { expectedUpdatedAt: row.updatedAt, active: false });
  };

  it('loại tự tạo đã ngừng: xoá mềm loại và lý do, gỡ liên kết quy trình theo mã loại, ghi audit', async () => {
    const { controller, fake } = build();
    const created = await controller.create(req, { name: 'Đề xuất' });
    await off(controller, created.data.id);
    const result = await controller.remove(req, created.data.id);
    expect(result.data).toMatchObject({ id: created.data.id, deleted: true, usageCount: 0 });
    expect(result.message).toMatch(/Đã xoá loại đơn/);
    expect(fake.reasonsSoftDeleted).toEqual(['DE_XUAT']);
    expect(fake.bindingsDeactivated).toEqual([{ kind: 'custom', subType: 'DE_XUAT' }]);
    expect(fake.audit.map((a) => a.action)).toContain('REQUEST_TYPE_DELETED');
    await expect(controller.remove(req, created.data.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('loại đang sử dụng thì phải ngừng trước khi xoá', async () => {
    const { controller, fake } = build();
    const created = await controller.create(req, { name: 'Đề xuất' });
    await expect(controller.remove(req, created.data.id)).rejects.toBeInstanceOf(ConflictException);
    expect(fake.reasonsSoftDeleted).toEqual([]);
  });

  it('đã có đơn vẫn xoá mềm được và giữ nguyên các đơn đã tạo', async () => {
    const { controller, fake } = build();
    const created = await controller.create(req, { name: 'Đề xuất' });
    fake.usage.set(created.data.id, 3);
    await off(controller, created.data.id);
    const result = await controller.remove(req, created.data.id);
    expect(result.data).toMatchObject({ deleted: true, usageCount: 3 });
    expect(result.message).toMatch(/3 đơn đã tạo vẫn được giữ nguyên/);
    expect(fake.live().some((r) => r.id === created.data.id)).toBe(false);
  });

  it('loại hệ thống đã ngừng cũng xoá mềm được, gỡ liên kết quy trình theo kind của engine và không bị tạo lại', async () => {
    const { controller, fake } = build();
    const list = await controller.listForManage(req);
    const ot = list.data.find((t) => t.code === 'OVERTIME')!;
    await off(controller, ot.id);
    const result = await controller.remove(req, ot.id);
    expect(result.data).toMatchObject({ deleted: true });
    expect(fake.bindingsDeactivated).toEqual([{ kind: 'ot', subType: null }]);
    expect(fake.audit.find((a) => a.action === 'REQUEST_TYPE_DELETED')?.detail.system).toBe(true);
    // Mở lại danh sách không sinh lại loại đã xoá.
    const again = await controller.listForManage(req);
    expect(again.data.some((t) => t.code === 'OVERTIME')).toBe(false);
    expect(again.data).toHaveLength(SYSTEM_REQUEST_TYPES.length - 1);
  });

  it('loại hệ thống còn đơn đang chạy quy trình thì chưa xoá được', async () => {
    const { controller, fake } = build();
    const list = await controller.listForManage(req);
    const advance = list.data.find((t) => t.code === 'ADVANCE')!;
    await off(controller, advance.id);
    fake.runningLinks.set('advance', 2);
    await expect(controller.remove(req, advance.id)).rejects.toThrow(/2 đơn đang chạy quy trình/);
    expect(fake.live().some((r) => r.id === advance.id)).toBe(true);
  });

  it('Nghỉ phép không ngừng được nên cũng không xoá được', async () => {
    const { controller } = build();
    const list = await controller.listForManage(req);
    await expect(controller.remove(req, list.data.find((t) => t.code === 'LEAVE')!.id)).rejects.toBeInstanceOf(ConflictException);
  });
});
