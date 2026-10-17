import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { listAuditTrail } from '../infrastructure/hrm-audit-trail';
import { HrmShiftController } from './hrm-shift.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const SHIFT_SOFT_DELETE = 'hrm/0056-hrm-shift-soft-delete.sql';
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

/** Xoá ca làm trên PostgreSQL thật: chưa dùng thì xoá hẳn, đã dùng thì xoá mềm (DB tạm trên máy local). */
integration('HRM xoá mềm ca làm: PostgreSQL integration', () => {
  const name = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userId = randomUUID();
  const req = { headers: {} } as Request;
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let controller: HrmShiftController;
  let registered: string[] = [];

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
    // Chỉ chạy những migration đã đăng ký trong registry của migrator: cột deleted_at của ca phải nằm trong đó.
    const registry = await readFile(
      resolve(process.cwd(), '../../platform/entitlement/src/lib/tenant-migrations.ts'),
      'utf8',
    );
    registered = [...registry.matchAll(/path:\s*'tenant\/((?:core|hrm)\/[^']+\.sql)'/g)].map((m) => m[1]);
    const core = registered.filter((f) => f.startsWith('core/'));
    const hrm = registered.filter((f) => f.startsWith('hrm/'));
    for (const path of [...core, '0001-integration.sql', ...hrm]) await apply(path);
    // Chưa đăng ký thì vẫn áp migration xoá mềm để kiểm logic; việc thiếu đăng ký do test riêng bên dưới báo.
    if (!registered.includes(SHIFT_SOFT_DELETE)) await apply(SHIFT_SOFT_DELETE);
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, 'Quản trị', 'admin@test.local', 'test-only')`,
      [userId],
    );
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId, permissions: ['hrm.read', 'hrm.shift.manage'] } }),
    };
    controller = Object.create(HrmShiftController.prototype) as HrmShiftController;
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

  const shiftBody = (code: string) => ({
    code,
    name: `Ca ${code}`,
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 60,
    breakStartTime: '12:00',
    breakEndTime: '13:00',
  });
  const raw = async (id: string) =>
    (await pool.query('SELECT status, deleted_at FROM hrm_schema.shift_definitions WHERE id = $1', [id])).rows[0];
  /** Phát sinh dữ liệu cho ca: gán vào lịch tuần của công ty. */
  const useInSchedule = async (shiftId: string) => {
    const rule = await pool.query(
      `INSERT INTO hrm_schema.work_schedule_rules (tenant_id, scope_type, effective_from, status)
       VALUES ($1, 'COMPANY', CURRENT_DATE, 'ACTIVE') RETURNING id`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.work_schedule_rule_days (rule_id, tenant_id, weekday, day_type, shift_id)
       VALUES ($1, $2, 1, 'SHIFT', $3)`,
      [rule.rows[0].id, tenantId, shiftId],
    );
  };

  it('cột deleted_at của ca nằm trong registry migration (nếu không, DB triển khai bằng migrator sẽ thiếu cột)', () => {
    expect(registered).toContain(SHIFT_SOFT_DELETE);
  });

  it('ca chưa phát sinh dữ liệu: xoá vĩnh viễn', async () => {
    const created = await controller.createShift(req, shiftBody('SD_UNUSED'));
    const id = created.data.id;
    const result = await controller.deleteShift(req, id);
    expect(result.data).toMatchObject({ deleted: true, status: 'DELETED' });
    expect(await raw(id)).toBeUndefined();
  });

  it('ca đã có trong lịch: xoá mềm, dòng còn nhưng ẩn khỏi danh mục và không mở/sửa được', async () => {
    const created = await controller.createShift(req, shiftBody('SD_USED'));
    const id = created.data.id;
    await useInSchedule(id);

    const result = await controller.deleteShift(req, id);
    expect(result.data).toMatchObject({ deleted: true, status: 'INACTIVE' });
    const row = await raw(id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.status).toBe('INACTIVE');

    const listed = await controller.listShifts(req);
    expect(listed.data.some((s) => s.id === id)).toBe(false);
    const inactiveOnly = await controller.listShifts(req, 'INACTIVE');
    expect(inactiveOnly.data.some((s) => s.id === id)).toBe(false);
    await expect(controller.getShift(req, id)).rejects.toBeDefined();
    await expect(
      controller.updateShift(req, id, { name: 'Đổi tên', expectedUpdatedAt: new Date().toISOString() } as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Lịch phân ca cũ vẫn trỏ tới ca đã xoá mềm (toàn vẹn dữ liệu lịch sử).
    const link = await pool.query('SELECT 1 FROM hrm_schema.work_schedule_rule_days WHERE shift_id = $1', [id]);
    expect(link.rowCount).toBe(1);
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM hrm_schema.audit_log WHERE tenant_id = $1 AND action = 'SHIFT_DELETED' AND entity_id = $2`,
      [tenantId, id],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('xoá mềm xong thì tạo lại ca cùng mã được, còn mã đang dùng thì vẫn báo trùng', async () => {
    const again = await controller.createShift(req, shiftBody('SD_USED'));
    expect(again.data.status).toBe('ACTIVE');
    await expect(controller.createShift(req, shiftBody('sd_used'))).rejects.toBeInstanceOf(ConflictException);
    const live = (await controller.listShifts(req)).data.filter((s) => s.code === 'SD_USED');
    expect(live).toHaveLength(1);
  });

  it('xoá lại một ca đã xoá mềm trả không tìm thấy, không ghi thêm audit', async () => {
    const created = await controller.createShift(req, shiftBody('SD_TWICE'));
    await useInSchedule(created.data.id);
    await controller.deleteShift(req, created.data.id);
    await expect(controller.deleteShift(req, created.data.id)).rejects.toBeInstanceOf(NotFoundException);
    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM hrm_schema.audit_log WHERE tenant_id = $1 AND action = 'SHIFT_DELETED' AND entity_id = $2`,
      [tenantId, created.data.id],
    );
    expect(audit.rows[0].n).toBe(1);
  });
  it('ca đang gán cho đơn vị (unit_shift_assignments) cũng được tính là đã dùng: xoá mềm, không lỗi khoá ngoại', async () => {
    const created = await controller.createShift(req, shiftBody('SD_UNIT'));
    const id = created.data.id;
    const tree = randomUUID();
    const node = randomUUID();
    await pool.query(`INSERT INTO core_schema.organization_trees (id, code, name) VALUES ($1, 'T', 'Cây thử')`, [tree]);
    await pool.query(
      `INSERT INTO core_schema.organization_nodes (id, tree_id, code, name) VALUES ($1, $2, 'DV', 'Đơn vị thử')`,
      [node, tree],
    );
    await pool.query(
      `INSERT INTO hrm_schema.unit_shift_assignments (tenant_id, unit_id, shift_id, effective_from) VALUES ($1, $2, $3, CURRENT_DATE)`,
      [tenantId, node, id],
    );
    const result = await controller.deleteShift(req, id);
    expect(result.data).toMatchObject({ deleted: true, status: 'INACTIVE' });
    expect((await raw(id)).deleted_at).not.toBeNull();
  });
  it('nhật ký kiểm toán: ca đã xoá mềm hiện tên kèm dấu "(đã xóa)", ca tạo lại cùng mã hiện riêng', async () => {
    const trail = await listAuditTrail(pool, tenantId, { search: 'SD_USED', page: 1, pageSize: 50 });
    const labels = trail.rows.map((r) => `${r.action}|${r.entityLabel}`);
    expect(labels).toContain('SHIFT_DELETED|SD_USED · Ca SD_USED (đã xóa)');
    expect(labels).toContain('SHIFT_CREATED|SD_USED · Ca SD_USED');
    expect(trail.rows.find((r) => r.action === 'SHIFT_DELETED')!.actionLabel).toBe('Xóa ca làm việc');
  });
});
