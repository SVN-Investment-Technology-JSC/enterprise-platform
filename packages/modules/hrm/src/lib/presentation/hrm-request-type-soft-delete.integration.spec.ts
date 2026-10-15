import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { loadApprovalRouteRows } from '../infrastructure/hrm-approval-route';
import { SYSTEM_REQUEST_TYPES } from '../infrastructure/hrm-request-types';
import { HrmRequestTypeController } from './hrm-request-type.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

/** Xoá mềm loại đơn trên PostgreSQL thật (DB tạm trên máy local, dựng bằng toàn bộ migration core + HRM). */
integration('HRM xoá mềm loại đơn: PostgreSQL integration', () => {
  const name = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userId = randomUUID();
  const req = { headers: {} } as Request;
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let controller: HrmRequestTypeController;

  const migrationsRoot = resolve(process.cwd(), '../../../migrations/tenant');
  const apply = async (path: string) => {
    const sql = await readFile(resolve(migrationsRoot, path), 'utf8');
    // Migrator chạy mỗi file trong một transaction (có file dùng SET LOCAL / bảng tạm ON COMMIT DROP).
    await pool.query(`BEGIN;\n${sql}\nCOMMIT;`);
  };

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Local DB required');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = '/' + name;
    pool = createPostgresPool(url.toString());
    // Thứ tự migration lấy đúng từ registry của migrator (có nhiều file cùng số 0005, chỉ một số được đăng ký).
    const registry = await readFile(
      resolve(process.cwd(), '../../platform/entitlement/src/lib/tenant-migrations.ts'),
      'utf8',
    );
    const registered = [...registry.matchAll(/path:\s*'tenant\/((?:core|hrm)\/[^']+\.sql)'/g)].map((m) => m[1]);
    const core = registered.filter((f) => f.startsWith('core/'));
    const hrm = registered.filter((f) => f.startsWith('hrm/'));
    for (const path of [...core, '0001-integration.sql', ...hrm]) await apply(path);
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, 'Quản trị', 'admin@test.local', 'test-only')`,
      [userId],
    );
    const ctx = {
      getContext: async () => ({
        pool,
        tenantId,
        principal: { userId, permissions: ['hrm.read', 'hrm.leave.manage'] },
      }),
    };
    controller = Object.create(HrmRequestTypeController.prototype) as HrmRequestTypeController;
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

  const deactivate = async (id: string) => {
    const row = (await controller.listForManage(req)).data.find((t) => t.id === id)!;
    await controller.update(req, id, { expectedUpdatedAt: row.updatedAt, active: false });
  };
  const rawType = async (id: string) =>
    (
      await pool.query(
        'SELECT active, deleted_at FROM hrm_schema.request_reason_categories WHERE tenant_id = $1 AND id = $2',
        [tenantId, id],
      )
    ).rows[0];

  it('loại tự tạo: đang bật thì chưa xoá; đã ngừng thì xoá mềm, biến khỏi danh sách nhưng dòng dữ liệu còn', async () => {
    const created = await controller.create(req, { name: 'Đề xuất mua sắm' });
    const id = created.data.id;
    await expect(controller.remove(req, id)).rejects.toBeInstanceOf(ConflictException);
    expect((await rawType(id)).deleted_at).toBeNull();

    await deactivate(id);
    const result = await controller.remove(req, id);
    expect(result.data).toMatchObject({ deleted: true });

    const row = await rawType(id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.active).toBe(false);
    expect((await controller.list(req)).data.some((t) => t.id === id)).toBe(false);
    expect((await controller.listForManage(req)).data.some((t) => t.id === id)).toBe(false);
    await expect(controller.remove(req, id)).rejects.toBeInstanceOf(NotFoundException);
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM hrm_schema.audit_log WHERE tenant_id = $1 AND action = 'REQUEST_TYPE_DELETED'`,
      [tenantId],
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('tạo lại loại cùng tên sau khi đã xoá mềm thì không vướng trùng mã', async () => {
    const again = await controller.create(req, { name: 'Đề xuất mua sắm' });
    expect(again.data.active).toBe(true);
    const live = (await controller.listForManage(req)).data.filter((t) => t.name === 'Đề xuất mua sắm');
    expect(live).toHaveLength(1);
  });

  it('lý do thuộc loại bị xoá cũng bị xoá mềm theo', async () => {
    const created = await controller.create(req, { name: 'Loại có lý do' });
    const code = (await controller.listForManage(req)).data.find((t) => t.id === created.data.id)!.code;
    await pool.query(
      `INSERT INTO hrm_schema.request_reasons (id, tenant_id, kind, name, active)
       VALUES ($1, $2, $3, 'Lý do thử', true)`,
      [randomUUID(), tenantId, code],
    );
    await deactivate(created.data.id);
    await controller.remove(req, created.data.id);
    const reasons = await pool.query(
      'SELECT active, deleted_at FROM hrm_schema.request_reasons WHERE tenant_id = $1 AND kind = $2',
      [tenantId, code],
    );
    expect(reasons.rows).toHaveLength(1);
    expect(reasons.rows[0].deleted_at).not.toBeNull();
    expect(reasons.rows[0].active).toBe(false);
  });

  it('cấu hình cách duyệt: loại đã xoá không còn dòng cấu hình, liên kết quy trình bị gỡ', async () => {
    const created = await controller.create(req, { name: 'Loại có cách duyệt' });
    const code = (await controller.listForManage(req)).data.find((t) => t.id === created.data.id)!.code;
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings (tenant_id, request_kind, sub_type_code, mode, is_active)
       VALUES ($1, 'custom', $2, 'DIRECT', true)`,
      [tenantId, code],
    );
    const before = await loadApprovalRouteRows(pool, tenantId);
    expect(before.reasons.some((r) => r.requestKind === 'custom' && r.code === code)).toBe(true);
    expect(before.bindings.some((b) => b.sub_type_code === code)).toBe(true);

    await deactivate(created.data.id);
    await controller.remove(req, created.data.id);

    const after = await loadApprovalRouteRows(pool, tenantId);
    expect(after.reasons.some((r) => r.requestKind === 'custom' && r.code === code)).toBe(false);
    expect(after.bindings.some((b) => b.sub_type_code === code)).toBe(false);
  });

  it('loại hệ thống đã ngừng cũng xoá mềm được và không bị tự tạo lại khi mở lại danh sách', async () => {
    const list = await controller.listForManage(req);
    const ot = list.data.find((t) => t.code === 'OVERTIME')!;
    await deactivate(ot.id);
    await controller.remove(req, ot.id);
    const after = await controller.listForManage(req);
    expect(after.data.some((t) => t.code === 'OVERTIME')).toBe(false);
    const again = await controller.list(req);
    expect(again.data.some((t) => t.code === 'OVERTIME')).toBe(false);
    expect((await rawType(ot.id)).deleted_at).not.toBeNull();
    expect(SYSTEM_REQUEST_TYPES.some((t) => t.code === 'OVERTIME')).toBe(true);
  });

  it('loại hệ thống còn đơn đang chạy quy trình thì chưa xoá được', async () => {
    const advance = (await controller.listForManage(req)).data.find((t) => t.code === 'ADVANCE')!;
    await deactivate(advance.id);
    const employeeId = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.employees(id, tenant_id, full_name) VALUES ($1, $2, 'Nhân viên thử')`,
      [employeeId, tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.procedure_links
         (id, tenant_id, request_kind, request_id, employee_id, initiated_by, title, source_id, start_idempotency_key, sync_status)
       VALUES ($1, $2, 'advance', $3, $4, $6, 'Đơn tạm ứng đang chạy', $3, $5, 'RUNNING')`,
      [randomUUID(), tenantId, randomUUID(), employeeId, randomUUID(), userId],
    );
    await expect(controller.remove(req, advance.id)).rejects.toThrow(/đơn đang chạy quy trình/);
    expect((await rawType(advance.id)).deleted_at).toBeNull();
  });

  it('Nghỉ phép không ngừng được nên cũng không xoá được', async () => {
    const leave = (await controller.listForManage(req)).data.find((t) => t.code === 'LEAVE')!;
    await expect(controller.remove(req, leave.id)).rejects.toBeInstanceOf(ConflictException);
  });
});
