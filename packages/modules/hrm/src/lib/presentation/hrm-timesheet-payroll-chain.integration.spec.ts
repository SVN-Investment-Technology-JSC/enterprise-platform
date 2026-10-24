import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import { ingestEvent } from '../infrastructure/hrm-attendance-ingest';
import { transitionLeave } from '../infrastructure/hrm-leave-operations';
import { approveOvertime } from '../infrastructure/hrm-overtime';
import { payrollTrace } from '../infrastructure/hrm-payroll-trace';
import { approveBusinessTrip } from '../infrastructure/hrm-request-transition';
import { approveShiftChange } from '../infrastructure/hrm-shift-change';
import { testApprovalPolicy } from '../infrastructure/hrm-test-support';
import { hrmTransaction } from '../infrastructure/hrm-transaction';
import { applySchedule, previewSchedule } from '../infrastructure/hrm-work-schedule';
import {
  adjustMonthDay,
  calculateMonth,
  closeMonth,
  closeMonthRequests,
  monthCloseState,
  parseMonth,
  reopenMonth,
} from '../infrastructure/hrm-timesheet-month';
import { loadBoard } from '../infrastructure/hrm-timesheet-board';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmPayrollController } from './hrm-payroll.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { HrmRequestController } from './hrm-request.controller';
import { HrmTripAllowanceController } from './hrm-trip-allowance.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));

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

const MONTH = '2026-08';
/** Thứ Hai đến thứ Sáu của tháng 8/2026 (1/8 là thứ Bảy): 21 ngày làm việc. */
const WORKDAYS = [
  '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
  '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
  '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21',
  '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28',
  '2026-08-31',
];
const TODAY = '2026-09-15';

integration('Chuỗi phân ca - chấm công - đơn từ - bảng công - bảng lương (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const approverId = randomUUID();
  const empA = randomUUID();
  const empB = randomUUID();
  const req = { headers: {} } as Request;
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let shiftId: string;
  let paidLeave: string;
  let unpaidLeave: string;
  let otReason: string;
  let tripReason: string;
  let periodId: string;
  let payrollPeriodId: string;
  let runId: string;

  const range = parseMonth(MONTH);
  const tx = <T>(work: (db: PoolClient) => Promise<T>) => hrmTransaction(pool as unknown as Pool, work);
  const principal = { userId: userA, permissions: ['hrm.manage'] };
  const approver = { userId: approverId, permissions: ['hrm.manage'] };
  const ctx = (who: { userId: string; permissions: string[] } = principal, employeeId = empA) =>
    ({
      has: () => true,
      getProxyRequestContext: async function (this: any, req: any, requested?: string) {
        return { ...(await this.getRequestContext(req, requested)), onBehalf: undefined };
      },
      getRequestContext: async (_req: Request, requested?: string) => ({
        pool,
        tenantId,
        employeeId: requested ?? employeeId,
        principal: who,
      }),
      scoped: async (_req: Request, _permission: string, requested?: string) => ({
        pool,
        tenantId,
        employeeId: requested,
        principal: who,
      }),
      getContext: async () => ({ pool, tenantId, principal: who }),
      resolveEmployee: async () => ({ employeeId }),
      procedureAvailable: async () => false,
    }) as any;
  const bridge = { startOrResume: jest.fn() } as any;
  const leaveController = () => new HrmLeaveController(ctx(), bridge, testApprovalPolicy());
  const requestController = () => new HrmRequestController(ctx(), bridge, testApprovalPolicy());

  const punch = (employeeId: string, userId: string, date: string, kind: 'IN' | 'OUT', hhmm: string) =>
    ingestEvent(pool as unknown as Pool, tenantId, userId, {
      employeeId,
      kind,
      // Giờ Việt Nam (UTC+7) sang UTC.
      occurredAt: new Date(`${date}T${hhmm}:00+07:00`).toISOString(),
      source: 'BIOMETRIC_DEVICE',
      externalEventId: randomUUID(),
    });
  const normalDay = async (employeeId: string, userId: string, date: string, out = '17:00') => {
    await punch(employeeId, userId, date, 'IN', '08:00');
    await punch(employeeId, userId, date, 'OUT', out);
  };
  const row = async (employeeId: string, date: string) =>
    (
      await pool.query(
        `SELECT t.*, to_char(t.work_date,'YYYY-MM-DD') AS d FROM hrm_schema.timesheets t WHERE t.tenant_id=$1 AND t.period_id=$2 AND t.employee_id=$3 AND t.work_date=$4::date`,
        [tenantId, periodId, employeeId, date],
      )
    ).rows[0];
  const items = async (employeeId: string) =>
    Object.fromEntries(
      (
        await pool.query(
          `SELECT item_code, amount::float AS amount FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND payroll_run_id=$2 AND employee_id=$3`,
          [tenantId, runId, employeeId],
        )
      ).rows.map((r) => [r.item_code, r.amount]),
    ) as Record<string, number>;

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));

    for (const [user, name] of [[userA, 'Nguyễn Văn An'], [userB, 'Trần Thị Bình'], [approverId, 'Người duyệt']] as const)
      await pool.query(
        `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,$2,$3,'test')`,
        [user, name, `${user}@example.test`],
      );
    for (const [emp, user, name, code, inactive] of [
      [empA, userA, 'Nguyễn Văn An', 'NV001', null],
      [empB, userB, 'Trần Thị Bình', 'NV002', '2026-08-17'],
    ] as const) {
      await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name) VALUES ($1,$2,$3,$4)`, [emp, tenantId, user, name]);
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date, inactive_from) VALUES ($1,$2,$3,'2026-01-01',$4)`,
        [emp, tenantId, code, inactive],
      );
      await pool.query(
        `INSERT INTO hrm_schema.employee_salary_profiles (tenant_id,employee_id,salary_type,base_salary,effective_from) VALUES ($1,$2,'GROSS',21000000,'2026-01-01')`,
        [tenantId, emp],
      );
    }
    // Ca hành chính 08:00-17:00, nghỉ trưa 12:00-13:00 (480 phút); thứ Hai đến thứ Sáu đi làm, thứ Bảy và Chủ nhật OFF.
    shiftId = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes,break_start_time,break_end_time)
         VALUES ($1,'DAY','Hành chính','08:00','17:00',false,60,0,0,'12:00','13:00') RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
    for (const emp of [empA, empB])
      await pool.query(
        `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
         SELECT $1,$2,d::date,CASE WHEN extract(isodow FROM d) >= 6 THEN 'OFF' ELSE 'SHIFT' END,
                CASE WHEN extract(isodow FROM d) >= 6 THEN NULL ELSE $3::uuid END,'MANUAL'
           FROM generate_series('2026-08-01'::date,'2026-08-31'::date,'1 day') d`,
        [tenantId, emp, shiftId],
      );
    const leaveType = async (code: string, paid: boolean) =>
      (
        await pool.query(
          `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,paid,deduct_balance) VALUES ($1,$2,$2,'DAYS',$3,false) RETURNING id`,
          [tenantId, code, paid],
        )
      ).rows[0].id as string;
    paidLeave = await leaveType('NGHI_CO_LUONG', true);
    unpaidLeave = await leaveType('NGHI_KHONG_LUONG', false);
    const reason = async (kind: string, code: string) =>
      (
        await pool.query(`INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name) VALUES ($1,$2,$3,$3) RETURNING id`, [tenantId, kind, code])
      ).rows[0].id as string;
    otReason = await reason('OVERTIME', 'OT_WORK');
    // Lý do tăng ca có hệ số riêng (cấu hình động) thay hệ số ngày thường của chính sách OT (1,5).
    await pool.query(`UPDATE hrm_schema.request_reasons SET rate_multiplier=2 WHERE id=$1`, [otReason]);
    tripReason = await reason('BUSINESS_TRIP', 'TRIP_PLAN');
    await new HrmPayrollSettingsController(ctx()).overtime(req, {
      effectiveFrom: '2025-01-01',
      reason: 'Thiết lập chính sách OT',
      dailyLimitMinutes: 240,
      weeklyLimitMinutes: 1200,
      monthlyLimitMinutes: 2400,
      yearlyLimitMinutes: 12000,
      weekdayRate: 1.5,
      offRate: 2,
      holidayRate: 3,
      nightRate: 2,
    });
    // Công thức lương: lương theo công + làm thêm giờ + công tác phí.
    const policy = await pool.query(
      `INSERT INTO hrm_schema.policies (tenant_id,code,name,policy_type) VALUES ($1,'PAYROLL','PAYROLL','PAYROLL') RETURNING id`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.policy_versions (policy_id,version_no,effective_from,config_json,status) VALUES ($1,1,'2026-01-01',$2,'ACTIVE')`,
      [
        policy.rows[0].id,
        JSON.stringify({
          salaryType: 'GROSS',
          components: [
            { code: 'SALARY', name: 'Lương theo công', type: 'EARNING', formula: 'PRORATED_BASE_PAY' },
            { code: 'OT_PAY', name: 'Làm thêm giờ', type: 'OVERTIME', formula: 'BASE_SALARY / SCHEDULED_MINUTES * WEIGHTED_OT_MINUTES' },
            { code: 'TRIP', name: 'Công tác phí', type: 'ALLOWANCE', formula: 'TRIP_ALLOWANCE_AMOUNT' },
            { code: 'NET', name: 'Thực lĩnh', type: 'NET_PAY', formula: 'SALARY + OT_PAY + TRIP' },
          ],
        }),
      ],
    );
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  it('đơn từ: nghỉ cả ngày, nghỉ nửa ngày, nghỉ không lương, làm thêm giờ, công tác đều được tạo và duyệt', async () => {
    const leave = (leaveTypeId: string, fromAt: string, toAt: string) =>
      leaveController().createLeaveRequest(req, { employeeId: empA, leaveTypeId, fromAt, toAt } as any);
    const approveLeave = (id: string) => tx((db) => transitionLeave(db, tenantId, approverId, id, 'APPROVED'));
    await approveLeave((await leave(paidLeave, '2026-08-04T08:00', '2026-08-04T17:00')).data.id);
    await approveLeave((await leave(paidLeave, '2026-08-05T08:00', '2026-08-05T12:00')).data.id);
    await approveLeave((await leave(unpaidLeave, '2026-08-10T08:00', '2026-08-10T17:00')).data.id);
    const ot = await requestController().createOtRequest(req, {
      employeeId: empA,
      reasonId: otReason,
      fromAt: '2026-08-06T18:00',
      toAt: '2026-08-06T20:00',
    } as any);
    await tx((db) => approveOvertime(db, tenantId, approverId, ot.data.id));
    const trip = await requestController().createBusinessTripRequest(req, {
      employeeId: empA,
      reasonId: tripReason,
      destination: 'Đà Nẵng',
      businessTripType: 'DOMESTIC',
      fromAt: '2026-08-07T08:00',
      toAt: '2026-08-07T17:00',
    } as any);
    await tx((db) => approveBusinessTrip(db, tenantId, approverId, trip.data.id));
    const approved = await pool.query(
      `SELECT (SELECT count(*) FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='APPROVED')::int AS leaves,
              (SELECT count(*) FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND status='APPROVED')::int AS ots,
              (SELECT count(*) FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 AND status='APPROVED')::int AS trips`,
      [tenantId],
    );
    expect(approved.rows[0]).toEqual({ leaves: 3, ots: 1, trips: 1 });
  });

  it('phân ca không được làm lệch đơn nghỉ đã duyệt: xem trước báo xung đột, áp dụng bị chặn 409', async () => {
    const input = {
      kind: 'EXCEPTION' as const,
      scope: { type: 'EMPLOYEE' as const, employeeIds: [empA] },
      pattern: [{ weekday: 2, dayType: 'OFF' as const, shiftId: null }],
      fromDate: '2026-08-04',
      toDate: '2026-08-04',
      conflictMode: 'OVERWRITE_ALL' as const,
    };
    const preview = await tx((db) => previewSchedule(db as any, tenantId, input));
    expect(preview.blockingRequestConflictTotal).toBe(1);
    expect(preview.requestConflicts[0]).toMatchObject({ employeeCode: 'NV001', date: '2026-08-04', kind: 'LEAVE', status: 'APPROVED' });
    await expect(tx((db) => applySchedule(db as any, tenantId, userA, input))).rejects.toMatchObject({
      status: 409,
      response: { code: 'HRM_SCHEDULE_REQUEST_CONFLICT', requestConflictTotal: 1 },
    });
    // Ngày không có đơn thì đổi ca bình thường (không bị chặn).
    const free = await tx((db) =>
      previewSchedule(db as any, tenantId, { ...input, fromDate: '2026-08-11', toDate: '2026-08-11' }),
    );
    expect(free.blockingRequestConflictTotal).toBe(0);
  });

  it('chấm công thực tế: bảng công xem trực tiếp cho kết quả đúng theo đơn trước khi chốt', async () => {
    const closedByRequest = new Set(['2026-08-04', '2026-08-07', '2026-08-10']);
    for (const date of WORKDAYS) {
      if (closedByRequest.has(date)) continue;
      if (date === '2026-08-05') {
        // Nghỉ sáng có đơn: vào đúng 13:00 buổi chiều, không bị tính đi trễ.
        await punch(empA, userA, date, 'IN', '13:00');
        await punch(empA, userA, date, 'OUT', '17:00');
      } else if (date === '2026-08-06') await normalDay(empA, userA, date, '20:00');
      else await normalDay(empA, userA, date);
    }
    // Nhân viên B nghỉ việc từ 17/8: chỉ có công đến 14/8.
    for (const date of WORKDAYS.filter((d) => d <= '2026-08-14')) await normalDay(empB, userB, date);

    // Đơn tuỳ chỉnh đã duyệt (không ảnh hưởng công) vẫn hiện ở ngày công để người dùng xem đủ đơn từ.
    await pool.query(
      `INSERT INTO hrm_schema.custom_requests (tenant_id,type_id,type_code,type_name,employee_id,from_at,to_at,reason_name,reason,status,submitted_by)
       VALUES ($1,gen_random_uuid(),'XIN_DI_MUON','Xin đi muộn',$2,'2026-08-12T01:00:00Z','2026-08-12T02:00:00Z','Việc cá nhân','Đưa con đi khám','APPROVED',$3)`,
      [tenantId, empA, userA],
    );
    const board = await tx((db) =>
      loadBoard(db, tenantId, { from: range.from, to: range.to, employeeIds: [empA, empB], today: TODAY }),
    );
    const a = board.employees.find((e) => e.employeeId === empA)!;
    // Chi tiết đơn ở từng ngày: loại đơn, ngày giờ, lý do, hệ số tăng ca, hình thức công tác.
    expect(a.days['2026-08-06'].requests).toEqual([
      expect.objectContaining({ kind: 'OT', status: 'APPROVED', otRate: 2, reasonName: 'OT_WORK', minutes: 120, fromAt: expect.any(String), toAt: expect.any(String) }),
    ]);
    expect(a.days['2026-08-07'].requests?.[0]).toMatchObject({ kind: 'TRIP', tripType: 'DOMESTIC' });
    expect(a.days['2026-08-04'].requests?.[0]).toMatchObject({ kind: 'LEAVE', status: 'APPROVED' });
    expect(a.days['2026-08-12'].requests).toEqual([
      expect.objectContaining({ kind: 'CUSTOM', label: 'Xin đi muộn', reasonName: 'Việc cá nhân', description: 'Đưa con đi khám', status: 'APPROVED' }),
    ]);
    expect(a.days['2026-08-04']).toMatchObject({ status: 'PAID_LEAVE', paidMinutes: 480, anomalies: [] });
    expect(a.days['2026-08-05']).toMatchObject({ lateMinutes: 0, paidMinutes: 480, status: 'PAID_LEAVE' });
    expect(a.days['2026-08-06']).toMatchObject({ otMinutes: 120 });
    expect(a.days['2026-08-06'].sources?.map((s) => s.kind)).toEqual(['OT']);
    expect(a.days['2026-08-07']).toMatchObject({ status: 'TRIP', paidMinutes: 480 });
    expect(a.days['2026-08-10']).toMatchObject({ status: 'UNPAID_LEAVE', paidMinutes: 0 });
    expect(a.totals.abnormalDays).toBe(0);
    // Công chuẩn hiển thị trên bảng công: chưa cấu hình nên là công chuẩn động theo số ngày có lịch (21 ngày công tháng 8/2026).
    expect(a.standard).toEqual({ mode: 'DYNAMIC', workdays: 21 });
  });

  it('tính công rồi chốt công: không còn bất thường, mỗi ngày truy vết được về đơn gốc', async () => {
    const state = await tx(async (db) => {
      await closeMonthRequests(db, tenantId, userA, range);
      return monthCloseState(db, tenantId, range, TODAY);
    });
    expect(state.blockersForLock).toEqual([]);
    const result = await tx((db) => calculateMonth(db, tenantId, userA, range));
    // Nhân viên A có 31 dòng, B có 16 dòng (đến hết 16/8, nghỉ việc từ 17/8).
    expect(result).toEqual({ count: 47, abnormal: 0 });
    await tx((db) => closeMonth(db, tenantId, userA, range, TODAY));
    periodId = (await pool.query(`SELECT id FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND period_code=$2 AND status='LOCKED'`, [tenantId, MONTH])).rows[0].id;

    const halfLeave = await row(empA, '2026-08-05');
    expect(halfLeave).toMatchObject({ paid_minutes: 480, late_minutes: 0, status: 'LEAVE' });
    expect(halfLeave.sources).toEqual([expect.objectContaining({ kind: 'LEAVE', minutes: 240 })]);
    const ot = await row(empA, '2026-08-06');
    expect(ot).toMatchObject({ ot_minutes: 120, paid_minutes: 480 });
    expect(ot.ot_request_id).toBeTruthy();
    expect(ot.sources.map((s: { kind: string }) => s.kind)).toEqual(['OT']);
    const trip = await row(empA, '2026-08-07');
    expect(trip).toMatchObject({ status: 'BUSINESS_TRIP', paid_minutes: 480 });
    expect(trip.business_trip_request_id).toBeTruthy();
    expect(await row(empA, '2026-08-10')).toMatchObject({ status: 'LEAVE', paid_minutes: 0 });
    // Nhân viên B không có dòng công sau ngày nghỉ việc.
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM hrm_schema.timesheets WHERE tenant_id=$1 AND period_id=$2 AND employee_id=$3 AND work_date>='2026-08-17'`,
      [tenantId, periodId, empB],
    );
    expect(after.rows[0].n).toBe(0);
  });

  it('chưa có mức công tác phí: tính lương báo rõ thay vì trả thiếu', async () => {
    const pay = new HrmPayrollController(ctx());
    // Bảng công đã khóa trước khi cấu hình mức: dòng 7/8 chưa có mức. Cấu hình mức rồi mở lại, tính lại, chốt lại.
    const created = await pay.createPeriod(req, {
      periodCode: 'PAY-2026-08',
      fromDate: range.from,
      toDate: range.to,
      timesheetPeriodId: periodId,
      paymentDate: '2026-09-05',
    });
    payrollPeriodId = created.data.id;
    const run = await pay.createRun(req, payrollPeriodId);
    runId = run.data.id;
    await expect(pay.calculateRun(req, runId)).rejects.toThrow(/mức công tác phí/);

    // Một kỳ công chỉ có một kỳ lương.
    await expect(
      pay.createPeriod(req, {
        periodCode: 'PAY-2026-08-B',
        fromDate: range.from,
        toDate: range.to,
        timesheetPeriodId: periodId,
        paymentDate: '2026-09-06',
      }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'HRM_PAYROLL_PERIOD_EXISTS' } });

    await new HrmTripAllowanceController(ctx()).create(req, {
      tripType: 'DOMESTIC',
      dailyAmount: 300000,
      effectiveFrom: '2026-01-01',
    });
    // Mở lại tháng: lương về nháp, bảng công mở khóa để tính lại với mức vừa cấu hình.
    await tx((db) => reopenMonth(db, tenantId, userA, range, 'Cấu hình công tác phí'));
    const reopenedRun = await pool.query(`SELECT status, calculated_at FROM hrm_schema.payroll_runs WHERE id=$1`, [runId]);
    expect(reopenedRun.rows[0]).toMatchObject({ status: 'DRAFT', calculated_at: null });
    await tx(async (db) => {
      await closeMonthRequests(db, tenantId, userA, range);
      await closeMonth(db, tenantId, userA, range, TODAY);
    });
    expect((await row(empA, '2026-08-07')).calculation_snapshot).toMatchObject({ tripAllowanceAmount: 300000 });
  });

  it('bảng lương theo công đã khóa: lương, làm thêm giờ, công tác phí khớp công thức; người nghỉ việc giữa kỳ trả theo ngày làm', async () => {
    const pay = new HrmPayrollController(ctx());
    await pay.calculateRun(req, runId);
    const a = await items(empA);
    // Công hưởng lương 20/21 ngày: nghỉ không lương 10/8 không được trả. 21.000.000 * 9600 / 10080.
    expect(a.SALARY).toBeCloseTo(20_000_000, 0);
    // 120 phút OT * hệ số của lý do 2 (không phải 1,5 của chính sách) = 240 phút quy đổi: 21.000.000 / 10080 * 240.
    expect(a.OT_PAY).toBeCloseTo(500_000, 0);
    expect(a.TRIP).toBe(300_000);
    expect(a.NET).toBeCloseTo(20_800_000, 0);
    const b = await items(empB);
    // Nghỉ việc từ 17/8: 10 ngày làm trên công chuẩn của kỳ (21 ngày) = 10.000.000, không phải 21.000.000.
    expect(b.SALARY).toBeCloseTo(10_000_000, 0);
    expect(b.TRIP).toBe(0);
    const fingerprint = (await pool.query(`SELECT timesheet_fingerprint FROM hrm_schema.payroll_runs WHERE id=$1`, [runId])).rows[0];
    expect(fingerprint.timesheet_fingerprint).toMatch(/^47\|/);
  });

  it('công chuẩn cố định: mẫu số là số ngày công cấu hình dù tháng có bao nhiêu ngày nghỉ; đổi lại động thì về như cũ', async () => {
    const pay = new HrmPayrollController(ctx());
    const setStandard = (patch: Record<string, unknown>) =>
      pool.query(
        `UPDATE hrm_schema.policy_versions v SET config_json = (config_json - 'standardWorkMode' - 'standardWorkdays' - 'standardMinutes') || $2::jsonb
           FROM hrm_schema.policies p WHERE p.id=v.policy_id AND p.tenant_id=$1 AND p.policy_type='PAYROLL'`,
        [tenantId, JSON.stringify(patch)],
      );
    // Tháng 8/2026 có 21 ngày công (10080 phút). Cố định 24 công = 11520 phút.
    await setStandard({ standardWorkMode: 'FIXED', standardWorkdays: 24 });
    await pay.calculateRun(req, runId);
    const a = await items(empA);
    // 21.000.000 * 9600 / 11520 = 17.500.000 (công chuẩn cố định lớn hơn công thực tế của tháng).
    expect(a.SALARY).toBeCloseTo(17_500_000, 0);
    // Người nghỉ việc giữa kỳ cũng chia cho công chuẩn cố định: 10 ngày làm = 4800 phút / 11520.
    expect((await items(empB)).SALARY).toBeCloseTo(8_750_000, 0);
    // Mẫu số của kỳ và công chuẩn theo ngày công được lưu ở bảng tổng hợp để đối soát.
    const stored = (
      await pool.query(
        `SELECT calculation_snapshot FROM hrm_schema.payroll_items WHERE payroll_run_id=$1 AND employee_id=$2 AND item_code='SALARY'`,
        [runId, empA],
      )
    ).rows[0].calculation_snapshot;
    expect(JSON.stringify(stored)).toContain('STANDARD_WORKDAYS');
    // Công chuẩn động trở lại: theo ngày công thực tế của tháng.
    await setStandard({ standardWorkMode: 'DYNAMIC' });
    await pay.calculateRun(req, runId);
    expect((await items(empA)).SALARY).toBeCloseTo(20_000_000, 0);
    expect((await items(empB)).SALARY).toBeCloseTo(10_000_000, 0);
  });

  it('truy vết lương về từng ngày công và đơn gốc, đối soát khớp với số đã dùng để tính', async () => {
    const trace = await payrollTrace(pool as any, tenantId, runId, empA);
    expect(trace.reconciled).toBe(true);
    expect(trace.differences).toEqual([]);
    expect(trace.totals).toMatchObject({ scheduledMinutes: 10080, paidMinutes: 9600, otMinutes: 120, tripAllowanceAmount: 300000 });
    const kinds = trace.days.flatMap((d) => d.sources.map((s) => s.kind)).sort();
    expect(kinds).toEqual(['LEAVE', 'LEAVE', 'LEAVE', 'OT', 'TRIP']);
    expect(trace.run.stale).toBe(false);
    const snapshot = (
      await pool.query(
        `SELECT calculation_snapshot FROM hrm_schema.payroll_items WHERE payroll_run_id=$1 AND employee_id=$2 AND item_code='SALARY'`,
        [runId, empA],
      )
    ).rows[0].calculation_snapshot;
    expect(snapshot.sources.leaveIds).toHaveLength(3);
    expect(snapshot.sources.otIds).toHaveLength(1);
    expect(snapshot.sources.tripIds).toHaveLength(1);
    expect(snapshot.sources.tripAllowance).toEqual([expect.objectContaining({ date: '2026-08-07', amount: 300000 })]);
  });

  it('bảng công đổi sau khi tính lương: truy vết báo lệch và chốt lương bị chặn', async () => {
    const before = await row(empA, '2026-08-12');
    await pool.query(`UPDATE hrm_schema.timesheets SET paid_minutes = paid_minutes - 60, updated_at = clock_timestamp() WHERE id=$1`, [before.id]);
    const trace = await payrollTrace(pool as any, tenantId, runId, empA);
    expect(trace.reconciled).toBe(false);
    expect(trace.run.stale).toBe(true);
    expect(trace.differences.join(' ')).toMatch(/PAID_MINUTES/);
    await expect(new HrmPayrollController(ctx(approver)).finalizeRun(req, runId)).rejects.toMatchObject({
      response: { code: 'HRM_PAYROLL_STALE' },
    });
    await pool.query(`UPDATE hrm_schema.timesheets SET paid_minutes = $2, updated_at = clock_timestamp() WHERE id=$1`, [before.id, before.paid_minutes]);
  });

  it('nhiều nhân viên lỗi: một lần tính liệt kê đủ từng người thay vì dừng ở người đầu tiên', async () => {
    await pool.query(`UPDATE hrm_schema.employee_salary_profiles SET status='CANCELLED' WHERE tenant_id=$1`, [tenantId]);
    const error = await new HrmPayrollController(ctx()).calculateRun(req, runId).catch((e) => e);
    expect(error.getResponse()).toMatchObject({ code: 'HRM_PAYROLL_EMPLOYEE_ERRORS' });
    expect(error.getResponse().errors).toHaveLength(2);
    expect(error.message).toMatch(/Không tính được lương cho 2 nhân viên/);
    await pool.query(`UPDATE hrm_schema.employee_salary_profiles SET status='ACTIVE' WHERE tenant_id=$1`, [tenantId]);
  });

  it('bảng công mở lại sau khi tính lương: lương về nháp; điều chỉnh công chỉ làm được khi chưa khóa', async () => {
    await tx((db) => reopenMonth(db, tenantId, userA, range, 'Điều chỉnh công'));
    expect((await pool.query(`SELECT status FROM hrm_schema.payroll_runs WHERE id=$1`, [runId])).rows[0].status).toBe('DRAFT');
    await tx((db) => calculateMonth(db, tenantId, userA, range));
    await expect(
      tx((db) => adjustMonthDay(db, tenantId, userA, range, empA, '2026-08-11', { paidMinutes: 240, reason: 'Có đơn giấy xin về sớm' })),
    ).resolves.toMatchObject({ paid_minutes: 240, is_manually_adjusted: true });
    const adjusted = await row(empA, '2026-08-11');
    expect(adjusted).toMatchObject({ paid_minutes: 240, status: 'ADJUSTED' });
    await tx(async (db) => {
      await closeMonthRequests(db, tenantId, userA, range);
      await closeMonth(db, tenantId, userA, range, TODAY);
    });
    // Chốt lại giữ dòng đã điều chỉnh; lương tính lại theo công mới (thiếu 240 phút).
    await new HrmPayrollController(ctx()).calculateRun(req, runId);
    expect((await items(empA)).SALARY).toBeCloseTo((21_000_000 * 9360) / 10080, 0);
  });

  describe('đổi ca theo đơn (tháng 9/2026)', () => {
    let shift2: string;
    let changeReason: string;
    const scheduleOf = async (date: string) =>
      (
        await pool.query(
          `SELECT day_type, shift_id, source FROM hrm_schema.employee_work_days WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$3::date AND status='ACTIVE'`,
          [tenantId, empA, date],
        )
      ).rows[0];
    const changeRequest = async (fromDate: string, toDate: string) =>
      (
        await requestController().createShiftChangeRequest(req, {
          employeeId: empA,
          changeType: 'CHANGE_SHIFT',
          currentShiftId: shiftId,
          requestedShiftId: shift2,
          fromDate,
          toDate,
          reasonId: changeReason,
        } as any)
      ).data.id as string;

    beforeAll(async () => {
      shift2 = (
        await pool.query(
          `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes,break_start_time,break_end_time)
           VALUES ($1,'CA2','Ca muộn','09:00','18:00',false,60,0,0,'13:00','14:00') RETURNING id`,
          [tenantId],
        )
      ).rows[0].id;
      changeReason = (
        await pool.query(`INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name) VALUES ($1,'SHIFT_CHANGE','VIEC_RIENG','Việc riêng') RETURNING id`, [tenantId])
      ).rows[0].id;
      await pool.query(
        `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
         SELECT $1,$2,d::date,CASE WHEN extract(isodow FROM d) >= 6 THEN 'OFF' ELSE 'SHIFT' END,
                CASE WHEN extract(isodow FROM d) >= 6 THEN NULL ELSE $3::uuid END,'MANUAL'
           FROM generate_series('2026-09-01'::date,'2026-09-30'::date,'1 day') d`,
        [tenantId, empA, shiftId],
      );
    });

    it('đổi ca một khoảng có cuối tuần: chỉ các ngày làm việc được đổi, ngày OFF giữ nguyên', async () => {
      // Thứ Sáu 11/9 đến thứ Hai 14/9: bỏ qua thứ Bảy, Chủ nhật.
      const id = await changeRequest('2026-09-11', '2026-09-14');
      await tx((db) => approveShiftChange(db, tenantId, approverId, id));
      expect(await scheduleOf('2026-09-11')).toMatchObject({ day_type: 'SHIFT', shift_id: shift2, source: 'EXCEPTION' });
      expect(await scheduleOf('2026-09-14')).toMatchObject({ day_type: 'SHIFT', shift_id: shift2, source: 'EXCEPTION' });
      expect(await scheduleOf('2026-09-12')).toMatchObject({ day_type: 'OFF', shift_id: null, source: 'MANUAL' });
      expect(await scheduleOf('2026-09-13')).toMatchObject({ day_type: 'OFF', shift_id: null, source: 'MANUAL' });
      const audit = await pool.query(
        `SELECT after FROM hrm_schema.work_schedule_audit WHERE tenant_id=$1 AND action='SHIFT_CHANGE' AND employee_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, empA],
      );
      expect(audit.rows[0].after).toMatchObject({ days: ['2026-09-11', '2026-09-14'], skippedDays: ['2026-09-12', '2026-09-13'], requestId: id });
    });

    it('đổi ca không được trùng ngày có đơn nghỉ đã duyệt: 409 và lịch giữ nguyên', async () => {
      const leave = await leaveController().createLeaveRequest(req, {
        employeeId: empA,
        leaveTypeId: paidLeave,
        fromAt: '2026-09-09T08:00',
        toAt: '2026-09-09T17:00',
      } as any);
      await tx((db) => transitionLeave(db, tenantId, approverId, leave.data.id, 'APPROVED'));
      const id = await changeRequest('2026-09-08', '2026-09-10');
      await expect(tx((db) => approveShiftChange(db, tenantId, approverId, id))).rejects.toMatchObject({
        status: 409,
        response: { code: 'HRM_SCHEDULE_REQUEST_CONFLICT' },
      });
      expect(await scheduleOf('2026-09-08')).toMatchObject({ shift_id: shiftId, source: 'MANUAL' });
      expect(await scheduleOf('2026-09-09')).toMatchObject({ shift_id: shiftId, source: 'MANUAL' });
    });

    it('khoảng đổi ca đang ở ca khác ca trong đơn bị từ chối rõ ràng', async () => {
      // 11/9 đã sang ca 2: đơn đổi từ ca 1 sang ca 2 cho khoảng này không còn khớp lịch.
      const id = await changeRequest('2026-09-11', '2026-09-11');
      await expect(tx((db) => approveShiftChange(db, tenantId, approverId, id))).rejects.toThrow(/khác nội dung đơn đổi ca/);
    });
  });
});
