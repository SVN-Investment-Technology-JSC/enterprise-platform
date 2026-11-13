import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { saveOvertimeCompSettings } from './hrm-overtime-comp-settings.js';
import { overtimeMonthFigures } from './hrm-overtime-month.js';
import { loadOvertimeCompPolicy } from './hrm-overtime-blocks.js';
import { publishPolicyVersion } from './hrm-policy-versions.js';
import { decideTripDayLines, loadTripDayLines, saveTripDayLines, voidTripDayLines } from './hrm-trip-day-lines.js';
import { hrmTransaction } from './hrm-transaction.js';

// Người xác nhận được giả lập: cấu hình người duyệt (tổ chức) không phải đối tượng của bài kiểm tra này.
let designated = true;
jest.mock('./hrm-approval-policy.js', () => ({
  ...jest.requireActual('./hrm-approval-policy.js'),
  isDesignatedDirectApprover: jest.fn(async () => designated),
}));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

// Tạo CSDL thử và chạy toàn bộ migration lâu hơn mức mặc định 5 giây.
jest.setTimeout(120_000);

/**
 * Giờ làm theo ngày của đơn công tác trên PostgreSQL thật: khai dự kiến, khai thực tế, người duyệt xác nhận, tách ca và
 * làm thêm, ghi ca làm thêm vào quỹ, hủy hiệu lực. Ca hành chính 08:00 đến 17:00 nghỉ trưa 60 phút (8 giờ một ngày).
 */
integration('HRM đơn công tác khai giờ theo ngày: PostgreSQL integration', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const actor = randomUUID();
  const approver = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  let shiftId: string;
  let employeeId: string;
  let tripId: string;
  const tx = <T>(work: Parameters<typeof hrmTransaction<T>>[1]) => hrmTransaction(pool, work);

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    const registry = await readFile(resolve(process.cwd(), '../../platform/entitlement/src/lib/tenant-migrations.ts'), 'utf8');
    const registered = [...registry.matchAll(/path:\s*'tenant\/((?:core|hrm)\/[^']+\.sql)'/g)].map((m) => m[1]);
    for (const path of [
      ...registered.filter((f) => f.startsWith('core/')),
      '0001-integration.sql',
      ...registered.filter((f) => f.startsWith('hrm/')),
    ]) {
      const sql = await readFile(resolve(process.cwd(), '../../../migrations/tenant', path), 'utf8');
      await pool.query(`BEGIN;\n${sql}\nCOMMIT;`);
    }
    shiftId = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes)
         VALUES ($1,'DAY','Hành chính','08:00','17:00',false,60,0,0) RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
    employeeId = randomUUID();
    await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, full_name, work_email) VALUES ($1,$2,'NV-A',$3)`, [employeeId, tenantId, `${employeeId}@test.local`]);
    await pool.query(`INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,'NV-A','2010-01-01')`, [employeeId, tenantId]);
    // Mọi ngày là ca hành chính, trừ chủ nhật 19/10/2025 (ngày nghỉ).
    await pool.query(
      `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
       SELECT $1,$2,d::date,CASE WHEN d::date='2025-10-19' THEN 'OFF' ELSE 'SHIFT' END,CASE WHEN d::date='2025-10-19' THEN NULL ELSE $3::uuid END,'MANUAL'
         FROM generate_series('2025-01-01'::date,'2026-12-31'::date,'1 day') d`,
      [tenantId, employeeId, shiftId],
    );
    await tx((db) =>
      publishPolicyVersion(db, tenantId, 'OT', {
        effectiveFrom: '2025-01-01',
        config: { dailyLimitMinutes: 1440, weeklyLimitMinutes: 10080, monthlyLimitMinutes: 44640, yearlyLimitMinutes: 527040, weekdayRate: 1.5, offRate: 2, holidayRate: 3, nightRate: 2 },
        reason: 'Thiết lập thử',
        actorId: actor,
        defaultCode: 'OT_DEFAULT',
        defaultName: 'Quy định tăng ca',
      }),
    );
    // Quy tắc nghỉ bù bật, tách giờ đêm theo khung 22:00 đến 06:00.
    await tx((db) =>
      saveOvertimeCompSettings(db, tenantId, actor, {
        effectiveFrom: '2025-09-01',
        config: { enabled: true, ruleSet: 'NIGHT_REST', monthlyCapHours: 10, declaredNightWindow: true, nightStartMinute: 1320, nightEndMinute: 360 },
        reason: 'Bật quy tắc để thử',
      }),
    );
    // Đơn công tác 12 đến 19/10/2025 đã duyệt.
    tripId = (
      await pool.query(
        `INSERT INTO hrm_schema.business_trip_requests (tenant_id,employee_id,business_trip_type,destination,from_date,to_date,days_count,status,reason)
         VALUES ($1,$2,'DOMESTIC','Hà Nội','2025-10-12','2025-10-19',8,'APPROVED','Khảo sát') RETURNING id`,
        [tenantId, employeeId],
      )
    ).rows[0].id;
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid DB');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });

  const blocks = async () =>
    (
      await pool.query(
        `SELECT b.hours::float AS hours,b.ot_hours_final::float AS ot,b.night_hours_final::float AS night,b.rule_set,b.source,b.period_month
           FROM hrm_schema.overtime_blocks b JOIN hrm_schema.business_trip_day_lines l ON l.id=b.trip_day_line_id
          WHERE l.trip_request_id=$1 ORDER BY b.start_at`,
        [tripId],
      )
    ).rows;

  it('cấu hình tách giờ đêm được lưu và đọc lại', async () => {
    const { policy } = await tx((db) => loadOvertimeCompPolicy(db, tenantId, '2025-10', employeeId));
    expect(policy).toMatchObject({ enabled: true, declaredNightWindow: true, nightStartMinute: 1320 });
  });

  it('giờ dự kiến chỉ để xem trước: tách ca và làm thêm nhưng chưa ghi vào quỹ', async () => {
    const saved = await tx((db) =>
      saveTripDayLines(db, tenantId, actor, employeeId, tripId, {
        mode: 'PLANNED',
        lines: [{ date: '2025-10-12', windows: [{ from: '18:00', to: '05:00' }] }],
      }),
    );
    const day = saved.lines.find((l) => l.date === '2025-10-12')!;
    expect(day).toMatchObject({ status: 'PLANNED', scheduledMinutes: 480, normalMinutes: 480, otMinutes: 180, nightMinutes: 180 });
    expect(await blocks()).toHaveLength(0);
  });

  it('giờ thực tế: ngày chưa tới, ngày sai khung và khung chồng nhau bị từ chối; hợp lệ thì chờ duyệt', async () => {
    await expect(
      tx((db) => saveTripDayLines(db, tenantId, actor, employeeId, tripId, { mode: 'ACTUAL', lines: [{ date: '2025-10-30', windows: [{ from: '08:00', to: '09:00' }] }] })),
    ).rejects.toThrow('ngoài thời gian');
    await expect(
      tx((db) =>
        saveTripDayLines(db, tenantId, actor, employeeId, tripId, {
          mode: 'ACTUAL',
          lines: [{ date: '2025-10-13', windows: [{ from: '08:00', to: '12:00' }, { from: '11:00', to: '13:00' }] }],
        }),
      ),
    ).rejects.toThrow('chồng nhau');
    await expect(
      tx((db) => saveTripDayLines(db, tenantId, randomUUID(), randomUUID(), tripId, { mode: 'ACTUAL', lines: [{ date: '2025-10-13', windows: [{ from: '08:00', to: '09:00' }] }] })),
    ).rejects.toThrow('người đi công tác');
    const saved = await tx((db) =>
      saveTripDayLines(db, tenantId, actor, employeeId, tripId, {
        mode: 'ACTUAL',
        lines: [
          { date: '2025-10-12', windows: [{ from: '18:00', to: '05:00' }] },
          { date: '2025-10-13', windows: [{ from: '18:00', to: '03:00' }] },
          { date: '2025-10-18', windows: [{ from: '08:00', to: '12:00' }, { from: '13:00', to: '23:00' }] },
          { date: '2025-10-19', windows: [{ from: '13:30', to: '17:30' }] },
        ],
      }),
    );
    expect(saved.lines.filter((l) => l.status === 'ACTUAL_PENDING')).toHaveLength(4);
    expect(await blocks()).toHaveLength(0);
    // Ngày 12 khai 18h đến 5h, ngày 13 bắt đầu 18h: sáng 13 nghỉ.
    expect(saved.lines.find((l) => l.date === '2025-10-12')?.restsNextMorning).toBe(true);
  });

  it('người không được giao duyệt, và nhân viên tự duyệt, đều bị từ chối', async () => {
    designated = false;
    await expect(tx((db) => decideTripDayLines(db, tenantId, approver, tripId, { decision: 'APPROVE' }))).rejects.toThrow('quản lý trực tiếp');
    designated = true;
    await expect(tx((db) => decideTripDayLines(db, tenantId, approver, tripId, { decision: 'REJECT' }))).rejects.toThrow('lý do');
    expect(await blocks()).toHaveLength(0);
  });

  it('duyệt giờ thực tế: giờ làm thêm vào ca làm thêm, tách giờ đêm và vào số liệu tháng', async () => {
    const result = await tx((db) => decideTripDayLines(db, tenantId, approver, tripId, { decision: 'APPROVE' }));
    expect(result.lines.filter((l) => l.status === 'ACTUAL_APPROVED')).toHaveLength(4);
    const rows = await blocks();
    // Ngày 12: 3 giờ (02:00 đến 05:00 đều trong khung đêm); ngày 13: 1 giờ (02:00 đến 03:00); ngày 18: khai 4 + 10 giờ, ca 8 giờ nên
    // còn 6 giờ làm thêm (17:00 đến 23:00, có 1 giờ đêm); ngày 19 là ngày nghỉ nên cả 4 giờ là làm thêm.
    expect(rows.map((r) => [r.hours, r.ot, r.night])).toEqual([
      [3, 0, 3],
      [1, 0, 1],
      [6, 5, 1],
      [4, 4, 0],
    ]);
    expect(rows.every((r) => r.rule_set === 'DECLARED' && r.source === 'CT_DECLARED' && r.period_month === '2025-10')).toBe(true);
    const { policy } = await tx((db) => loadOvertimeCompPolicy(db, tenantId, '2025-10', employeeId));
    const figures = await overtimeMonthFigures(pool, tenantId, '2025-10', policy, [employeeId]);
    expect(figures[0]).toMatchObject({ blockCount: 4, actualOtHours: 9, nightHours: 5 });
  });

  it('giờ thực tế đã duyệt không sửa lại; đơn bị hủy hiệu lực thì xóa ca làm thêm', async () => {
    await expect(
      tx((db) => saveTripDayLines(db, tenantId, actor, employeeId, tripId, { mode: 'ACTUAL', lines: [{ date: '2025-10-12', windows: [{ from: '18:00', to: '04:00' }] }] })),
    ).rejects.toThrow('đã được duyệt');
    await tx((db) => voidTripDayLines(db, tenantId, actor, tripId, 'Sai thông tin'));
    expect(await blocks()).toHaveLength(0);
    const after = await tx((db) => loadTripDayLines(db, tenantId, tripId));
    expect(after.lines.find((l) => l.date === '2025-10-12')?.status).toBe('ACTUAL_REJECTED');
  });
});
