/**
 * Test tích hợp phân ca trên schema thật. MẶC ĐỊNH BỊ BỎ QUA.
 *
 * Chạy khi cần xác minh SQL trên DB thật (cần tunnel/DB đang mở, migration 0035 và 0036 đã áp hoặc sẽ được áp
 * trong transaction của test):
 *   PowerShell:  $env:HRM_SCHEDULE_DB_TEST_TENANT = 'tho-demo'; pnpm nx test module-hrm --testPathPatterns=work-schedule.db --skip-nx-cache
 *
 * Mọi thao tác (kể cả chạy migration nếu bảng chưa có, tạo nhân viên và ca giả) nằm trong MỘT transaction và luôn
 * ROLLBACK ở cuối, kể cả khi lỗi. Nên chạy trên tenant demo; không dùng tenant có dữ liệu thật của khách nếu không cần.
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { resolveDay } from './hrm-shift-resolution';
import { dayContextForDate } from './hrm-time';
import { calculateTimesheet } from './hrm-timesheet-calculation';
import {
  applySchedule,
  cancelHoliday,
  cancelSchedule,
  copySchedule,
  createHoliday,
  previewSchedule,
  queryScheduleAudit,
  queryScheduleExport,
  queryScheduleGrid,
  queryScheduleList,
  resolveScopeEmployees,
} from './hrm-work-schedule';
import { applyRule, cancelRule, endRule, listRules, previewRule } from './hrm-work-schedule-rules';

const TENANT_SLUG = process.env.HRM_SCHEDULE_DB_TEST_TENANT;
const ACTOR = '00000000-0000-4000-8000-0000000000f1';
const ROOT = process.cwd().includes('packages') ? `${process.cwd()}/../../..` : process.cwd();
const migration = (name: string) => readFileSync(`${ROOT}/migrations/tenant/hrm/${name}.sql`, 'utf8');

(TENANT_SLUG ? it : it.skip)('phân ca chạy đúng trên schema thật (luôn rollback)', async () => {
  jest.setTimeout(180_000);
  process.loadEnvFile(`${ROOT}/.env`);
  const platform = new Client({ connectionString: process.env.PLATFORM_DATABASE_URL, connectionTimeoutMillis: 10_000 });
  await platform.connect();
  const t = await platform.query(
    `select t.id, d.database_name from tenancy_schema.tenants t join tenancy_schema.tenant_db_configs d on d.tenant_id=t.id and d.status='active' where t.slug=$1`,
    [TENANT_SLUG],
  );
  await platform.end();
  if (!t.rows[0]) throw new Error(`Không thấy tenant ${TENANT_SLUG}`);
  const tenantId = t.rows[0].id as string;
  const url = process.env.TENANT_DATABASE_URL_TEMPLATE!.replace('{databaseName}', t.rows[0].database_name);
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  const db = client as never;
  const q = (sql: string, params: unknown[] = []) => client.query(sql, params);
  const log: string[] = [];
  const step = (m: string) => log.push(m);
  const before = (await q(`select count(*)::int n from hrm_schema.shift_definitions where code like 'TMP%'`)).rows[0].n;
  try {
    await q('BEGIN');
    await q(migration('0035-hrm-work-schedules'));
    await q(migration('0036-hrm-work-schedule-rules'));
    step('migration 0035 và 0036 chạy được và idempotent');

    const ids = { e1: 'aaaaaaaa-0000-4000-8000-000000000001', e2: 'aaaaaaaa-0000-4000-8000-000000000002', e3: 'aaaaaaaa-0000-4000-8000-000000000003' };
    for (const [i, id] of Object.values(ids).entries()) {
      await q(`INSERT INTO core_schema.employees (id, tenant_id, full_name) VALUES ($1,$2,$3)`, [id, tenantId, `NV Thử ${i + 1}`]);
      await q(`INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,$3,'2020-01-01')`, [id, tenantId, `TMP${i + 1}`]);
    }
    const shift = async (code: string, start: string, end: string, brk: number, bs: string | null = null, be: string | null = null) =>
      (await q(`INSERT INTO hrm_schema.shift_definitions (tenant_id, code, name, start_time, end_time, break_minutes, break_start_time, break_end_time) VALUES ($1,$2,$2,$3,$4,$5,$6,$7) RETURNING id`, [tenantId, code, start, end, brk, bs, be])).rows[0].id as string;
    const HC = await shift('TMPHC', '08:00', '17:00', 60, '12:00', '13:00');
    const SANG = await shift('TMPSANG', '08:00', '12:00', 0);
    const CN = await shift('TMPCN', '09:00', '15:00', 0);
    const OFFICE = [
      ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'SHIFT' as const, shiftId: HC })),
      { weekday: 6, dayType: 'SHIFT' as const, shiftId: SANG },
      { weekday: 7, dayType: 'OFF' as const },
    ];
    const emps = Object.values(ids);
    const range = { fromDate: '2026-10-05', toDate: '2026-10-11' };
    const day = (employee: string, date: string) => resolveDay(db, tenantId, employee, date, 'Asia/Ho_Chi_Minh');

    // Lịch cố định theo khoảng ngày
    const preview = await previewSchedule(db, tenantId, { scope: { type: 'EMPLOYEES', employeeIds: emps }, pattern: OFFICE, ...range });
    expect(preview.summary).toMatchObject({ insert: 21, conflicts: 0, employees: 3 });
    const applied = await applySchedule(db, tenantId, ACTOR, { scope: { type: 'EMPLOYEES', employeeIds: emps }, pattern: OFFICE, ...range, reason: 'test' });
    expect(applied.appliedDays).toBe(21);
    expect((await q(`SELECT count(*)::int n FROM hrm_schema.work_schedule_audit WHERE tenant_id=$1 AND batch_id=$2`, [tenantId, applied.batchId])).rows[0].n).toBe(3);
    step('gán theo khoảng ngày: 3 nhân viên x 7 ngày, nhật ký 3 dòng');
    const conflict = await applySchedule(db, tenantId, ACTOR, { scope: { type: 'EMPLOYEES', employeeIds: [ids.e1] }, pattern: OFFICE.map((r) => (r.weekday === 1 ? { ...r, shiftId: CN } : r)), ...range }).catch((e) => e);
    expect(conflict.getResponse?.().code).toBe('HRM_SCHEDULE_CONFLICT');
    await q('SAVEPOINT s1');
    const needConfirm = await applySchedule(db, tenantId, ACTOR, { scope: { type: 'EMPLOYEES', employeeIds: [ids.e1] }, pattern: OFFICE.map((r) => (r.weekday === 1 ? { ...r, shiftId: CN } : r)), ...range, conflictMode: 'OVERWRITE_ALL' }).catch((e) => e);
    expect(needConfirm.getResponse?.().code).toBe('HRM_SCHEDULE_CONFIRM_REQUIRED');
    await q('ROLLBACK TO SAVEPOINT s1');
    const over = await applySchedule(db, tenantId, ACTOR, { scope: { type: 'EMPLOYEES', employeeIds: [ids.e1] }, pattern: OFFICE.map((r) => (r.weekday === 1 ? { ...r, shiftId: CN } : r)), ...range, conflictMode: 'OVERWRITE_ALL', confirm: true });
    expect(over.summary.replace).toBe(1);
    expect((await q(`SELECT count(*)::int n FROM hrm_schema.employee_work_days WHERE tenant_id=$1 AND status='CANCELLED'`, [tenantId])).rows[0].n).toBe(1);
    expect((await q(`SELECT count(*)::int n FROM hrm_schema.employee_work_days WHERE tenant_id=$1 AND status='ACTIVE'`, [tenantId])).rows[0].n).toBe(21);
    step('xung đột báo 409, ghi đè cần xác nhận, dòng cũ CANCELLED, vẫn đúng 21 dòng hiệu lực');
    await applySchedule(db, tenantId, ACTOR, { kind: 'EXCEPTION', scope: { type: 'EMPLOYEE', employeeIds: [ids.e1] }, pattern: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, dayType: 'OFF' as const })), fromDate: '2026-10-08', toDate: '2026-10-08', confirm: true, reason: 'nghỉ bù' });
    const hol = await createHoliday(db, tenantId, ACTOR, { name: 'Lễ thử', kind: 'HOLIDAY', fromDate: '2026-10-07', toDate: '2026-10-07', scope: { type: 'COMPANY' }, treatment: 'OFF', paid: true });
    expect((await q(`SELECT day_kind, paid FROM hrm_schema.work_calendar WHERE tenant_id=$1 AND work_date='2026-10-07'`, [tenantId])).rows[0]).toMatchObject({ day_kind: 'HOLIDAY', paid: true });
    expect((await day(ids.e2, '2026-10-07')).scheduleDayType).toBe('HOLIDAY');
    step('ngoại lệ một ngày; ngày lễ công ty tạo dòng work_calendar');

    // Bảng công (lịch cố định)
    const period = (await q(`INSERT INTO hrm_schema.timesheet_periods (tenant_id, period_code, from_date, to_date) VALUES ($1,'TMP-2026-10','2026-10-05','2026-10-11') RETURNING id`, [tenantId])).rows[0].id as string;
    await calculateTimesheet(db, tenantId, period);
    const sheet = async (emp: string) =>
      Object.fromEntries((await q(`SELECT to_char(work_date,'YYYY-MM-DD') d, status, scheduled_minutes, paid_minutes FROM hrm_schema.timesheets WHERE tenant_id=$1 AND employee_id=$2 ORDER BY work_date`, [tenantId, emp])).rows.map((r) => [r.d, `${r.status}/${r.scheduled_minutes}/${r.paid_minutes}`]));
    const t1 = await sheet(ids.e1);
    const t2 = await sheet(ids.e2);
    step(`bảng công e1: ${JSON.stringify(t1)}`);
    step(`bảng công e2: ${JSON.stringify(t2)}`);
    expect(t2['2026-10-07']).toBe('HOLIDAY/480/480');
    expect(t1['2026-10-08']).toMatch(/^OFF/);
    expect(t2['2026-10-08']).toBe('ABSENT/480/0');
    expect(t2['2026-10-10']).toBe('ABSENT/240/0');
    expect(t2['2026-10-11']).toMatch(/^OFF/);
    expect(t1['2026-10-05']).toBe('ABSENT/360/0');
    const cancelH = await cancelHoliday(db, tenantId, ACTOR, hol.id, 'test');
    expect(cancelH.restoredDays).toBe(3);
    expect((await q(`SELECT count(*)::int n FROM hrm_schema.work_calendar WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(0);
    step('huỷ ngày lễ khôi phục 3 ngày và xoá dòng work_calendar do lễ tạo');

    // ===== Lịch định kỳ không có ngày kết thúc =====
    const open = { pattern: OFFICE, fromDate: '2026-11-01' };
    const rulePreview = await previewRule(db, tenantId, { scope: { type: 'COMPANY' }, ...open });
    expect(rulePreview).toMatchObject({ ruleCount: 1, conflictTotal: 0, requiresConfirmation: true });
    expect(rulePreview.employeeCount).toBeGreaterThanOrEqual(3);
    const companyRule = await applyRule(db, tenantId, ACTOR, { scope: { type: 'COMPANY' }, ...open, confirm: true });
    expect(companyRule.ruleCount).toBe(1);
    expect((await day(ids.e2, '2026-11-02')).picked?.source).toBe('RULE'); // thứ Hai
    expect((await day(ids.e2, '2026-11-01')).scheduleDayType).toBe('OFF'); // Chủ nhật
    expect((await day(ids.e2, '2027-06-14')).picked?.source).toBe('RULE'); // không giới hạn thời gian
    step('lịch định kỳ toàn công ty: tra được ca ở nhiều tháng sau, không cần gán lại');

    // nhân viên > công ty
    await applyRule(db, tenantId, ACTOR, { scope: { type: 'EMPLOYEE', employeeIds: [ids.e1] }, pattern: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, dayType: 'SHIFT' as const, shiftId: CN })), fromDate: '2026-11-01' });
    expect((await day(ids.e1, '2026-11-02')).picked?.row.id).toBe(CN);
    expect((await day(ids.e2, '2026-11-02')).picked?.row.id).toBe(HC);
    expect((await day(ids.e1, '2026-11-07')).picked?.row.id).toBe(SANG); // thứ Bảy: lịch riêng không phủ nên rơi xuống lịch công ty
    step('ưu tiên: nhân viên > công ty; thứ không phủ thì rơi xuống lớp dưới');

    // dòng sinh sẵn (ngoại lệ) > lịch định kỳ
    await applySchedule(db, tenantId, ACTOR, { kind: 'EXCEPTION', scope: { type: 'EMPLOYEE', employeeIds: [ids.e1] }, pattern: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, dayType: 'OFF' as const })), fromDate: '2026-11-03', toDate: '2026-11-03', confirm: true });
    expect((await day(ids.e1, '2026-11-03')).scheduleDayType).toBe('OFF');
    expect((await dayContextForDate(client as never, tenantId, ids.e2, '2026-11-04', 'Asia/Ho_Chi_Minh')).shift?.source).toBe('RULE');
    step('ngoại lệ theo ngày thắng lịch định kỳ');

    // Bảng công tháng 11 chạy theo lịch định kỳ
    const p11 = (await q(`INSERT INTO hrm_schema.timesheet_periods (tenant_id, period_code, from_date, to_date) VALUES ($1,'TMP-2026-11','2026-11-01','2026-11-08') RETURNING id`, [tenantId])).rows[0].id as string;
    await calculateTimesheet(db, tenantId, p11);
    const n2 = await sheet(ids.e2);
    const n1 = await sheet(ids.e1);
    step(`bảng công tháng 11 e2: ${JSON.stringify(Object.fromEntries(Object.entries(n2).filter(([d]) => d >= '2026-11-01')))}`);
    expect(n2['2026-11-02']).toBe('ABSENT/480/0');
    expect(n2['2026-11-01']).toMatch(/^OFF/);
    expect(n2['2026-11-07']).toBe('ABSENT/240/0');
    expect(n1['2026-11-02']).toBe('ABSENT/360/0');
    expect(n1['2026-11-03']).toMatch(/^OFF/);

    // Lưới, xuất file có ngày từ lịch định kỳ
    const grid = await queryScheduleGrid(db, tenantId, { from: '2026-11-01', to: '2026-11-30', q: 'TMP' });
    expect(grid.days.some((d) => d.source === 'RULE')).toBe(true);
    expect(grid.days.filter((d) => d.employeeId === ids.e1 && d.date === '2026-11-03')[0].source).toBe('EXCEPTION');
    const exportRows = await queryScheduleExport(db, tenantId, { from: '2026-11-01', to: '2026-11-07', q: 'TMP' });
    expect(exportRows.length).toBe(21);
    step('lưới và xuất file có cả ngày từ lịch định kỳ; dòng sinh sẵn thắng');

    // Thay lịch cùng phạm vi: cắt lịch cũ về ngày liền trước
    const replaceNeedsConfirm = await applyRule(db, tenantId, ACTOR, { scope: { type: 'COMPANY' }, pattern: OFFICE.map((r) => (r.weekday === 1 ? { ...r, shiftId: CN } : r)), fromDate: '2026-11-16', conflictMode: 'OVERWRITE_ALL' }).catch((e) => e);
    expect(replaceNeedsConfirm.getResponse?.().code).toBe('HRM_SCHEDULE_CONFIRM_REQUIRED');
    const replaced = await applyRule(db, tenantId, ACTOR, { scope: { type: 'COMPANY' }, pattern: OFFICE.map((r) => (r.weekday === 1 ? { ...r, shiftId: CN } : r)), fromDate: '2026-11-16', conflictMode: 'OVERWRITE_ALL', confirm: true });
    expect(replaced.changedRules).toBe(1);
    expect((await day(ids.e2, '2026-11-09')).picked?.row.id).toBe(HC); // thứ Hai trước ngày thay
    expect((await day(ids.e2, '2026-11-16')).picked?.row.id).toBe(CN); // thứ Hai sau ngày thay
    const rules = await listRules(db, tenantId, { scopeType: 'COMPANY', status: 'ACTIVE' });
    expect(rules.some((r) => r.effectiveTo === '2026-11-15')).toBe(true);
    expect(rules.some((r) => r.effectiveTo === null)).toBe(true);
    step('thay lịch định kỳ: lịch cũ được cắt đến 15/11, lịch mới chạy từ 16/11');

    // Kết thúc và huỷ
    const newest = rules.find((r) => r.effectiveTo === null)!;
    await endRule(db, tenantId, ACTOR, newest.id, '2026-12-31', 'test');
    expect((await day(ids.e2, '2027-01-04')).picked).toBeNull();
    expect((await day(ids.e2, '2026-12-28')).picked?.row.id).toBe(CN);
    await cancelRule(db, tenantId, ACTOR, newest.id, 'test').catch((e) => expect(e).toBeTruthy());
    step('kết thúc lịch định kỳ: sau ngày kết thúc không còn ca');

    // Tra cứu, sao chép, huỷ (lịch cố định)
    const list = await queryScheduleList(db, tenantId, { from: '2026-10-05', to: '2026-10-11' });
    expect(list.rows.length).toBeGreaterThan(0);
    const audit = await queryScheduleAudit(db, tenantId, { employeeId: ids.e1 });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['SCHEDULE_ASSIGN', 'SCHEDULE_OVERWRITE', 'SCHEDULE_EXCEPTION', 'RULE_CREATE']));
    const copy = await copySchedule(db, tenantId, ACTOR, { sourceEmployeeId: ids.e2, scope: { type: 'EMPLOYEES', employeeIds: [ids.e3] }, ...range, conflictMode: 'OVERWRITE_KEEP_EXCEPTIONS', confirm: true }, false);
    expect(copy.batchId).toBeTruthy();
    const dry = await cancelSchedule(db, tenantId, ACTOR, { scope: { type: 'EMPLOYEES', employeeIds: [ids.e3] }, ...range }, true);
    expect(dry.dayCount).toBe(7);
    await cancelSchedule(db, tenantId, ACTOR, { scope: { type: 'EMPLOYEES', employeeIds: [ids.e3] }, ...range, confirm: true, reason: 'test' });
    expect((await resolveScopeEmployees(db, tenantId, { type: 'COMPANY' }, '2026-10-05', '2026-10-11')).length).toBeGreaterThanOrEqual(3);
    step('danh sách, nhật ký, sao chép, huỷ, phạm vi toàn công ty');
  } finally {
    await q('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
    // eslint-disable-next-line no-console
    console.log(`\n${log.map((l) => `OK  ${l}`).join('\n')}`);
  }
  const check = new Client({ connectionString: url });
  await check.connect();
  const after = (await check.query(`select count(*)::int n from hrm_schema.shift_definitions where code like 'TMP%'`)).rows[0].n;
  const leftover = (await check.query(`select count(*)::int n from hrm_schema.employee_profiles where employee_code like 'TMP%'`)).rows[0].n;
  await check.end();
  expect({ shifts: after, employees: leftover }).toEqual({ shifts: before, employees: 0 });
});
