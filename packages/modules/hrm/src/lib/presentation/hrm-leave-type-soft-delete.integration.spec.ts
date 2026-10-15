import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { loadApprovalRouteRows } from '../infrastructure/hrm-approval-route';
import { listAuditTrail } from '../infrastructure/hrm-audit-trail';
import { HrmLeaveController } from './hrm-leave.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

/** Xoá loại nghỉ trên PostgreSQL thật: chưa phát sinh dữ liệu thì xoá mềm, đã có số dư/đơn thì chỉ ngừng sử dụng. */
integration('HRM xoá mềm loại nghỉ: PostgreSQL integration', () => {
  const name = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userId = randomUUID();
  const employeeId = randomUUID();
  const req = { headers: {} } as Request;
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let controller: HrmLeaveController;

  const migrationsRoot = resolve(process.cwd(), '../../../migrations/tenant');
  const apply = async (path: string) => {
    const sql = await readFile(resolve(migrationsRoot, path), 'utf8');
    await pool.query(`BEGIN;\n${sql}\nCOMMIT;`);
  };

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local DB required');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = '/' + name;
    pool = createPostgresPool(url.toString());
    const registry = await readFile(
      resolve(process.cwd(), '../../platform/entitlement/src/lib/tenant-migrations.ts'),
      'utf8',
    );
    const registered = [...registry.matchAll(/path:\s*'tenant\/((?:core|hrm)\/[^']+\.sql)'/g)].map((m) => m[1]);
    for (const path of [
      ...registered.filter((f) => f.startsWith('core/')),
      '0001-integration.sql',
      ...registered.filter((f) => f.startsWith('hrm/')),
    ])
      await apply(path);
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, 'Quản trị', 'admin@test.local', 'test-only')`,
      [userId],
    );
    await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, full_name) VALUES ($1, $2, 'Nhân viên thử')`, [
      employeeId,
      tenantId,
    ]);
    const ctx = {
      getContext: async () => ({
        pool,
        tenantId,
        principal: { userId, permissions: ['hrm.read', 'hrm.leave.manage'] },
      }),
    };
    controller = Object.create(HrmLeaveController.prototype) as HrmLeaveController;
    Object.assign(controller, { ctx });
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(name)) throw new Error('Invalid DB');
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });

  const create = async (code: string) =>
    (
      await controller.createLeaveType(req, {
        code,
        name: `Loại ${code}`,
        unit: 'DAYS',
        paid: true,
        requiresAttachment: false,
        carryoverAllowed: false,
        active: true,
        deductBalance: true,
      } as never)
    ).data;
  const raw = async (id: string) =>
    (await pool.query('SELECT active, deleted_at FROM hrm_schema.leave_types WHERE id = $1', [id])).rows[0];

  it('loại chưa phát sinh dữ liệu: xoá mềm, ẩn khỏi danh sách, dòng dữ liệu còn', async () => {
    const type = await create('SD_NEW');
    const result = await controller.deleteLeaveType(req, type.id);
    expect(result.data).toMatchObject({ deleted: true, active: false });
    const row = await raw(type.id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.active).toBe(false);
    expect((await controller.listLeaveTypes(req)).data.some((t) => t.id === type.id)).toBe(false);
    expect((await controller.listLeaveTypes(req, 'false')).data.some((t) => t.id === type.id)).toBe(false);
    await expect(controller.deleteLeaveType(req, type.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('đã có sổ phép (số dư khác 0): chỉ ngừng sử dụng, không xoá mềm', async () => {
    const type = await create('SD_BAL');
    await pool.query(
      `INSERT INTO hrm_schema.leave_balances (tenant_id, employee_id, leave_type_id, year, opening_balance, remaining)
       VALUES ($1, $2, $3, 2026, 5, 5)`,
      [tenantId, employeeId, type.id],
    );
    const result = await controller.deleteLeaveType(req, type.id);
    expect(result.data).toMatchObject({ deleted: false, active: false });
    const row = await raw(type.id);
    expect(row.deleted_at).toBeNull();
    expect(row.active).toBe(false);
    // Còn trong danh sách loại ngừng sử dụng để quản trị tra cứu hoặc bật lại.
    expect((await controller.listLeaveTypes(req, 'false')).data.some((t) => t.id === type.id)).toBe(true);
  });

  it('mã của loại đã xoá mềm được dùng lại; mã đang dùng thì vẫn báo trùng (chỉ mục duy nhất một phần)', async () => {
    const again = await create('SD_NEW');
    expect(again.code).toBe('SD_NEW');
    expect((await controller.listLeaveTypes(req)).data.filter((t) => t.code === 'SD_NEW')).toHaveLength(1);
    await expect(create('SD_NEW')).rejects.toThrow(/Mã loại nghỉ đã tồn tại/);
    const rows = await pool.query(
      'SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live FROM hrm_schema.leave_types WHERE tenant_id = $1 AND code = $2',
      [tenantId, 'SD_NEW'],
    );
    expect(rows.rows[0]).toEqual({ total: 2, live: 1 });
  });

  it('xoá loại gỡ liên kết quy trình theo mã; loại tạo lại cùng mã không thừa hưởng cách duyệt cũ', async () => {
    const type = await create('SD_BIND');
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings (tenant_id, request_kind, sub_type_code, mode, is_active)
       VALUES ($1, 'leave', 'SD_BIND', 'DIRECT', true)`,
      [tenantId],
    );
    const before = await loadApprovalRouteRows(pool, tenantId);
    expect(before.bindings.some((b) => b.sub_type_code === 'SD_BIND')).toBe(true);

    await controller.deleteLeaveType(req, type.id);
    const afterDelete = await loadApprovalRouteRows(pool, tenantId);
    expect(afterDelete.bindings.some((b) => b.sub_type_code === 'SD_BIND')).toBe(false);
    expect(afterDelete.reasons.some((r) => r.requestKind === 'leave' && r.code === 'SD_BIND')).toBe(false);

    const recreated = await create('SD_BIND');
    const afterRecreate = await loadApprovalRouteRows(pool, tenantId);
    expect(afterRecreate.reasons.some((r) => r.requestKind === 'leave' && r.id === recreated.id)).toBe(true);
    expect(afterRecreate.bindings.some((b) => b.sub_type_code === 'SD_BIND')).toBe(false);
  });
  it('nhật ký kiểm toán: loại đã xoá vẫn hiện tên kèm dấu "(đã xoá)", loại tạo lại cùng mã hiện riêng; có sự kiện tạo, xoá', async () => {
    const trail = await listAuditTrail(pool, tenantId, { search: 'SD_NEW', page: 1, pageSize: 50 });
    const labels = trail.rows.map((r) => `${r.action}|${r.entityLabel}`);
    expect(labels).toContain('LEAVE_TYPE_CREATED|SD_NEW · Loại SD_NEW (đã xóa)');
    expect(labels).toContain('LEAVE_TYPE_DELETED|SD_NEW · Loại SD_NEW (đã xóa)');
    // Loại tạo lại cùng mã (còn hoạt động) không có dấu "đã xóa", nên phân biệt được với loại cũ.
    expect(labels).toContain('LEAVE_TYPE_CREATED|SD_NEW · Loại SD_NEW');
    const deleted = trail.rows.find((r) => r.action === 'LEAVE_TYPE_DELETED')!;
    expect(deleted.actionLabel).toBe('Xóa loại nghỉ');
    expect(deleted.detail).toMatchObject({ before: { code: 'SD_NEW' } });
    expect((deleted.detail as { before: { id: string } }).before.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
