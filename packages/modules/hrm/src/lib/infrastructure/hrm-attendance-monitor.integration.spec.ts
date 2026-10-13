import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { loadAttendanceMonitor, loadTeamEmployeeIds } from './hrm-attendance-monitor';

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

async function registeredMigrations(): Promise<string[]> {
  const source = await readFile(
    resolve(process.cwd(), '../../../packages/platform/entitlement/src/lib/tenant-migrations.ts'),
    'utf8',
  );
  const pathsBetween = (from: string, to: string) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    return [...source.slice(start, end === -1 ? undefined : end).matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  };
  return [
    ...pathsBetween('export const TENANT_CORE_MIGRATIONS', 'export const TENANT_MODULE_MIGRATIONS'),
    'tenant/0001-integration.sql',
    ...pathsBetween('  hrm: [', '  inventory: ['),
  ];
}

integration('Giám sát chấm công theo ngày (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const DATE = '2026-08-12';
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let shiftId: string;

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    shiftId = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes)
         VALUES ($1,'DAY','Hành chính','08:00','17:00',false,60,0,0) RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  it('người quản lý chỉ thấy cấp dưới (trực tiếp và gián tiếp) theo sơ đồ tổ chức; ngày đã qua không chấm công là vắng', async () => {
    const tree = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.organization_trees (id,code,name,is_primary) VALUES ($1,$2,'Sơ đồ',false)`,
      [tree, `T-${tree.slice(0, 8)}`],
    );
    const position = async (code: string, reportsTo: string | null) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO core_schema.organization_nodes (id,tree_id,category,code,name,reports_to_position_id) VALUES ($1,$2,'position',$3,$3,$4)`,
        [id, tree, `${code}-${id.slice(0, 6)}`, reportsTo],
      );
      return id;
    };
    const person = async (code: string, positionId: string) => {
      const userId = randomUUID();
      await pool.query(
        `INSERT INTO core_schema.users (id,username,full_name,email,password_hash) VALUES ($1,$2,$2,$3,'x')`,
        [userId, `${code}-${userId.slice(0, 6)}`, `${userId}@t.local`],
      );
      const id = randomUUID();
      await pool.query(
        `INSERT INTO core_schema.employees (id,tenant_id,user_id,full_name,work_email) VALUES ($1,$2,$3,$4,$5)`,
        [id, tenantId, userId, code, `${userId}@t.local`],
      );
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (employee_id,tenant_id,employee_code,join_date) VALUES ($1,$2,$3,'2020-01-01')`,
        [id, tenantId, code],
      );
      await pool.query(
        `INSERT INTO core_schema.organization_node_assignments (id,node_id,user_id,is_primary) VALUES ($1,$2,$3,true)`,
        [randomUUID(), positionId, userId],
      );
      await pool.query(
        `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
         SELECT $1,$2,d::date,'SHIFT',$3,'MANUAL' FROM generate_series('2026-08-10'::date,'2026-08-14'::date,'1 day') d`,
        [tenantId, id, shiftId],
      );
      return id;
    };
    const ceoPos = await position('MCEO', null);
    const headPos = await position('MHEAD', ceoPos);
    const leadPos = await position('MLEAD', headPos);
    const staffPos = await position('MSTAFF', leadPos);
    const otherPos = await position('MOTHER', ceoPos);
    const head = await person('MON-HEAD', headPos);
    const lead = await person('MON-LEAD', leadPos);
    const staff = await person('MON-STAFF', staffPos);
    const outsider = await person('MON-OUT', otherPos);
    const punch = async (employeeId: string, kind: 'IN' | 'OUT', occurredAt: string) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO hrm_schema.attendance_events(id,tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence)
         VALUES($1,$2,$3,$4,$5,$6,'WEB_PORTAL',($1::uuid)::text,'{}')`,
        [id, tenantId, employeeId, DATE, kind, occurredAt],
      );
    };
    // Giờ Việt Nam = UTC+7, ca 08:00-17:00: lead vào 07:55 ra 17:05; staff không chấm công.
    await punch(lead, 'IN', '2026-08-12T00:55:00Z');
    await punch(lead, 'OUT', '2026-08-12T10:05:00Z');

    // Trưởng phòng thấy cấp dưới trực tiếp và gián tiếp, không có người ngoài nhánh, không có chính mình.
    const team = (await loadTeamEmployeeIds(pool, tenantId, head)).sort();
    expect(team).toEqual([lead, staff].sort());
    expect(await loadTeamEmployeeIds(pool, tenantId, staff)).toEqual([]);

    const monitor = await loadAttendanceMonitor(pool, tenantId, { date: DATE, employeeIds: team, scope: 'TEAM' });
    expect(monitor.rows.map((r) => r.employeeId).sort()).toEqual(team);
    expect(monitor.rows.find((r) => r.employeeId === lead)).toMatchObject({ status: 'COMPLETED', checkIn: '07:55', checkOut: '17:05' });
    expect(monitor.rows.find((r) => r.employeeId === staff)).toMatchObject({ status: 'ABSENT', checkIn: null });
    expect(monitor.summary).toMatchObject({ totalPeople: 2, scheduled: 2, checkedIn: 1 });

    // Toàn công ty: thấy cả người ngoài nhánh.
    const all = await loadAttendanceMonitor(pool, tenantId, { date: DATE, employeeIds: null, scope: 'ALL' });
    expect(all.rows.some((r) => r.employeeId === outsider)).toBe(true);
    expect(all.rows.length).toBeGreaterThan(monitor.rows.length);
  }, 60_000);
});
