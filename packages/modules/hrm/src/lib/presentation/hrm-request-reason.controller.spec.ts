import 'reflect-metadata';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { DEFAULT_REQUEST_REASONS, REQUEST_REASON_KINDS } from '../infrastructure/hrm-request-reason';
import { HrmRequestReasonController } from './hrm-request-reason.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const ACTOR = '00000000-0000-4000-8000-0000000000bb';
const MANAGE = ['hrm.read', 'hrm.leave.manage'];
const READ_ONLY = ['hrm.read'];
const req = { headers: {} } as Request;

interface ReasonRow {
  id: string;
  tenant_id: string;
  kind: string;
  code: string | null;
  name: string;
  description: string | null;
  paid: boolean;
  requires_description: boolean;
  active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * Bảng request_reasons và audit_log giả lập trong bộ nhớ: đủ để chạy controller qua đúng các câu SQL của nó.
 * Gặp câu SQL lạ thì ném lỗi để test báo ngay khi controller đổi truy vấn.
 */
function createFake() {
  const rows: ReasonRow[] = [];
  const usage = new Map<string, number>();
  const audit: { action: string; entityType: string; entityId: string; actorId: string; detail: any }[] = [];
  const sqls: string[] = [];
  let seq = 0;
  let nextInsertError: { code: string } | undefined;
  const live = (r: ReasonRow) => r.deleted_at === null;
  const view = (r: ReasonRow) => ({ ...r, usage_count: usage.get(r.id) ?? 0 });

  const seed = (over: Partial<ReasonRow> & { kind: string; name: string }): ReasonRow => {
    const row: ReasonRow = {
      id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
      tenant_id: TENANT,
      code: over.name.toUpperCase().replace(/\s+/g, '_'),
      description: null,
      paid: true,
      requires_description: false,
      active: true,
      sort_order: 10,
      created_at: new Date('2026-10-01T00:00:00Z'),
      updated_at: new Date('2026-10-01T00:00:00Z'),
      deleted_at: null,
      ...over,
    };
    rows.push(row);
    return row;
  };

  const query = jest.fn(async (rawSql: string, params: any[] = []) => {
    const sql = rawSql.replace(/\s+/g, ' ').trim();
    sqls.push(sql);
    const result = (found: unknown[]) => ({ rows: found, rowCount: found.length });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: null };
    if (sql.startsWith('INSERT INTO hrm_schema.audit_log')) {
      audit.push({
        actorId: params[1],
        action: params[2],
        entityType: params[3],
        entityId: params[4],
        detail: JSON.parse(params[5]),
      });
      return result([]);
    }
    if (sql.startsWith('SELECT 1 FROM hrm_schema.request_reasons')) {
      return result(rows.filter((r) => live(r) && r.tenant_id === params[0] && r.kind === params[1]).slice(0, 1));
    }
    if (sql.startsWith('SELECT id FROM hrm_schema.request_reasons') && sql.includes('lower(name) = lower($3)')) {
      const [tenant, kind, name, except] = params;
      return result(
        rows.filter(
          (r) =>
            live(r) &&
            r.tenant_id === tenant &&
            r.kind === kind &&
            r.name.toLowerCase() === String(name).toLowerCase() &&
            r.id !== except,
        ),
      );
    }
    if (sql.startsWith('SELECT upper(code) AS code FROM hrm_schema.request_reasons')) {
      return result(
        rows
          .filter((r) => r.tenant_id === params[0] && r.kind === params[1] && r.code !== null)
          .map((r) => ({ code: r.code!.toUpperCase() })),
      );
    }
    if (sql.startsWith('INSERT INTO hrm_schema.request_reasons')) {
      if (sql.includes('unnest(')) {
        const [tenant, kind, codes, names, descriptions, requires, sorts] = params as [
          string,
          string,
          string[],
          string[],
          string[],
          boolean[],
          number[],
        ];
        const created = codes
          .map((code, i) => ({ code, i }))
          .filter(({ code }) => !rows.some((r) => live(r) && r.tenant_id === tenant && r.kind === kind && r.code === code))
          .map(({ code, i }) =>
            seed({
              kind,
              code,
              name: names[i],
              description: descriptions[i],
              requires_description: requires[i],
              sort_order: sorts[i],
            }),
          );
        return result(created.map((r) => ({ id: r.id })));
      }
      if (nextInsertError) {
        const error = Object.assign(new Error('duplicate key'), nextInsertError);
        nextInsertError = undefined;
        throw error;
      }
      const [tenant, kind, code, name, description, paid, requiresDescription, active, sortOrder] = params;
      const maxSort = Math.max(0, ...rows.filter((r) => live(r) && r.kind === kind).map((r) => r.sort_order));
      const row = seed({
        tenant_id: tenant,
        kind,
        code,
        name,
        description,
        paid,
        requires_description: requiresDescription,
        active,
        sort_order: sortOrder ?? maxSort + 10,
      });
      return result([{ id: row.id }]);
    }
    if (sql.startsWith('SELECT r.*')) {
      if (sql.includes('r.kind = ANY($2::text[])')) {
        const [tenant, kinds, active] = params;
        return result(
          rows
            .filter(
              (r) =>
                live(r) && r.tenant_id === tenant && kinds.includes(r.kind) && (active === null || r.active === active),
            )
            .sort((a, b) => a.kind.localeCompare(b.kind) || a.sort_order - b.sort_order || a.name.localeCompare(b.name))
            .map(view),
        );
      }
      if (sql.includes('r.id = $2')) {
        return result(rows.filter((r) => live(r) && r.tenant_id === params[0] && r.id === params[1]).map(view));
      }
    }
    if (sql.startsWith('UPDATE hrm_schema.request_reasons')) {
      const row = rows.find((r) => r.tenant_id === params[0] && r.id === params[1]);
      if (!row) return result([]);
      if (sql.includes('deleted_at = now()')) {
        row.deleted_at = new Date();
        row.active = false;
      } else if (sql.includes('name = COALESCE($3, name)')) {
        const [, , name, descriptionSet, description, paid, requires, active, sort] = params;
        if (name !== null) row.name = name;
        if (descriptionSet) row.description = description;
        if (paid !== null) row.paid = paid;
        if (requires !== null) row.requires_description = requires;
        if (active !== null) row.active = active;
        if (sort !== null) row.sort_order = sort;
        row.updated_at = new Date('2026-10-02T00:00:00Z');
      } else if (sql.includes('SET active = false')) {
        row.active = false;
      } else {
        throw new Error(`UPDATE không nhận diện được: ${sql}`);
      }
      return result([{ id: row.id }]);
    }
    throw new Error(`SQL không nhận diện được: ${sql}`);
  });

  const client = { query, release: jest.fn() };
  const pool = { connect: jest.fn(async () => client), query };
  return {
    rows,
    audit,
    sqls,
    usage,
    seed,
    pool,
    client,
    failNextInsert: (code: string) => {
      nextInsertError = { code };
    },
    live: () => rows.filter(live),
  };
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
  const controller = Object.create(HrmRequestReasonController.prototype) as HrmRequestReasonController;
  Object.assign(controller, { ctx });
  return { controller, ctx, fake };
}

describe('HrmRequestReasonController: định tuyến và quyền', () => {
  it('chỉ có CRUD lý do và tạo mặc định; không còn loại đơn động hay loại OT', () => {
    const prefix = Reflect.getMetadata(PATH_METADATA, HrmRequestReasonController) as string;
    const routes = Object.getOwnPropertyNames(HrmRequestReasonController.prototype)
      .map((key) => Object.getOwnPropertyDescriptor(HrmRequestReasonController.prototype, key)?.value)
      .filter((fn) => typeof fn === 'function' && Reflect.getMetadata(METHOD_METADATA, fn) !== undefined)
      .map(
        (fn) =>
          `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn) as number]} ${prefix}/${Reflect.getMetadata(PATH_METADATA, fn)}`,
      )
      .sort();
    expect(routes).toEqual(
      [
        'DELETE v1/request-reasons/:id',
        'GET v1/request-reasons',
        'PATCH v1/request-reasons/:id',
        'POST v1/request-reasons',
        'POST v1/request-reasons/defaults',
      ].sort(),
    );
  });

  it('đọc cần hrm.read; mọi thao tác ghi cần hrm.leave.manage', async () => {
    const { controller, ctx, fake } = build(READ_ONLY);
    const row = fake.seed({ kind: 'OVERTIME', name: 'Theo yêu cầu' });
    await expect(controller.list(req)).resolves.toMatchObject({ data: [{ id: row.id }] });
    expect(ctx.getContext).toHaveBeenLastCalledWith(req, 'hrm.read');
    await expect(controller.create(req, { kind: 'OVERTIME', name: 'Mới' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.update(req, row.id, { name: 'Đổi' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.remove(req, row.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.createDefaults(req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(fake.live()).toHaveLength(1);
    expect(fake.live()[0].name).toBe('Theo yêu cầu');
    expect(fake.audit).toEqual([]);

    const manager = build(MANAGE);
    await manager.controller.create(req, { kind: 'OVERTIME', name: 'Mới' });
    expect(manager.ctx.getContext).toHaveBeenLastCalledWith(req, 'hrm.leave.manage');
  });
});

describe('HrmRequestReasonController: danh sách', () => {
  it('lọc theo loại đơn và trạng thái, sắp theo thứ tự rồi tên, kèm số đơn đã dùng', async () => {
    const { controller, fake } = build();
    const b = fake.seed({ kind: 'BUSINESS_TRIP', name: 'B', sort_order: 20 });
    const a = fake.seed({ kind: 'BUSINESS_TRIP', name: 'A', sort_order: 20 });
    const first = fake.seed({ kind: 'BUSINESS_TRIP', name: 'Z', sort_order: 10 });
    const off = fake.seed({ kind: 'BUSINESS_TRIP', name: 'Ngừng', sort_order: 5, active: false });
    fake.seed({ kind: 'OVERTIME', name: 'OT' });
    fake.seed({ kind: 'BUSINESS_TRIP', name: 'Đã xóa', deleted_at: new Date() });
    fake.usage.set(first.id, 3);

    const all = await controller.list(req, 'BUSINESS_TRIP');
    expect(all.data.map((r) => r.id)).toEqual([off.id, first.id, a.id, b.id]);
    expect(all.data.find((r) => r.id === first.id)?.usageCount).toBe(3);
    expect(all.meta.total).toBe(4);

    const active = await controller.list(req, 'BUSINESS_TRIP', 'true');
    expect(active.data.map((r) => r.id)).toEqual([first.id, a.id, b.id]);
    const inactive = await controller.list(req, 'BUSINESS_TRIP', 'false');
    expect(inactive.data.map((r) => r.id)).toEqual([off.id]);
    // Không truyền loại đơn: trả cả 4 loại đơn cố định.
    expect((await controller.list(req)).data).toHaveLength(5);
  });

  it('loại đơn hoặc bộ lọc active không hợp lệ: 400', async () => {
    const { controller } = build();
    for (const kind of ['OT_TYPE', 'TRIP_TYPE', 'LEAVE', 'overtime'])
      await expect(controller.list(req, kind)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(req, 'OVERTIME', 'maybe')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HrmRequestReasonController: tạo lý do', () => {
  it('mã tự sinh từ tên (in hoa, không dấu, gạch dưới) và ghi audit', async () => {
    const { controller, fake } = build();
    const { data } = await controller.create(req, {
      kind: 'ATTENDANCE_CORRECTION',
      name: '  Lỗi thiết bị hoặc mạng  ',
      description: 'Không chấm được do lỗi thiết bị',
    });
    expect(data).toMatchObject({
      tenantId: TENANT,
      kind: 'ATTENDANCE_CORRECTION',
      code: 'LOI_THIET_BI_HOAC_MANG',
      name: 'Lỗi thiết bị hoặc mạng',
      description: 'Không chấm được do lỗi thiết bị',
      paid: true,
      requiresDescription: false,
      active: true,
      usageCount: 0,
    });
    expect(fake.audit).toHaveLength(1);
    expect(fake.audit[0]).toMatchObject({
      action: 'REQUEST_REASON_CREATED',
      entityType: 'request_reason',
      entityId: data.id,
      actorId: ACTOR,
    });
    expect(fake.audit[0].detail.after).toMatchObject({ code: 'LOI_THIET_BI_HOAC_MANG', paid: true });
  });

  it('mã sinh tự động tránh trùng, kể cả mã của lý do đã xóa mềm', async () => {
    const { controller, fake } = build();
    fake.seed({ kind: 'SHIFT_CHANGE', name: 'Khác cũ', code: 'KHAC', deleted_at: new Date() });
    const first = await controller.create(req, { kind: 'SHIFT_CHANGE', name: 'Khác' });
    expect(first.data.code).toBe('KHAC_2');
    const second = await controller.create(req, { kind: 'SHIFT_CHANGE', name: 'Khac' });
    expect(second.data.code).toBe('KHAC_3');
  });

  it('mã nhập tay: tự chuyển in hoa, kiểm tra định dạng và trùng mã', async () => {
    const { controller } = build();
    const created = await controller.create(req, { kind: 'OVERTIME', name: 'Hỗ trợ sự cố', code: ' ot_support ' });
    expect(created.data.code).toBe('OT_SUPPORT');
    await expect(
      controller.create(req, { kind: 'OVERTIME', name: 'Hỗ trợ khác', code: 'OT_SUPPORT' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.create(req, { kind: 'OVERTIME', name: 'Mã sai', code: '1 sai mã' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Cùng mã ở loại đơn khác thì được.
    await expect(
      controller.create(req, { kind: 'BUSINESS_TRIP', name: 'Hỗ trợ sự cố', code: 'OT_SUPPORT' }),
    ).resolves.toMatchObject({ data: { kind: 'BUSINESS_TRIP', code: 'OT_SUPPORT' } });
  });

  it('chỉ làm thêm giờ mới có không lương: loại đơn khác bị ép paid=true', async () => {
    const { controller } = build();
    const ot = await controller.create(req, { kind: 'OVERTIME', name: 'Tự nguyện', paid: false });
    expect(ot.data.paid).toBe(false);
    const otDefault = await controller.create(req, { kind: 'OVERTIME', name: 'Có lương mặc định' });
    expect(otDefault.data.paid).toBe(true);
    for (const kind of ['BUSINESS_TRIP', 'ATTENDANCE_CORRECTION', 'SHIFT_CHANGE'] as const) {
      const other = await controller.create(req, { kind, name: 'Thử không lương', paid: false });
      expect(other.data.paid).toBe(true);
    }
  });

  it('thứ tự mặc định đứng sau mục cuối cùng; có thể truyền sortOrder và requiresDescription', async () => {
    const { controller, fake } = build();
    fake.seed({ kind: 'OVERTIME', name: 'Đầu', sort_order: 90 });
    const next = await controller.create(req, { kind: 'OVERTIME', name: 'Sau cùng' });
    expect(next.data.sortOrder).toBe(100);
    const explicit = await controller.create(req, {
      kind: 'OVERTIME',
      name: 'Khác',
      sortOrder: 5,
      requiresDescription: true,
      active: false,
    });
    expect(explicit.data).toMatchObject({ sortOrder: 5, requiresDescription: true, active: false });
  });

  it('trùng tên (không phân biệt hoa thường) trong cùng loại đơn: 409; khác loại đơn hoặc đã xóa mềm thì được', async () => {
    const { controller, fake } = build();
    fake.seed({ kind: 'OVERTIME', name: 'Theo yêu cầu công việc' });
    fake.seed({ kind: 'SHIFT_CHANGE', name: 'Việc riêng', deleted_at: new Date() });
    await expect(
      controller.create(req, { kind: 'OVERTIME', name: 'THEO YÊU CẦU CÔNG VIỆC' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      controller.create(req, { kind: 'BUSINESS_TRIP', name: 'Theo yêu cầu công việc' }),
    ).resolves.toMatchObject({ data: { kind: 'BUSINESS_TRIP' } });
    await expect(controller.create(req, { kind: 'SHIFT_CHANGE', name: 'Việc riêng' })).resolves.toBeDefined();
  });

  it('đua ghi cùng lúc bị chỉ mục duy nhất chặn (23505) cũng trả 409 bằng tiếng Việt', async () => {
    const { controller, fake } = build();
    fake.failNextInsert('23505');
    await expect(controller.create(req, { kind: 'OVERTIME', name: 'Đua ghi' })).rejects.toThrow(/đã tồn tại/);
    expect(fake.live()).toHaveLength(0);
    expect(fake.audit).toEqual([]);
  });

  it('loại đơn không hợp lệ (kể cả loại động cũ), thiếu tên hoặc kiểu dữ liệu sai: 400', async () => {
    const { controller, fake } = build();
    for (const kind of ['OT_TYPE', 'TRIP_TYPE', 'TRIP_VEHICLE', 'LEAVE', '', undefined])
      await expect(
        controller.create(req, { kind: kind as never, name: 'Lý do' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(req, { kind: 'OVERTIME' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(req, { kind: 'OVERTIME', name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.create(req, { kind: 'OVERTIME', name: 'x'.repeat(256) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.create(req, { kind: 'OVERTIME', name: 'Sai kiểu', paid: 'false' as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.create(req, { kind: 'OVERTIME', name: 'Sai thứ tự', sortOrder: 1.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(req, null as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(fake.live()).toHaveLength(0);
  });
});

describe('HrmRequestReasonController: sửa lý do', () => {
  it('đổi tên, diễn giải, có lương, bắt buộc mô tả, đang dùng, thứ tự; ghi audit trước và sau', async () => {
    const { controller, fake } = build();
    const row = fake.seed({ kind: 'OVERTIME', name: 'Cũ', code: 'OT_OLD', description: 'Diễn giải cũ' });
    const { data } = await controller.update(req, row.id, {
      name: ' Mới ',
      description: ' Diễn giải mới ',
      paid: false,
      requiresDescription: true,
      active: false,
      sortOrder: 40,
    });
    expect(data).toMatchObject({
      name: 'Mới',
      description: 'Diễn giải mới',
      paid: false,
      requiresDescription: true,
      active: false,
      sortOrder: 40,
      code: 'OT_OLD',
      kind: 'OVERTIME',
    });
    expect(fake.audit).toHaveLength(1);
    expect(fake.audit[0]).toMatchObject({ action: 'REQUEST_REASON_UPDATED', entityId: row.id, actorId: ACTOR });
    expect(fake.audit[0].detail.before).toMatchObject({ name: 'Cũ', paid: true, active: true });
    expect(fake.audit[0].detail.after).toMatchObject({ name: 'Mới', paid: false, active: false });
  });

  it('chỉ đổi trường được gửi; description rỗng hoặc null xóa diễn giải', async () => {
    const { controller, fake } = build();
    const row = fake.seed({ kind: 'BUSINESS_TRIP', name: 'Giữ nguyên', description: 'Diễn giải', sort_order: 30 });
    const renamed = await controller.update(req, row.id, { name: 'Giữ nguyên 2' });
    expect(renamed.data).toMatchObject({ description: 'Diễn giải', sortOrder: 30, active: true });
    const cleared = await controller.update(req, row.id, { description: '  ' });
    expect(cleared.data.description).toBeNull();
    expect(cleared.data.name).toBe('Giữ nguyên 2');
  });

  it('loại đơn khác OT: paid=false bị ép về true', async () => {
    const { controller, fake } = build();
    const row = fake.seed({ kind: 'SHIFT_CHANGE', name: 'Việc cá nhân' });
    const { data } = await controller.update(req, row.id, { paid: false });
    expect(data.paid).toBe(true);
  });

  it('không đổi được loại đơn và mã; gửi lại đúng giá trị cũ thì bỏ qua', async () => {
    const { controller, fake } = build();
    const row = fake.seed({ kind: 'OVERTIME', name: 'Lý do', code: 'OT_X' });
    await expect(controller.update(req, row.id, { kind: 'BUSINESS_TRIP', name: 'Lý do 2' })).rejects.toThrow(
      /loại đơn/,
    );
    await expect(controller.update(req, row.id, { code: 'OT_Y' })).rejects.toThrow(/mã/);
    await expect(
      controller.update(req, row.id, { kind: 'OVERTIME', code: 'ot_x', name: 'Lý do mới' }),
    ).resolves.toMatchObject({ data: { name: 'Lý do mới', code: 'OT_X' } });
    expect(fake.audit).toHaveLength(1);
  });

  it('đổi tên trùng lý do khác cùng loại đơn: 409; đổi hoa thường tên của chính nó thì được', async () => {
    const { controller, fake } = build();
    fake.seed({ kind: 'OVERTIME', name: 'Công việc' });
    const mine = fake.seed({ kind: 'OVERTIME', name: 'Khác' });
    await expect(controller.update(req, mine.id, { name: 'công việc' })).rejects.toBeInstanceOf(ConflictException);
    await expect(controller.update(req, mine.id, { name: 'KHÁC' })).resolves.toMatchObject({ data: { name: 'KHÁC' } });
  });

  it('không tìm thấy, đã xóa, id sai định dạng, body rỗng: 404 hoặc 400', async () => {
    const { controller, fake } = build();
    const deleted = fake.seed({ kind: 'OVERTIME', name: 'Đã xóa', deleted_at: new Date() });
    const live = fake.seed({ kind: 'OVERTIME', name: 'Còn' });
    await expect(
      controller.update(req, '00000000-0000-4000-8000-00000000ffff', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.update(req, deleted.id, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.update(req, 'khong-phai-uuid', { name: 'X' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.update(req, live.id, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.update(req, live.id, { name: '' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HrmRequestReasonController: xóa lý do', () => {
  it('chưa có đơn dùng: xóa mềm và ghi audit', async () => {
    const { controller, fake } = build();
    const row = fake.seed({ kind: 'OVERTIME', name: 'Chưa dùng' });
    const result = await controller.remove(req, row.id);
    expect(result.data).toMatchObject({ id: row.id, deleted: true, active: false, usageCount: 0 });
    expect(result.message).toMatch(/Đã xóa lý do/);
    expect(row.deleted_at).not.toBeNull();
    expect(fake.audit).toHaveLength(1);
    expect(fake.audit[0]).toMatchObject({ action: 'REQUEST_REASON_DELETED', entityId: row.id });
    expect((await controller.list(req, 'OVERTIME')).data).toHaveLength(0);
    // Xóa lần hai: không còn thấy.
    await expect(controller.remove(req, row.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đã có đơn dùng: không xóa, chỉ ngừng sử dụng, báo bằng tiếng Việt', async () => {
    const { controller, fake } = build();
    const row = fake.seed({ kind: 'BUSINESS_TRIP', name: 'Đã dùng' });
    fake.usage.set(row.id, 7);
    const result = await controller.remove(req, row.id);
    expect(result.data).toMatchObject({ id: row.id, deleted: false, active: false, usageCount: 7 });
    expect(result.message).toMatch(/7 đơn/);
    expect(result.message).toMatch(/ngừng sử dụng/);
    expect(row.deleted_at).toBeNull();
    expect(row.active).toBe(false);
    expect(fake.audit).toHaveLength(1);
    expect(fake.audit[0]).toMatchObject({ action: 'REQUEST_REASON_DEACTIVATED', entityId: row.id });
    expect(fake.audit[0].detail.usageCount).toBe(7);
    // Vẫn còn trong danh mục (ở trạng thái ngừng dùng) để đơn cũ hiện đúng lý do.
    expect((await controller.list(req, 'BUSINESS_TRIP', 'false')).data.map((r) => r.id)).toEqual([row.id]);
  });

  it('id không tồn tại hoặc sai định dạng', async () => {
    const { controller } = build();
    await expect(controller.remove(req, '00000000-0000-4000-8000-00000000ffff')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.remove(req, 'abc')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HrmRequestReasonController: tạo lý do mặc định', () => {
  it('tenant chưa có lý do nào: tạo đủ danh sách mặc định cho 4 loại đơn, có lương', async () => {
    const { controller, fake } = build();
    const result = await controller.createDefaults(req);
    expect(result.data.created).toBe(DEFAULT_REQUEST_REASONS.length);
    for (const kind of REQUEST_REASON_KINDS) {
      const created = fake.live().filter((r) => r.kind === kind);
      expect(created.map((r) => r.code).sort()).toEqual(
        DEFAULT_REQUEST_REASONS.filter((d) => d.kind === kind)
          .map((d) => d.code)
          .sort(),
      );
    }
    expect(fake.live().every((r) => r.paid)).toBe(true);
    expect(fake.live().filter((r) => r.requires_description).map((r) => r.name)).toEqual(['Khác', 'Khác', 'Khác', 'Khác']);
    expect(fake.audit).toHaveLength(1);
    expect(fake.audit[0]).toMatchObject({
      action: 'REQUEST_REASON_DEFAULTS_CREATED',
      entityType: 'request_reason_catalog',
      entityId: TENANT,
    });
    expect(fake.audit[0].detail.created).toBe(DEFAULT_REQUEST_REASONS.length);
  });

  it('gọi lại không tạo trùng và không ghi audit thêm (idempotent)', async () => {
    const { controller, fake } = build();
    await controller.createDefaults(req);
    const second = await controller.createDefaults(req);
    expect(second.data.created).toBe(0);
    expect(fake.live()).toHaveLength(DEFAULT_REQUEST_REASONS.length);
    expect(fake.audit).toHaveLength(1);
  });

  it('chỉ bổ sung loại đơn chưa có lý do nào, không đụng loại đơn đã cấu hình', async () => {
    const { controller, fake } = build();
    fake.seed({ kind: 'OVERTIME', name: 'Lý do tự cấu hình' });
    const result = await controller.createDefaults(req);
    expect(result.data.created).toBe(DEFAULT_REQUEST_REASONS.filter((d) => d.kind !== 'OVERTIME').length);
    expect(fake.live().filter((r) => r.kind === 'OVERTIME').map((r) => r.name)).toEqual(['Lý do tự cấu hình']);
  });

  it('lý do đã xóa mềm không tính là đã có: tạo lại mặc định', async () => {
    const { controller, fake } = build();
    fake.seed({ kind: 'OVERTIME', name: 'Đã xóa', deleted_at: new Date() });
    const result = await controller.createDefaults(req);
    expect(result.data.created).toBe(DEFAULT_REQUEST_REASONS.length);
  });
});

describe('HrmRequestReasonController: không dùng loại đơn động của bản cũ', () => {
  it('không câu SQL nào chạm request_reason_categories, fixed_items hay loại OT', async () => {
    const { controller, fake } = build();
    await controller.createDefaults(req);
    const created = await controller.create(req, { kind: 'OVERTIME', name: 'Thêm' });
    await controller.list(req, 'OVERTIME', 'true');
    await controller.update(req, created.data.id, { name: 'Thêm 2' });
    await controller.remove(req, created.data.id);
    expect(fake.sqls.length).toBeGreaterThan(10);
    expect(fake.sqls.filter((s) => /request_reason_categories|fixed_items|OT_TYPE/.test(s))).toEqual([]);
  });
});
