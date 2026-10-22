import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmApprovalRouteController } from './hrm-approval-route.controller';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { HrmRequestCommentController } from './hrm-request-comment.controller';
import { HrmRequestController } from './hrm-request.controller';
import { HrmTimesheetBoardController } from './hrm-timesheet-board.controller';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { startHrmProcedure } from '../infrastructure/hrm-procedure-bridge.service';
import { processHrmProcedureSync, receiveHrmProcedureResult } from '../infrastructure/hrm-procedure-sync';
import { createProcedureApiFake, fakeOrgScope } from '../infrastructure/hrm-test-support';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

/** Danh sách migration tenant theo đúng thứ tự đã đăng ký (core, integration, rồi HRM). */
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

/**
 * Ma trận kiểm thử đơn từ trên PostgreSQL thật: 4 loại phiếu (nghỉ, làm thêm giờ, công tác, giải trình công)
 * x mốc giờ quanh ca hành chính / ngoài ca x thứ Bảy, Chủ nhật, ngày lễ; duyệt trực tiếp (quản lý trực tiếp,
 * chức danh dự phòng) và duyệt theo quy trình; thông báo; trao đổi; kết quả trên bảng công.
 *
 * Lịch tháng 10/2026: thứ Hai 5, 12, 19, 26; thứ Bảy 3, 10, 17, 24, 31; Chủ nhật 4, 11, 18, 25.
 * Lịch tháng 11/2026: Chủ nhật 1; thứ Hai 2, 9, 16, 23, 30; thứ Bảy 7, 14, 21, 28.
 * Ca hành chính DAY 08:00-17:00 nghỉ 12:00-13:00 (thứ Hai đến thứ Sáu); thứ Bảy ca SAT 08:00-12:00 (0.5 công);
 * Chủ nhật nghỉ; thứ Tư 21/10 là ngày lễ.
 */
integration('Đơn từ: ma trận loại đơn x mốc thời gian x cách duyệt x thông báo x bảng công (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const req = { headers: {} } as Request;
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;

  // Người dùng: nhân viên A (có quản lý), nhân viên B (không có quản lý), quản lý trực tiếp của A, người giữ chức danh dự phòng,
  // Tổng giám đốc, người ngoài (có quyền duyệt nhưng không thuộc phạm vi).
  const ids = {
    userA: randomUUID(),
    empA: randomUUID(),
    userB: randomUUID(),
    empB: randomUUID(),
    userM: randomUUID(),
    empM: randomUUID(),
    userF: randomUUID(),
    empF: randomUUID(),
    userCeo: randomUUID(),
    empCeo: randomUUID(),
    userX: randomUUID(),
    empX: randomUUID(),
    posCeo: randomUUID(),
    posMgr: randomUUID(),
    posHr: randomUUID(),
    posStaff: randomUUID(),
    posLone: randomUUID(),
  };
  type Who = { userId: string; permissions: string[] };
  const APPROVE = ['hrm.leave.approve', 'hrm.ot.approve', 'hrm.trip.approve', 'hrm.attendance.approve'];
  const as = {
    a: { userId: ids.userA, permissions: [] } as Who,
    b: { userId: ids.userB, permissions: [] } as Who,
    manager: { userId: ids.userM, permissions: APPROVE } as Who,
    fallback: { userId: ids.userF, permissions: APPROVE } as Who,
    ceo: { userId: ids.userCeo, permissions: APPROVE } as Who,
    outsider: { userId: ids.userX, permissions: APPROVE } as Who,
  };
  /** Cổng phạm vi giả: quản lý trực tiếp duyệt được cấp dưới theo "Báo cáo cho"; người khác không có cấp dưới. */
  const policyOf = (who: Who) =>
    new HrmApprovalPolicyService(fakeOrgScope(who.userId === ids.userM ? [ids.userA] : []));

  const ctx = (who: Who, defaultEmployee: string = ids.empA) =>
    ({
      has: () => true,
      getRequestContext: async (_req: Request, requested?: string) => ({
        pool,
        tenantId,
        employeeId: requested ?? defaultEmployee,
        principal: who,
      }),
      scoped: async (_req: Request, _permission: string, requested?: string) => ({
        pool,
        tenantId,
        employeeId: requested,
        principal: who,
      }),
      getContext: async () => ({ pool, tenantId, principal: who }),
      approverContext: async () => ({ pool, tenantId, principal: who, employeeId: defaultEmployee }),
      resolveEmployee: async () => ({ employeeId: defaultEmployee }),
      procedureAvailable: async () => false,
    }) as any;
  // Đơn chỉ khởi chạy quy trình khi bật cờ (phần 6); các phần khác để liên kết ở trạng thái chờ khởi chạy.
  let startProcedures = false;
  const bridge = {
    startOrResume: async (db: any, linkId: string, tenant: string) =>
      startProcedures ? startHrmProcedure(db, linkId, tenant) : undefined,
  } as any;
  const leaveC = (who: Who) => new HrmLeaveController(ctx(who), bridge, policyOf(who));
  const reqC = (who: Who) => new HrmRequestController(ctx(who), bridge, policyOf(who));
  const attC = (who: Who) => new HrmAttendanceController(ctx(who), bridge, policyOf(who));
  const commentC = (who: Who) => new HrmRequestCommentController(ctx(who), policyOf(who));

  let leaveDay: string;
  let leaveHour: string;
  let leaveUnpaid: string;
  const reason: Record<string, string> = {};

  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
  const leaveDays = async (requestId: string) =>
    q(
      `SELECT to_char(work_date,'YYYY-MM-DD') AS date, quantity::float AS quantity, paid_minutes FROM hrm_schema.leave_request_days WHERE request_id=$1 ORDER BY work_date`,
      [requestId],
    );
  const approvalEvents = async (requestId: string) =>
    q(
      `SELECT payload->'payload' AS p FROM integration_schema.outbox_events WHERE event_type='hrm.approval.requested' AND aggregate_id=$1`,
      [requestId],
    );

  /** Chấm công thô của một ngày: dòng tổng hợp (để giải trình đối chiếu) và các sự kiện vào/ra mà bảng công đọc. */
  const rawPunches = async (employeeId: string, date: string, checkIn: string | null, checkOut: string | null) => {
    await pool.query(
      `INSERT INTO hrm_schema.attendances (tenant_id,employee_id,work_date,check_in_at,check_out_at,attendance_source,status)
       VALUES ($1,$2,$3,$4,$5,'WEB_PORTAL','MISSING_PUNCH') ON CONFLICT DO NOTHING`,
      [tenantId, employeeId, date, checkIn, checkOut],
    );
    for (const [kind, at] of [['IN', checkIn], ['OUT', checkOut]] as const)
      if (at)
        await pool.query(
          `INSERT INTO hrm_schema.attendance_events (tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence)
           VALUES ($1,$2,$3,$4,$5,'WEB_PORTAL',$6,'{}'::jsonb)`,
          [tenantId, employeeId, date, kind, at, randomUUID()],
        );
  };

  // Tạo từng loại đơn; mỗi hàm nhận người nộp và nhân viên (mặc định nhân viên A).
  const mkLeave = (body: Record<string, unknown>, who: Who = as.a, employeeId: string = ids.empA) =>
    leaveC(who).createLeaveRequest(req, { employeeId, leaveTypeId: leaveDay, ...body } as any);
  const mkOt = (body: Record<string, unknown>, who: Who = as.a, employeeId: string = ids.empA) =>
    reqC(who).createOtRequest(req, { employeeId, reasonId: reason['OT_WORK'], ...body } as any);
  const mkTrip = (body: Record<string, unknown>, who: Who = as.a, employeeId: string = ids.empA) =>
    reqC(who).createBusinessTripRequest(req, {
      employeeId,
      reasonId: reason['TRIP_PLAN'],
      destination: 'Hà Nội',
      purpose: 'Gặp khách hàng',
      ...body,
    } as any);
  const mkCorrection = (body: Record<string, unknown>, who: Who = as.a, employeeId: string = ids.empA) =>
    attC(who).createCorrection(req, { employeeId, reasonId: reason['CORR_FORGOT'], ...body } as any);

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of await registeredMigrations())
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));

    // Nhân sự và tổ chức.
    const people: [string, string, string, string][] = [
      [ids.userA, ids.empA, 'Nhân viên A', 'NVA'],
      [ids.userB, ids.empB, 'Nhân viên B', 'NVB'],
      [ids.userM, ids.empM, 'Trưởng phòng M', 'QLM'],
      [ids.userF, ids.empF, 'Chuyên viên nhân sự F', 'HRF'],
      [ids.userCeo, ids.empCeo, 'Tổng giám đốc C', 'CEO'],
      [ids.userX, ids.empX, 'Người ngoài X', 'NGX'],
    ];
    for (const [userId, employeeId, name, code] of people) {
      await pool.query(
        `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,$2,$3,'test')`,
        [userId, name, `${code.toLowerCase()}@example.test`],
      );
      await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name) VALUES ($1,$2,$3,$4)`, [
        employeeId,
        tenantId,
        userId,
        name,
      ]);
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,$3,'2026-01-01')`,
        [employeeId, tenantId, code],
      );
    }
    const tree = randomUUID();
    await pool.query(`INSERT INTO core_schema.organization_trees (id, code, name, is_primary) VALUES ($1,'main','Sơ đồ chính',true)`, [tree]);
    const position = (id: string, code: string, name: string, reportsTo: string | null) =>
      pool.query(
        `INSERT INTO core_schema.organization_nodes (id, tree_id, category, code, name, reports_to_position_id) VALUES ($1,$2,'position',$3,$4,$5)`,
        [id, tree, code, name, reportsTo],
      );
    await position(ids.posCeo, 'CEO', 'Tổng giám đốc', null);
    await position(ids.posMgr, 'TP', 'Trưởng phòng', ids.posCeo);
    await position(ids.posHr, 'HR', 'Chuyên viên nhân sự', ids.posCeo);
    await position(ids.posStaff, 'NV', 'Nhân viên', ids.posMgr);
    await position(ids.posLone, 'LONE', 'Nhân viên không có cấp trên', null);
    const assign = (positionId: string, userId: string) =>
      pool.query(
        `INSERT INTO core_schema.organization_node_assignments (id, node_id, user_id, is_primary, status, start_date) VALUES ($1,$2,$3,true,'active','2026-01-01')`,
        [randomUUID(), positionId, userId],
      );
    await assign(ids.posCeo, ids.userCeo);
    await assign(ids.posMgr, ids.userM);
    await assign(ids.posHr, ids.userF);
    await assign(ids.posStaff, ids.userA);
    await assign(ids.posLone, ids.userB);

    // Ca làm việc và lịch từng ngày (tháng 10 và 11/2026).
    const shift = async (code: string, name: string, start: string, end: string, breakMinutes: number, breakFrom: string | null, breakTo: string | null) =>
      (
        await pool.query(
          `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes,break_start_time,break_end_time)
           VALUES ($1,$2,$3,$4,$5,false,$6,0,0,$7,$8) RETURNING id`,
          [tenantId, code, name, start, end, breakMinutes, breakFrom, breakTo],
        )
      ).rows[0].id as string;
    const dayShift = await shift('DAY', 'Hành chính', '08:00', '17:00', 60, '12:00', '13:00');
    const satShift = await shift('SAT', 'Thứ Bảy nửa ngày', '08:00', '12:00', 0, null, null);
    for (const employeeId of [ids.empA, ids.empB]) {
      await pool.query(
        `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
         SELECT $1,$2,d::date,
                CASE WHEN d::date IN ('2026-10-21','2026-11-25') THEN 'HOLIDAY'
                     WHEN extract(isodow FROM d) = 7 THEN 'OFF'
                     ELSE 'SHIFT' END,
                CASE WHEN extract(isodow FROM d) = 7 THEN NULL
                     WHEN extract(isodow FROM d) = 6 THEN $4::uuid
                     ELSE $3::uuid END,
                CASE WHEN d::date IN ('2026-10-21','2026-11-25') THEN 'HOLIDAY' ELSE 'MANUAL' END
           FROM generate_series('2026-09-01'::date,'2027-03-31'::date,'1 day') d`,
        [tenantId, employeeId, dayShift, satShift],
      );
    }
    await pool.query(
      `INSERT INTO hrm_schema.company_holidays (tenant_id,name,kind,from_date,to_date,treatment,paid)
       VALUES ($1,'Ngày lễ kiểm thử','HOLIDAY','2026-10-21','2026-10-21','OFF',true)`,
      [tenantId],
    );

    // Danh mục: loại nghỉ và lý do của từng loại đơn.
    const leaveType = async (code: string, unit: string, paid: boolean) =>
      (
        await pool.query(
          `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,paid,deduct_balance) VALUES ($1,$2,$2,$3,$4,false) RETURNING id`,
          [tenantId, code, unit, paid],
        )
      ).rows[0].id as string;
    leaveDay = await leaveType('NGHI_NGAY', 'DAYS', true);
    leaveHour = await leaveType('NGHI_GIO', 'HOURS', true);
    leaveUnpaid = await leaveType('NGHI_KHONG_LUONG', 'DAYS', false);
    const addReason = async (kind: string, code: string, rate: number | null = null) => {
      reason[code] = (
        await pool.query(
          `INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name,rate_multiplier) VALUES ($1,$2,$3,$3,$4) RETURNING id`,
          [tenantId, kind, code, rate],
        )
      ).rows[0].id as string;
    };
    await addReason('OVERTIME', 'OT_WORK');
    await addReason('OVERTIME', 'OT_URGENT', 2.5);
    await addReason('BUSINESS_TRIP', 'TRIP_PLAN');
    await addReason('BUSINESS_TRIP', 'TRIP_TRAINING');
    await addReason('ATTENDANCE_CORRECTION', 'CORR_FORGOT');
    await addReason('ATTENDANCE_CORRECTION', 'CORR_DEVICE');
    await new HrmPayrollSettingsController(ctx(as.manager)).overtime(req, {
      effectiveFrom: '2025-01-01',
      reason: 'Thiết lập chính sách OT',
      dailyLimitMinutes: 480,
      weeklyLimitMinutes: 2400,
      monthlyLimitMinutes: 6000,
      yearlyLimitMinutes: 24000,
      weekdayRate: 1.5,
      offRate: 2,
      holidayRate: 3,
      nightRate: 2,
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  describe('1. Phiếu xin nghỉ: mốc giờ quanh ca hành chính, thứ Bảy, Chủ nhật, ngày lễ', () => {
    it.each([
      ['sáng thứ Hai (08:00-12:00)', '2026-10-05T08:00', '2026-10-05T12:00', 0.5, [{ date: '2026-10-05', quantity: 0.5, paid_minutes: 240 }]],
      ['chiều thứ Hai (13:00-17:00), cùng ngày với nghỉ sáng vẫn hợp lệ', '2026-10-05T13:00', '2026-10-05T17:00', 0.5, [{ date: '2026-10-05', quantity: 0.5, paid_minutes: 240 }]],
      ['cả ngày thứ Ba kéo dài quá giờ ca (08:00-19:00): phần ngoài ca không tính', '2026-10-06T08:00', '2026-10-06T19:00', 1, [{ date: '2026-10-06', quantity: 1, paid_minutes: 480 }]],
      ['bắt đầu trước ca (06:00) đến hết ca thứ Tư: chỉ tính trong ca', '2026-10-07T06:00', '2026-10-07T17:00', 1, [{ date: '2026-10-07', quantity: 1, paid_minutes: 480 }]],
      ['thứ Bảy ca ngắn (08:00-12:00): trọn ca là 0.5 ngày', '2026-10-17T08:00', '2026-10-17T12:00', 0.5, [{ date: '2026-10-17', quantity: 0.5, paid_minutes: 240 }]],
      [
        'thứ Sáu đến thứ Hai: thứ Bảy 0.5, bỏ Chủ nhật',
        '2026-10-09T08:00',
        '2026-10-12T17:00',
        2.5,
        [
          { date: '2026-10-09', quantity: 1, paid_minutes: 480 },
          { date: '2026-10-10', quantity: 0.5, paid_minutes: 240 },
          { date: '2026-10-12', quantity: 1, paid_minutes: 480 },
        ],
      ],
      [
        'qua ngày lễ thứ Tư 25/11: bỏ ngày lễ',
        '2026-11-24T08:00',
        '2026-11-26T17:00',
        2,
        [
          { date: '2026-11-24', quantity: 1, paid_minutes: 480 },
          { date: '2026-11-26', quantity: 1, paid_minutes: 480 },
        ],
      ],
    ])('%s', async (_name, fromAt, toAt, duration, expectedDays) => {
      const result = await mkLeave({ fromAt, toAt, description: 'Việc cá nhân' });
      expect(result.data).toMatchObject({ duration, status: 'PENDING', timeKnown: true });
      expect(await leaveDays(result.data.id)).toEqual(expectedDays);
    });

    it('nghỉ theo giờ trong ca: 09:00-11:00 là 2 giờ, 120 phút', async () => {
      const result = await mkLeave({ leaveTypeId: leaveHour, fromAt: '2026-10-08T09:00', toAt: '2026-10-08T11:00' });
      expect(result.data.duration).toBe(2);
      expect(await leaveDays(result.data.id)).toEqual([{ date: '2026-10-08', quantity: 2, paid_minutes: 120 }]);
    });

    it('nghỉ không lương: tạo được, không có phút hưởng lương', async () => {
      const result = await mkLeave({ leaveTypeId: leaveUnpaid, fromAt: '2026-10-27T08:00', toAt: '2026-10-27T17:00', description: 'Nghỉ việc riêng không lương' });
      expect(result.data).toMatchObject({ duration: 1, status: 'PENDING' });
      expect((await leaveDays(result.data.id))[0]).toMatchObject({ date: '2026-10-27', quantity: 1 });
    });

    it.each([
      ['Chủ nhật (nghỉ cả ngày)', '2026-10-18T08:00', '2026-10-18T17:00'],
      ['đúng ngày lễ', '2026-10-21T08:00', '2026-10-21T17:00'],
      ['ngoài giờ ca (18:00-20:00)', '2026-10-13T18:00', '2026-10-13T20:00'],
      ['thứ Bảy sau ca ngắn (13:00-17:00)', '2026-10-24T13:00', '2026-10-24T17:00'],
    ])('khoảng chỉ rơi vào %s bị từ chối vì không có giờ làm việc', async (_name, fromAt, toAt) => {
      await expect(mkLeave({ fromAt, toAt })).rejects.toMatchObject({ status: 400 });
    });

    it('nghỉ chồng đơn đã có (kể cả chồng một phần) bị từ chối 409', async () => {
      await expect(mkLeave({ leaveTypeId: leaveHour, fromAt: '2026-10-05T11:00', toAt: '2026-10-05T14:00' })).rejects.toMatchObject({ status: 409 });
      await expect(mkLeave({ fromAt: '2026-10-17T08:00', toAt: '2026-10-17T12:00' })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('2. Phiếu làm thêm giờ (OT): trong ca, ngoài ca, thứ Bảy, Chủ nhật, ngày lễ', () => {
    it.each([
      ['tối ngày thường sau ca (18:00-20:30)', '2026-10-26T18:00', '2026-10-26T20:30', 150],
      ['sáng sớm trước ca (06:00-08:00)', '2026-10-28T06:00', '2026-10-28T08:00', 120],
      ['chiều thứ Bảy sau ca ngắn (13:00-17:00)', '2026-10-24T13:00', '2026-10-24T17:00', 240],
      ['cả sáng Chủ nhật (08:00-12:00)', '2026-10-25T08:00', '2026-10-25T12:00', 240],
      ['ngày lễ (08:00-12:00)', '2026-10-21T08:00', '2026-10-21T12:00', 240],
    ])('%s', async (_name, fromAt, toAt, minutes) => {
      const result = await mkOt({ fromAt, toAt });
      expect(result.data).toMatchObject({ status: 'PENDING' });
      const row = (await q(`SELECT planned_minutes FROM hrm_schema.ot_requests WHERE id=$1`, [result.data.id]))[0];
      expect(row.planned_minutes).toBe(minutes);
    });

    it('hệ số theo ngày: ngày có ca (kể cả thứ Bảy) 1.5, Chủ nhật 2, ngày lễ 3; lý do có hệ số thì lấy hệ số của lý do', async () => {
      const rows = await q(
        `SELECT to_char(work_date,'YYYY-MM-DD') AS d, ot_rate_multiplier::float AS rate, rate_source
           FROM hrm_schema.ot_requests WHERE tenant_id=$1 AND employee_id=$2 ORDER BY work_date, created_at`,
        [tenantId, ids.empA],
      );
      const byDate = Object.fromEntries(rows.map((r) => [r.d, r]));
      expect(byDate['2026-10-26']).toMatchObject({ rate: 1.5, rate_source: 'POLICY' });
      expect(byDate['2026-10-24'].rate).toBe(1.5);
      expect(byDate['2026-10-25'].rate).toBe(2);
      expect(byDate['2026-10-21'].rate).toBe(3);
      const urgent = await mkOt({ reasonId: reason['OT_URGENT'], fromAt: '2026-10-22T18:00', toAt: '2026-10-22T19:00' });
      expect(urgent.data).toMatchObject({ otRateMultiplier: 2.5, rateSource: 'REASON' });
    });

    it('OT trùng giờ ca hành chính bị từ chối; OT chồng OT khác bị từ chối 409', async () => {
      await expect(mkOt({ fromAt: '2026-10-14T09:00', toAt: '2026-10-14T11:00' })).rejects.toMatchObject({ status: 400 });
      await expect(mkOt({ fromAt: '2026-10-26T19:00', toAt: '2026-10-26T21:00' })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('3. Phiếu công tác: nửa ngày, cả ngày, thứ Bảy ca ngắn, nhiều ngày qua cuối tuần', () => {
    it.each([
      ['cả ngày thứ Hai (08:00-17:00): 1 ngày', '2026-11-02T08:00', '2026-11-02T17:00', 1],
      ['nửa ngày sáng thứ Ba (08:00-12:00): 0.5 ngày', '2026-11-03T08:00', '2026-11-03T12:00', 0.5],
      ['nửa ngày chiều thứ Ba (13:00-17:00): 0.5 ngày', '2026-11-03T13:00', '2026-11-03T17:00', 0.5],
      ['thứ Bảy đi trọn ca ngắn (08:00-12:00): vẫn đủ 1 ngày công tác', '2026-11-07T08:00', '2026-11-07T12:00', 1],
      ['thứ Sáu đến thứ Hai qua thứ Bảy: 3 ngày, bỏ Chủ nhật', '2026-11-13T08:00', '2026-11-16T17:00', 3],
      ['qua cuối tháng 10: thứ Năm 29 đến thứ Bảy 31', '2026-10-29T08:00', '2026-10-31T12:00', 3],
    ])('%s', async (_name, fromAt, toAt, days) => {
      const result = await mkTrip({ fromAt, toAt });
      expect(result.data).toMatchObject({ status: 'PENDING' });
      const row = (await q(`SELECT days_count FROM hrm_schema.business_trip_requests WHERE id=$1`, [result.data.id]))[0];
      expect(Number(row.days_count)).toBe(days);
    });

    it.each([
      ['Chủ nhật', '2026-11-08T08:00', '2026-11-08T17:00'],
      ['ngày lễ', '2026-10-21T08:00', '2026-10-21T17:00'],
      ['ngoài ca (18:00-20:00)', '2026-11-04T18:00', '2026-11-04T20:00'],
    ])('công tác rơi vào %s bị từ chối', async (_name, fromAt, toAt) => {
      await expect(mkTrip({ fromAt, toAt })).rejects.toMatchObject({ status: 400 });
    });

    it('công tác sai khung nửa ca bị từ chối; công tác chồng công tác khác bị 409', async () => {
      await expect(mkTrip({ fromAt: '2026-11-09T08:00', toAt: '2026-11-09T10:00' })).rejects.toMatchObject({ status: 400 });
      await expect(mkTrip({ fromAt: '2026-11-02T08:00', toAt: '2026-11-02T12:00' })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('4. Phiếu giải trình công: giờ vào hoặc giờ ra, trong và ngoài cửa sổ ca', () => {
    const at = (date: string, time: string) => `${date}T${time}:00+07:00`;
    const attendance = (date: string, checkIn: string | null, checkOut: string | null) =>
      rawPunches(ids.empA, date, checkIn, checkOut);

    it('quên chấm ra ngày thường: bổ sung giờ ra 17:00', async () => {
      await attendance('2026-10-13', at('2026-10-13', '08:00'), null);
      const result = await mkCorrection({ requestDate: '2026-10-13', punches: [{ kind: 'OUT', at: at('2026-10-13', '17:00') }], description: 'Quên chấm ra' });
      expect(result.data).toMatchObject({ status: 'PENDING', requestDate: '2026-10-13' });
    });

    it('quên chấm vào thứ Bảy ca ngắn: bổ sung giờ vào 08:00', async () => {
      await attendance('2026-10-03', null, at('2026-10-03', '12:00'));
      const result = await mkCorrection({ requestDate: '2026-10-03', reasonId: reason['CORR_DEVICE'], punches: [{ kind: 'IN', at: at('2026-10-03', '08:00') }] });
      expect(result.data).toMatchObject({ status: 'PENDING' });
    });

    it('giải trình ngày Chủ nhật (không có ca): nhận giờ trong ngày', async () => {
      const result = await mkCorrection({ requestDate: '2026-10-11', punches: [{ kind: 'IN', at: at('2026-10-11', '09:00') }] });
      expect(result.data).toMatchObject({ status: 'PENDING' });
    });

    it('giờ ngoài cửa sổ ca, giờ ra trước giờ vào, khai cả hai mốc, hoặc không khai mốc nào đều bị từ chối 400', async () => {
      await expect(mkCorrection({ requestDate: '2026-10-14', punches: [{ kind: 'OUT', at: at('2026-10-14', '23:59') }] })).rejects.toMatchObject({ status: 400 });
      await attendance('2026-10-15', at('2026-10-15', '10:00'), null);
      await expect(mkCorrection({ requestDate: '2026-10-15', punches: [{ kind: 'OUT', at: at('2026-10-15', '09:00') }] })).rejects.toMatchObject({ status: 400 });
      await expect(mkCorrection({ requestDate: '2026-10-16', punches: [] })).rejects.toMatchObject({ status: 400 });
    });
  });
  // ----- Duyệt trực tiếp: quản lý trực tiếp, chức danh dự phòng, thông báo, trao đổi -----
  type Kind = 'leave' | 'ot' | 'business_trip' | 'correction';
  type Spec = {
    label: string;
    kind: Kind;
    commentKind: string;
    table: string;
    permission: string;
    create: (day: string, who?: Who, employeeId?: string) => Promise<{ data: { id: string } }>;
    approve: (who: Who, id: string) => Promise<unknown>;
    reject: (who: Who, id: string, text: string) => Promise<unknown>;
  };
  // Mỗi lần gọi trả về một ngày làm việc (thứ Hai đến thứ Sáu) chưa dùng của tháng 12/2026, tránh chồng đơn.
  let dayCursor = Date.parse('2026-12-01T00:00:00Z');
  const nextDay = () => {
    for (;;) {
      const d = new Date(dayCursor);
      dayCursor += 86400000;
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
    }
  };
  let pastCursor = Date.parse('2026-09-01T00:00:00Z');
  const nextPastDay = () => {
    for (;;) {
      const d = new Date(pastCursor);
      pastCursor += 86400000;
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
    }
  };
  const specs: Spec[] = [
    {
      label: 'nghỉ phép',
      kind: 'leave',
      commentKind: 'LEAVE',
      table: 'leave_requests',
      permission: 'hrm.leave.approve',
      create: (day, who, emp) => mkLeave({ fromAt: `${day}T08:00`, toAt: `${day}T17:00` }, who, emp),
      approve: (who, id) => leaveC(who).approveLeaveRequest(req, id),
      reject: (who, id, text) => leaveC(who).rejectLeaveRequest(req, id, text),
    },
    {
      label: 'làm thêm giờ',
      kind: 'ot',
      commentKind: 'OT',
      table: 'ot_requests',
      permission: 'hrm.ot.approve',
      create: (day, who, emp) => mkOt({ fromAt: `${day}T18:00`, toAt: `${day}T19:00` }, who, emp),
      approve: (who, id) => reqC(who).approveOtRequest(req, id),
      reject: (who, id, text) => reqC(who).rejectOtRequest(req, id, text),
    },
    {
      label: 'công tác',
      kind: 'business_trip',
      commentKind: 'BUSINESS_TRIP',
      table: 'business_trip_requests',
      permission: 'hrm.trip.approve',
      create: (day, who, emp) => mkTrip({ fromAt: `${day}T08:00`, toAt: `${day}T17:00` }, who, emp),
      approve: (who, id) => reqC(who).approveBusinessTrip(req, id),
      reject: (who, id) => reqC(who).rejectBusinessTrip(req, id),
    },
    {
      label: 'giải trình công',
      kind: 'correction',
      commentKind: 'CORRECTION',
      table: 'attendance_corrections',
      permission: 'hrm.attendance.approve',
      // Giải trình không nhận mốc giờ ở tương lai: dùng ngày làm việc của tháng 9/2026 thay cho ngày được truyền vào.
      create: async (_day, who, emp) => {
        const day = nextPastDay();
        await rawPunches(emp ?? ids.empA, day, `${day}T08:00:00+07:00`, null);
        return mkCorrection({ requestDate: day, punches: [{ kind: 'OUT', at: `${day}T17:00:00+07:00` }] }, who, emp);
      },
      approve: (who, id) => attC(who).approveCorrection(req, id),
      reject: (who, id, text) => attC(who).rejectCorrection(req, id, text),
    },
  ];
  const statusOf = async (spec: Spec, id: string) =>
    (await q(`SELECT status, approved_by FROM hrm_schema.${spec.table} WHERE id=$1`, [id]))[0];

  describe('5. Duyệt trực tiếp: quản lý trực tiếp hoặc người giữ chức danh dự phòng', () => {
    beforeAll(async () => {
      const route = new HrmApprovalRouteController(ctx(as.manager));
      for (const kind of ['leave', 'ot', 'business_trip', 'correction'] as const)
        await route.putConfig(req, { requestKind: kind, mode: 'DIRECT', fallbackPositionId: ids.posHr });
    });

    describe.each(specs)('đơn $label', (spec) => {
      it('thông báo duyệt đến quản lý trực tiếp và người giữ chức danh dự phòng, không đến người nộp hay người ngoài', async () => {
        const made = await spec.create(nextDay());
        const events = await approvalEvents(made.data.id);
        expect(events).toHaveLength(1);
        const payload = events[0].p;
        expect([...payload.recipientUserIds].sort()).toEqual([ids.userM, ids.userF].sort());
        expect(payload.recipientUserIds).not.toContain(ids.userA);
        expect(payload.recipientUserIds).not.toContain(ids.userX);
        expect(payload).toMatchObject({ requestId: made.data.id, actorUserId: ids.userA });
        expect(payload.approvalPermissions).toEqual([spec.permission, 'hrm.manage']);
        expect(payload.summary).toContain('Nhân viên A');
      });

      it('quản lý trực tiếp duyệt: người nộp tự duyệt và người ngoài phạm vi đều bị chặn', async () => {
        const made = await spec.create(nextDay());
        await expect(spec.approve(as.a, made.data.id)).rejects.toMatchObject({ status: 403, response: { code: 'SELF_APPROVAL_FORBIDDEN' } });
        await expect(spec.approve(as.outsider, made.data.id)).rejects.toMatchObject({ status: 403, response: { code: 'APPROVAL_OUT_OF_SCOPE' } });
        await expect(spec.approve(as.ceo, made.data.id)).rejects.toMatchObject({ status: 403, response: { code: 'APPROVAL_OUT_OF_SCOPE' } });
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'PENDING' });
        await spec.approve(as.manager, made.data.id);
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userM });
      });

      it('người giữ chức danh dự phòng duyệt thay quản lý trực tiếp', async () => {
        const made = await spec.create(nextDay());
        await spec.approve(as.fallback, made.data.id);
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userF });
      });

      it('từ chối: quản lý và dự phòng đều từ chối được; đã từ chối thì không duyệt lại được', async () => {
        const first = await spec.create(nextDay());
        await spec.reject(as.manager, first.data.id, 'Chưa phù hợp kế hoạch');
        expect(await statusOf(spec, first.data.id)).toMatchObject({ status: 'REJECTED' });
        // Đơn công tác trả 400, các loại còn lại trả 409: chỉ cần chắc chắn không duyệt lại được.
        await expect(spec.approve(as.manager, first.data.id)).rejects.toMatchObject({ status: expect.any(Number) });
        expect(await statusOf(spec, first.data.id)).toMatchObject({ status: 'REJECTED' });
        const second = await spec.create(nextDay());
        await spec.reject(as.fallback, second.data.id, 'Trùng lịch phòng ban');
        expect(await statusOf(spec, second.data.id)).toMatchObject({ status: 'REJECTED' });
      });

      it('nhân viên không có quản lý trực tiếp: người giữ chức danh dự phòng duyệt được, quản lý của người khác thì không', async () => {
        const made = await spec.create(nextDay(), as.b, ids.empB);
        const events = await approvalEvents(made.data.id);
        // Nhân viên không có quản lý: thông báo đến người dự phòng và (theo managerUserIdsOf) Tổng giám đốc, dù Tổng giám đốc không được tự duyệt thay.
        expect([...events[0].p.recipientUserIds].sort()).toEqual([ids.userF, ids.userCeo].sort());
        expect(events[0].p.recipientUserIds).not.toContain(ids.userB);
        await expect(spec.approve(as.manager, made.data.id)).rejects.toMatchObject({ status: 403, response: { code: 'APPROVAL_OUT_OF_SCOPE' } });
        await expect(spec.approve(as.outsider, made.data.id)).rejects.toMatchObject({ status: 403 });
        await spec.approve(as.fallback, made.data.id);
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userF });
      });

      it('bỏ chức danh dự phòng: chỉ quản lý nhận thông báo và duyệt; người dự phòng cũ bị chặn', async () => {
        const route = new HrmApprovalRouteController(ctx(as.manager));
        await route.putConfig(req, { requestKind: spec.kind, mode: 'DIRECT', fallbackPositionId: null });
        try {
          const made = await spec.create(nextDay());
          expect((await approvalEvents(made.data.id))[0].p.recipientUserIds).toEqual([ids.userM]);
          await expect(spec.approve(as.fallback, made.data.id)).rejects.toMatchObject({ status: 403 });
          await spec.approve(as.manager, made.data.id);
          expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'APPROVED' });
        } finally {
          await route.putConfig(req, { requestKind: spec.kind, mode: 'DIRECT', fallbackPositionId: ids.posHr });
        }
      });

      it('trao đổi: chủ đơn, quản lý và người dự phòng cùng thấy hội thoại; người ngoài bị chặn; thông báo đến đúng người', async () => {
        const made = await spec.create(nextDay());
        const requestId = made.data.id;
        const owner = commentC(as.a);
        const manager = commentC(as.manager);
        const fallback = commentC(as.fallback);
        await owner.create(req, { kind: spec.commentKind, requestId, body: 'Em xin phép được duyệt sớm' } as any);
        await manager.create(req, { kind: spec.commentKind, requestId, body: 'Anh xem rồi, chờ chị nhân sự xác nhận', mentionUserIds: [ids.userF] } as any);
        await fallback.create(req, { kind: spec.commentKind, requestId, body: 'Chị xác nhận phía nhân sự ổn' } as any);

        const seenByOwner = await owner.list(req, spec.commentKind, requestId);
        expect(seenByOwner.data.map((c) => c.body)).toEqual([
          'Em xin phép được duyệt sớm',
          'Anh xem rồi, chờ chị nhân sự xác nhận',
          'Chị xác nhận phía nhân sự ổn',
        ]);
        expect(seenByOwner.data.map((c) => c.mine)).toEqual([true, false, false]);
        expect(seenByOwner.data[1].mentions).toEqual([{ userId: ids.userF, name: 'Chuyên viên nhân sự F' }]);
        const seenByFallback = await fallback.list(req, spec.commentKind, requestId);
        expect(seenByFallback.data.map((c) => c.mine)).toEqual([false, false, true]);
        expect((await manager.list(req, spec.commentKind, requestId)).data).toHaveLength(3);
        await expect(commentC(as.outsider).list(req, spec.commentKind, requestId)).rejects.toMatchObject({ status: 403 });
        await expect(commentC(as.outsider).create(req, { kind: spec.commentKind, requestId, body: 'chen vào' } as any)).rejects.toMatchObject({ status: 403 });

        const events = await q(
          `SELECT event_type, payload->'payload' AS p FROM integration_schema.outbox_events WHERE event_type LIKE 'hrm.request.comment.%' AND aggregate_id=$1`,
          [requestId],
        );
        const of = (type: string) => events.filter((e) => e.event_type === type);
        // Chủ đơn viết 1 lần: báo cho người duyệt. Quản lý và người dự phòng viết: báo cho chủ đơn (2 lần). Quản lý nhắc người dự phòng 1 lần.
        expect(of('hrm.request.comment.to-approvers')).toHaveLength(1);
        expect(of('hrm.request.comment.to-approvers')[0].p.approvalPermissions).toEqual([spec.permission, 'hrm.manage']);
        expect(of('hrm.request.comment.to-approvers')[0].p.recipientUserIds ?? []).toEqual(expect.arrayContaining([ids.userM, ids.userF]));
        expect(of('hrm.request.comment.to-requester')).toHaveLength(2);
        expect(of('hrm.request.comment.to-requester').every((e) => e.p.recipientUserIds[0] === ids.userA)).toBe(true);
        expect(of('hrm.request.comment.mentioned')).toHaveLength(1);
        expect(of('hrm.request.comment.mentioned')[0].p.mentionedUserIds).toEqual([ids.userF]);
      });
    });
  });

  // ----- Duyệt theo quy trình (Procedure Engine giả qua fetch; kết quả áp bằng đúng đường đồng bộ của HRM) -----
  describe('6. Duyệt theo quy trình: quản lý trực tiếp hoặc người dự phòng duyệt trong quy trình', () => {
    const definitionId = randomUUID();
    const definition = {
      id: definitionId,
      code: 'HRM-DUYET',
      name: 'Duyệt đơn HRM',
      steps: [
        { id: 'step-s', key: 'S', name: 'Nộp đơn', order: 1, assignments: [{ role: 'S' }], attributes: [] },
        {
          id: 'step-a',
          key: 'A',
          name: 'Duyệt (Quản lý hoặc người dự phòng)',
          order: 2,
          assignments: [
            { role: 'A', subjectType: 'initiator_manager', managerFallback: { subjectType: 'user', subjectId: ids.userF } },
          ],
        },
      ],
    };
    let fetchSpy: jest.SpyInstance;
    const tokenBefore = process.env.INTERNAL_SERVICE_TOKEN;

    beforeAll(async () => {
      process.env.INTERNAL_SERVICE_TOKEN = 'matrix-token';
      startProcedures = true;
      const pe = createProcedureApiFake({
        definitions: { [definitionId]: definition },
        currentStepName: definition.steps[1].name,
        currentAssigneeName: 'Quản lý trực tiếp hoặc người dự phòng',
      });
      fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(pe.handler);
      // Thay cấu hình DIRECT mặc định của phần 5 bằng PROCEDURE (mỗi loại đơn chỉ có một cấu hình mặc định đang hoạt động).
      for (const kind of ['leave', 'ot', 'business_trip', 'correction']) {
        await pool.query(
          `DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind=$2 AND sub_type_code IS NULL`,
          [tenantId, kind],
        );
        await pool.query(
          `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,procedure_definition_id,mode) VALUES($1,$2,$3,'PROCEDURE')`,
          [tenantId, kind, definitionId],
        );
      }
    });
    afterAll(async () => {
      startProcedures = false;
      fetchSpy.mockRestore();
      if (tokenBefore === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
      else process.env.INTERNAL_SERVICE_TOKEN = tokenBefore;
      await pool.query(`DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1`, [tenantId]);
      const route = new HrmApprovalRouteController(ctx(as.manager));
      for (const kind of ['leave', 'ot', 'business_trip', 'correction'] as const)
        await route.putConfig(req, { requestKind: kind, mode: 'DIRECT', fallbackPositionId: ids.posHr });
    });

    const linkOf = async (requestId: string) =>
      (await q(`SELECT id, instance_id, sync_status FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND request_id=$2`, [tenantId, requestId]))[0];
    /** Procedure Engine báo kết thúc: `completed` là duyệt, `rejected` là từ chối; `actorId` là người đã xử lý bước cuối. */
    const finish = async (requestId: string, status: 'completed' | 'rejected', actorId: string) => {
      const link = await linkOf(requestId);
      const event = {
        id: randomUUID(),
        type: 'procedure.instance.completed',
        version: 1,
        tenantId,
        source: 'procedure-engine',
        occurredAt: new Date().toISOString(),
        correlationId: link.instance_id,
        payload: { instanceId: link.instance_id, sourceType: 'hrm_request', sourceId: link.id, status, actorId },
      } as unknown as IntegrationEventEnvelope;
      await receiveHrmProcedureResult(pool as any, tenantId, event);
      await processHrmProcedureSync(pool as any, tenantId);
    };

    describe.each(specs)('đơn $label', (spec) => {
      it('gửi đơn tạo liên kết quy trình đang chạy, không phát thông báo duyệt trực tiếp (quy trình tự giao việc)', async () => {
        const made = await spec.create(nextDay());
        const link = await linkOf(made.data.id);
        expect(link).toMatchObject({ sync_status: 'RUNNING' });
        expect(link.instance_id).toBeTruthy();
        expect(await approvalEvents(made.data.id)).toHaveLength(0);
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'PENDING' });
      });

      it('đơn đang trong quy trình không duyệt hay từ chối trực tiếp được (409 PROCEDURE_IN_PROGRESS), kể cả quản lý và người dự phòng', async () => {
        const made = await spec.create(nextDay());
        await expect(spec.approve(as.manager, made.data.id)).rejects.toMatchObject({ status: 409, response: { code: 'PROCEDURE_IN_PROGRESS' } });
        // Cấu hình quy trình không gắn chức danh dự phòng của duyệt trực tiếp: người dự phòng chỉ xử lý được ngay trong quy trình.
        await expect(spec.approve(as.fallback, made.data.id)).rejects.toMatchObject({ status: 403 });
        await expect(spec.reject(as.manager, made.data.id, 'Từ chối trực tiếp')).rejects.toMatchObject({ status: expect.any(Number) });
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'PENDING' });
      });

      it('quản lý trực tiếp duyệt trong quy trình: HRM áp kết quả APPROVED và ghi người duyệt', async () => {
        const made = await spec.create(nextDay());
        await finish(made.data.id, 'completed', ids.userM);
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userM });
        expect(await linkOf(made.data.id)).toMatchObject({ sync_status: 'APPLIED' });
      });

      it('người dự phòng duyệt trong quy trình: HRM áp kết quả APPROVED và ghi người dự phòng', async () => {
        const made = await spec.create(nextDay());
        await finish(made.data.id, 'completed', ids.userF);
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userF });
      });

      it('quy trình từ chối: HRM áp REJECTED; kết quả gửi lặp không đổi trạng thái lần nữa', async () => {
        const made = await spec.create(nextDay());
        await finish(made.data.id, 'rejected', ids.userM);
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'REJECTED' });
        await finish(made.data.id, 'completed', ids.userF);
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'REJECTED' });
      });

      it('đơn của nhân viên không có quản lý: quy trình chạy được và người dự phòng duyệt', async () => {
        const made = await spec.create(nextDay(), as.b, ids.empB);
        expect(await linkOf(made.data.id)).toMatchObject({ sync_status: 'RUNNING' });
        await finish(made.data.id, 'completed', ids.userF);
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userF });
      });

      it('trao đổi trong lúc đơn chạy quy trình: chủ đơn viết, người tham gia quy trình thấy', async () => {
        const made = await spec.create(nextDay());
        const requestId = made.data.id;
        await commentC(as.a).create(req, { kind: spec.commentKind, requestId, body: 'Nhờ anh chị xử lý giúp em' } as any);
        const seen = await commentC(as.a).list(req, spec.commentKind, requestId);
        expect(seen.data.map((c) => c.body)).toEqual(['Nhờ anh chị xử lý giúp em']);
        await expect(commentC(as.outsider).list(req, spec.commentKind, requestId)).rejects.toMatchObject({ status: 403 });
      });
    });
  });

  // ----- Bảng công: đơn đã duyệt ở phần 1-4 hiển thị đúng trên bảng công tháng -----
  describe('7. Bảng công hiển thị đơn đã duyệt', () => {
    type Day = Record<string, any>;
    let oct: Record<string, Day>;
    let octTotals: Record<string, any>;
    let nov: Record<string, Day>;
    const board = async (month: string, employeeId: string = ids.empA) => {
      const c = new HrmTimesheetBoardController(ctx(as.manager));
      await c.calculate(req, month);
      const result = await c.board(req, month, employeeId);
      return result.data.employees.find((e) => e.employeeId === employeeId)!;
    };

    beforeAll(async () => {
      // Duyệt toàn bộ đơn của nhân viên A đã tạo ở phần 1-4 (ngày trước tháng 12/2026) bằng quản lý trực tiếp.
      const pending = async (table: string, dateColumn: string) =>
        (
          await q(
            `SELECT t.id FROM hrm_schema.${table} t
              WHERE t.tenant_id=$1 AND t.employee_id=$2 AND t.status='PENDING' AND t.${dateColumn} < '2026-12-01'
                AND NOT EXISTS (SELECT 1 FROM hrm_schema.procedure_links l WHERE l.request_id=t.id)`,
            [tenantId, ids.empA],
          )
        ).map((r) => r.id as string);
      for (const id of await pending('leave_requests', 'from_date')) await leaveC(as.manager).approveLeaveRequest(req, id);
      for (const id of await pending('ot_requests', 'work_date')) await reqC(as.manager).approveOtRequest(req, id);
      for (const id of await pending('business_trip_requests', 'from_date')) await reqC(as.manager).approveBusinessTrip(req, id);
      for (const id of await pending('attendance_corrections', 'request_date')) await attC(as.manager).approveCorrection(req, id);
      const octBoard = await board('2026-10');
      oct = octBoard.days as any;
      octTotals = octBoard.totals as any;
      nov = (await board('2026-11')).days as any;
    }, 120_000);

    const sourcesOf = (day: Day) => (day.sources ?? []).map((src: any) => `${src.kind}:${src.minutes}`);
    const cell = (day: Day) => ({
      workdayUnits: day.workdayUnits,
      scheduledMinutes: day.scheduledMinutes,
      paidMinutes: day.paidMinutes,
      otMinutes: day.otMinutes,
    });

    it('nghỉ phép: nửa ngày sáng + nửa ngày chiều là 1 công; nghỉ cả ngày kéo quá giờ ca vẫn là 1 công', () => {
      expect(oct['2026-10-05']).toMatchObject({ status: 'PAID_LEAVE', workdayUnits: 1, paidMinutes: 480 });
      expect(sourcesOf(oct['2026-10-05'])).toEqual(['LEAVE:240', 'LEAVE:240']);
      expect(oct['2026-10-06']).toMatchObject({ status: 'PAID_LEAVE', workdayUnits: 1, paidMinutes: 480 });
      expect(oct['2026-10-07']).toMatchObject({ status: 'PAID_LEAVE', workdayUnits: 1, paidMinutes: 480 });
    });

    it('nghỉ theo giờ: 2 giờ là 0.25 công, 120 phút hưởng lương', () => {
      expect(oct['2026-10-08']).toMatchObject({ status: 'PAID_LEAVE', workdayUnits: 0.25, paidMinutes: 120 });
      expect(sourcesOf(oct['2026-10-08'])).toEqual(['LEAVE:120']);
    });

    it('nghỉ từ thứ Sáu đến thứ Hai: thứ Bảy ca ngắn 0.5 công, Chủ nhật không có công', () => {
      expect(oct['2026-10-09']).toMatchObject({ workdayUnits: 1, paidMinutes: 480 });
      expect(oct['2026-10-10']).toMatchObject({ status: 'PAID_LEAVE', scheduledMinutes: 240, paidMinutes: 240, workdayUnits: 0.5 });
      expect(oct['2026-10-11']).toMatchObject({ status: 'OFF', workdayUnits: 0, paidMinutes: 0 });
      expect(oct['2026-10-12']).toMatchObject({ workdayUnits: 1, paidMinutes: 480 });
      expect(oct['2026-10-17']).toMatchObject({ status: 'PAID_LEAVE', scheduledMinutes: 240, paidMinutes: 240, workdayUnits: 0.5 });
    });

    it('nghỉ qua ngày lễ: ngày lễ không bị tính là ngày nghỉ phép, hai ngày hai bên đủ 1 công', () => {
      expect(nov['2026-11-24']).toMatchObject({ status: 'PAID_LEAVE', workdayUnits: 1 });
      expect(nov['2026-11-25']).toMatchObject({ status: 'HOLIDAY', workdayUnits: 0 });
      expect(sourcesOf(nov['2026-11-25'])).toEqual([]);
      expect(nov['2026-11-26']).toMatchObject({ status: 'PAID_LEAVE', workdayUnits: 1 });
    });

    it('làm thêm giờ: số phút đã duyệt hiện đúng ở ngày thường, thứ Bảy sau ca, Chủ nhật và ngày lễ', () => {
      expect(cell(oct['2026-10-21'])).toMatchObject({ otMinutes: 240, workdayUnits: 0 });
      expect(oct['2026-10-21'].status).toBe('HOLIDAY');
      expect(oct['2026-10-22'].otMinutes).toBe(60);
      expect(oct['2026-10-24'].otMinutes).toBe(240);
      expect(oct['2026-10-25']).toMatchObject({ status: 'OFF', otMinutes: 240 });
      expect(oct['2026-10-26'].otMinutes).toBe(150);
      expect(oct['2026-10-28'].otMinutes).toBe(120);
      expect(sourcesOf(oct['2026-10-26'])).toEqual(['OT:150']);
    });

    it('công tác: cả ngày thường 1 công, nửa ngày sáng cộng nửa ngày chiều là 1 công', () => {
      for (const date of ['2026-10-29', '2026-10-30'])
        expect(oct[date]).toMatchObject({ status: 'TRIP', workdayUnits: 1, paidMinutes: 480 });
      expect(nov['2026-11-02']).toMatchObject({ status: 'TRIP', workdayUnits: 1, paidMinutes: 480 });
      expect(nov['2026-11-03']).toMatchObject({ status: 'TRIP', workdayUnits: 1, paidMinutes: 480 });
      expect(sourcesOf(nov['2026-11-03'])).toEqual(['TRIP:240', 'TRIP:240']);
      expect(nov['2026-11-16']).toMatchObject({ status: 'TRIP', workdayUnits: 1, paidMinutes: 480 });
    });

    it('công tác thứ Bảy ca ngắn: đơn phủ trọn ca được ghi nhận đủ phút của ca (240/240, hiển thị 1 công tác), tính 1 công', () => {
      for (const [days, date] of [[oct, '2026-10-31'], [nov, '2026-11-07'], [nov, '2026-11-14']] as const) {
        const day = days[date];
        expect(day).toMatchObject({ status: 'TRIP', scheduledMinutes: 240, paidMinutes: 240 });
        // Số phút của đơn bằng đúng số phút của ca nên màn hình bảng công tính là 1 ngày công tác (không phải 0.5CT).
        expect(day.sources.find((src: any) => src.kind === 'TRIP')?.minutes).toBe(day.scheduledMinutes);
        // Phiếu công tác cả ca thứ Bảy là 1 công dù ca chỉ có 4 giờ.
        expect(day.workdayUnits).toBe(1);
      }
    });

    it('giải trình công: giờ vào hoặc giờ ra bổ sung hoàn thiện ngày công', () => {
      // Thứ Hai 13/10: có giờ vào 08:00, giải trình giờ ra 17:00.
      expect(oct['2026-10-13']).toMatchObject({ status: 'PRESENT', workedMinutes: 480, workdayUnits: 1 });
      expect(oct['2026-10-13'].anomalies).toEqual([]);
      expect(sourcesOf(oct['2026-10-13'])).toEqual(['CORRECTION:null']);
      // Thứ Bảy 03/10: có giờ ra 12:00, giải trình giờ vào 08:00.
      expect(oct['2026-10-03']).toMatchObject({ status: 'PRESENT', workedMinutes: 240, workdayUnits: 0.5 });
      expect(oct['2026-10-03'].anomalies).toEqual([]);
    });

    it('tổng hợp tháng: công và phút làm thêm cộng đúng theo từng ngày', () => {
      const octDays = Object.values(oct);
      // 21/10 lễ 240, 22/10 60, 24/10 thứ Bảy 240, 25/10 Chủ nhật 240, 26/10 150, 28/10 120.
      expect(octDays.reduce((n, d) => n + d.otMinutes, 0)).toBe(1050);
      expect(octTotals.otMinutes).toBe(1050);
      expect(octTotals.workdayUnits).toBe(octDays.reduce((n, d) => n + d.workdayUnits, 0));
    });
  });

});
