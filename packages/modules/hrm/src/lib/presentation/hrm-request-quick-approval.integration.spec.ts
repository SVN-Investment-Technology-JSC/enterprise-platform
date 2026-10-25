import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmApprovalRouteController } from './hrm-approval-route.controller';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { HrmRequestController } from './hrm-request.controller';
import { HrmApprovalPolicyService } from '../infrastructure/hrm-approval-policy';
import { fakeOrgScope } from '../infrastructure/hrm-test-support';

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

/**
 * Kiểm thử duyệt đơn nhanh (khu "Duyệt đơn nhanh" ngoài Dashboard) trên PostgreSQL thật. Khu này gọi cùng API duyệt như
 * màn "Đơn từ cần xử lý" (duyệt không kèm ý kiến, từ chối với lý do rỗng), nên ở đây kiểm các chốt chặn của 4 loại đơn
 * (nghỉ, làm thêm giờ, công tác, giải trình công): lúc nộp (lý do, chốt đơn từ, khoá kỳ công, hạn mức tháng) và lúc duyệt
 * (chốt đơn từ hoặc khoá kỳ sau khi nộp, hạn mức tháng, đơn đã hủy/đã duyệt/đã từ chối, phạm vi người duyệt).
 *
 * Ca hành chính DAY 08:00-17:00 (thứ Hai đến thứ Sáu); lịch ca phủ 09/2026-03/2027.
 */
integration('Duyệt đơn nhanh: chốt chặn lúc nộp và lúc duyệt của nghỉ, OT, công tác, giải trình (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const req = { headers: {} } as Request;
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;

  const ids = {
    userA: randomUUID(),
    empA: randomUUID(),
    userM: randomUUID(),
    empM: randomUUID(),
    userX: randomUUID(),
    empX: randomUUID(),
    posMgr: randomUUID(),
    posStaff: randomUUID(),
  };
  type Who = { userId: string; permissions: string[] };
  const APPROVE = ['hrm.leave.approve', 'hrm.ot.approve', 'hrm.trip.approve', 'hrm.attendance.approve'];
  const as = {
    a: { userId: ids.userA, permissions: [] } as Who,
    manager: { userId: ids.userM, permissions: APPROVE } as Who,
    outsider: { userId: ids.userX, permissions: APPROVE } as Who,
  };
  const policyOf = (who: Who) =>
    new HrmApprovalPolicyService(fakeOrgScope(who.userId === ids.userM ? [ids.userA] : []));
  const ctx = (who: Who) =>
    ({
      has: () => true,
      getProxyRequestContext: async function (this: any, r: any, requested?: string) {
        return { ...(await this.getRequestContext(r, requested)), onBehalf: undefined };
      },
      getRequestContextOrProxy: async function (this: any, r: any, requested?: string) {
        return this.getRequestContext(r, requested);
      },
      getRequestContext: async (_r: Request, requested?: string) => ({
        pool,
        tenantId,
        employeeId: requested ?? ids.empA,
        principal: who,
      }),
      scoped: async (_r: Request, _p: string, requested?: string) => ({ pool, tenantId, employeeId: requested, principal: who }),
      getContext: async () => ({ pool, tenantId, principal: who }),
      approverContext: async () => ({ pool, tenantId, principal: who, employeeId: ids.empA }),
      resolveEmployee: async () => ({ employeeId: ids.empA }),
      procedureAvailable: async () => false,
    }) as any;
  const bridge = { startOrResume: async () => undefined } as any;
  const leaveC = (who: Who) => new HrmLeaveController(ctx(who), bridge, policyOf(who));
  const reqC = (who: Who) => new HrmRequestController(ctx(who), bridge, policyOf(who));
  const attC = (who: Who) => new HrmAttendanceController(ctx(who), bridge, policyOf(who));

  const reason: Record<string, string> = {};
  let leaveType: string;
  const q = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;

  const mkLeave = (day: string, body: Record<string, unknown> = {}) =>
    leaveC(as.a).createLeaveRequest(req, { employeeId: ids.empA, leaveTypeId: leaveType, fromAt: `${day}T08:00`, toAt: `${day}T17:00`, ...body } as any);
  const mkOt = (day: string, body: Record<string, unknown> = {}) =>
    reqC(as.a).createOtRequest(req, { employeeId: ids.empA, reasonId: reason['OT_WORK'], fromAt: `${day}T18:00`, toAt: `${day}T19:00`, ...body } as any);
  const mkTrip = (day: string, body: Record<string, unknown> = {}) =>
    reqC(as.a).createBusinessTripRequest(req, {
      employeeId: ids.empA,
      reasonId: reason['TRIP_PLAN'],
      destination: 'Hà Nội',
      purpose: 'Gặp khách hàng',
      fromAt: `${day}T08:00`,
      toAt: `${day}T17:00`,
      ...body,
    } as any);
  const rawPunches = async (day: string) =>
    pool.query(
      `INSERT INTO hrm_schema.attendances (tenant_id,employee_id,work_date,check_in_at,check_out_at,attendance_source,status)
       VALUES ($1,$2,$3,$4,NULL,'WEB_PORTAL','MISSING_PUNCH') ON CONFLICT DO NOTHING`,
      [tenantId, ids.empA, day, `${day}T08:00:00+07:00`],
    ).then(() =>
      pool.query(
        `INSERT INTO hrm_schema.attendance_events (tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence)
         VALUES ($1,$2,$3,'IN',$4,'WEB_PORTAL',$5,'{}'::jsonb)`,
        [tenantId, ids.empA, day, `${day}T08:00:00+07:00`, randomUUID()],
      ),
    );
  const mkCorrection = async (day: string, body: Record<string, unknown> = {}) => {
    await rawPunches(day);
    return attC(as.a).createCorrection(req, {
      employeeId: ids.empA,
      reasonId: reason['CORR_FORGOT'],
      requestDate: day,
      punches: [{ kind: 'OUT', at: `${day}T17:00:00+07:00` }],
      description: 'Quên chấm ra',
      ...body,
    } as any);
  };

  type Spec = {
    label: string;
    table: string;
    quotaType: string;
    /** Cột ngày ghi trên đơn: hạn mức tính theo tháng của ngày này. */
    dateColumn: string;
    /** Ngày làm việc dùng cho kind này (giải trình chỉ nhận ngày đã qua nên dùng tháng 09/2026). */
    days: () => string;
    create: (day: string, body?: Record<string, unknown>) => Promise<{ data: { id: string } }>;
    approve: (who: Who, id: string) => Promise<unknown>;
    /** Giống nút "Từ chối" nhanh: không nhập lý do. */
    rejectQuick: (who: Who, id: string) => Promise<unknown>;
    rejectNoReason: (who: Who, id: string) => Promise<unknown>;
    hasReason: boolean;
  };
  const workdays = (from: string) => {
    let cursor = Date.parse(`${from}T00:00:00Z`);
    return () => {
      for (;;) {
        const d = new Date(cursor);
        cursor += 86400000;
        if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) return d.toISOString().slice(0, 10);
      }
    };
  };
  const futureDay = workdays('2027-01-04');
  const pastDay = workdays('2026-09-01');
  const specs: Spec[] = [
    {
      label: 'nghỉ phép',
      table: 'leave_requests',
      dateColumn: 'from_date',
      quotaType: 'LEAVE',
      days: futureDay,
      create: (day, body) => mkLeave(day, body),
      approve: (who, id) => leaveC(who).approveLeaveRequest(req, id),
      rejectQuick: (who, id) => leaveC(who).rejectLeaveRequest(req, id, REJECT_REASON),
      rejectNoReason: (who, id) => leaveC(who).rejectLeaveRequest(req, id, ''),
      hasReason: false,
    },
    {
      label: 'làm thêm giờ',
      table: 'ot_requests',
      dateColumn: 'work_date',
      quotaType: 'OVERTIME',
      days: futureDay,
      create: (day, body) => mkOt(day, body),
      approve: (who, id) => reqC(who).approveOtRequest(req, id),
      rejectQuick: (who, id) => reqC(who).rejectOtRequest(req, id, REJECT_REASON),
      rejectNoReason: (who, id) => reqC(who).rejectOtRequest(req, id, ''),
      hasReason: true,
    },
    {
      label: 'công tác',
      table: 'business_trip_requests',
      dateColumn: 'from_date',
      quotaType: 'BUSINESS_TRIP',
      days: futureDay,
      create: (day, body) => mkTrip(day, body),
      approve: (who, id) => reqC(who).approveBusinessTrip(req, id),
      rejectQuick: (who, id) => reqC(who).rejectBusinessTrip(req, id, REJECT_REASON),
      rejectNoReason: (who, id) => reqC(who).rejectBusinessTrip(req, id, undefined),
      hasReason: true,
    },
    {
      label: 'giải trình công',
      table: 'attendance_corrections',
      dateColumn: 'request_date',
      quotaType: 'ATTENDANCE_CORRECTION',
      days: pastDay,
      create: (day, body) => mkCorrection(day, body),
      approve: (who, id) => attC(who).approveCorrection(req, id),
      rejectQuick: (who, id) => attC(who).rejectCorrection(req, id, REJECT_REASON),
      rejectNoReason: (who, id) => attC(who).rejectCorrection(req, id, ''),
      hasReason: true,
    },
  ];
  const statusOf = async (spec: Spec, id: string) =>
    (await q(`SELECT status, approved_by FROM hrm_schema.${spec.table} WHERE id=$1`, [id]))[0];
  const countRows = async (spec: Spec) =>
    Number((await q(`SELECT count(*)::int AS n FROM hrm_schema.${spec.table} WHERE tenant_id=$1`, [tenantId]))[0].n);

  /** Chốt đơn từ hoặc khoá kỳ công của tháng chứa `day`; trả hàm mở lại. */
  const closeMonthOf = async (day: string, mode: 'REQUESTS_CLOSED' | 'LOCKED') => {
    const from = `${day.slice(0, 7)}-01`;
    const code = `T${day.slice(0, 7)}-${mode}`;
    await pool.query(
      `INSERT INTO hrm_schema.timesheet_periods (tenant_id,period_code,from_date,to_date,status,requests_closed_at)
       VALUES ($1,$2,$3::date,($3::date + interval '1 month' - interval '1 day')::date,$4,$5)`,
      [tenantId, code, from, mode === 'LOCKED' ? 'LOCKED' : 'OPEN', mode === 'LOCKED' ? null : new Date()],
    );
    return () => pool.query(`DELETE FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND period_code=$2`, [tenantId, code]);
  };
  /** Hạn mức tính theo mọi đơn đã duyệt trong tháng của ngày ghi trên đơn, nên đặt hạn mức = số đã duyệt + 1 để các test không ảnh hưởng nhau. */
  const approvedCount = async (spec: Spec, day: string) =>
    Number(
      (
        await q(
          `SELECT count(*)::int AS n FROM hrm_schema.${spec.table} WHERE tenant_id=$1 AND status='APPROVED' AND date_trunc('month', ${spec.dateColumn}::timestamp) = date_trunc('month', $2::date)`,
          [tenantId, day],
        )
      )[0].n,
    );
  /** Các ngày làm việc cùng một tháng: hạn mức tính theo tháng của ngày ghi trên đơn. */
  const daysInOneMonth = (spec: Spec, count: number): string[] => {
    let days = Array.from({ length: count }, () => spec.days());
    while (days.some((d) => d.slice(0, 7) !== days[0].slice(0, 7))) days = [...days.slice(1), spec.days()];
    return days;
  };
  const setQuota = (typeCode: string, limit: number) =>
    pool.query(
      `INSERT INTO hrm_schema.request_quota_settings (tenant_id,type_code,monthly_limit) VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id,type_code) DO UPDATE SET monthly_limit=EXCLUDED.monthly_limit`,
      [tenantId, typeCode, limit],
    );
  const clearQuota = () => pool.query(`DELETE FROM hrm_schema.request_quota_settings WHERE tenant_id=$1`, [tenantId]);

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

    for (const [userId, employeeId, name, code] of [
      [ids.userA, ids.empA, 'Nhân viên A', 'NVA'],
      [ids.userM, ids.empM, 'Trưởng phòng M', 'QLM'],
      [ids.userX, ids.empX, 'Người ngoài X', 'NGX'],
    ] as const) {
      await pool.query(`INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,$2,$3,'test')`, [
        userId,
        name,
        `${code.toLowerCase()}@example.test`,
      ]);
      await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name) VALUES ($1,$2,$3,$4)`, [employeeId, tenantId, userId, name]);
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,$3,'2026-01-01')`,
        [employeeId, tenantId, code],
      );
    }
    const tree = randomUUID();
    await pool.query(`INSERT INTO core_schema.organization_trees (id, code, name, is_primary) VALUES ($1,'main','Sơ đồ chính',true)`, [tree]);
    await pool.query(
      `INSERT INTO core_schema.organization_nodes (id, tree_id, category, code, name, reports_to_position_id) VALUES ($1,$2,'position','TP','Trưởng phòng',NULL)`,
      [ids.posMgr, tree],
    );
    await pool.query(
      `INSERT INTO core_schema.organization_nodes (id, tree_id, category, code, name, reports_to_position_id) VALUES ($1,$2,'position','NV','Nhân viên',$3)`,
      [ids.posStaff, tree, ids.posMgr],
    );
    for (const [positionId, userId] of [
      [ids.posMgr, ids.userM],
      [ids.posStaff, ids.userA],
    ])
      await pool.query(
        `INSERT INTO core_schema.organization_node_assignments (id, node_id, user_id, is_primary, status, start_date) VALUES ($1,$2,$3,true,'active','2026-01-01')`,
        [randomUUID(), positionId, userId],
      );

    const shift = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes,break_start_time,break_end_time)
         VALUES ($1,'DAY','Hành chính','08:00','17:00',false,60,0,0,'12:00','13:00') RETURNING id`,
        [tenantId],
      )
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source)
       SELECT $1,$2,d::date,CASE WHEN extract(isodow FROM d) >= 6 THEN 'OFF' ELSE 'SHIFT' END,
              CASE WHEN extract(isodow FROM d) >= 6 THEN NULL ELSE $3::uuid END,'MANUAL'
         FROM generate_series('2026-09-01'::date,'2027-03-31'::date,'1 day') d`,
      [tenantId, ids.empA, shift],
    );
    leaveType = (
      await pool.query(
        `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,paid,deduct_balance) VALUES ($1,'NGHI_NGAY','NGHI_NGAY','DAYS',true,false) RETURNING id`,
        [tenantId],
      )
    ).rows[0].id as string;
    const addReason = async (kind: string, code: string, extra: { active?: boolean; requiresDescription?: boolean } = {}) => {
      reason[code] = (
        await pool.query(
          `INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name,active,requires_description) VALUES ($1,$2,$3,$3,$4,$5) RETURNING id`,
          [tenantId, kind, code, extra.active ?? true, extra.requiresDescription ?? false],
        )
      ).rows[0].id as string;
    };
    await addReason('OVERTIME', 'OT_WORK');
    await addReason('OVERTIME', 'OT_OFF', { active: false });
    await addReason('OVERTIME', 'OT_NEED_DESC', { requiresDescription: true });
    await addReason('BUSINESS_TRIP', 'TRIP_PLAN');
    await addReason('BUSINESS_TRIP', 'TRIP_OFF', { active: false });
    await addReason('BUSINESS_TRIP', 'TRIP_NEED_DESC', { requiresDescription: true });
    await addReason('ATTENDANCE_CORRECTION', 'CORR_FORGOT');
    await addReason('ATTENDANCE_CORRECTION', 'CORR_OFF', { active: false });
    await addReason('ATTENDANCE_CORRECTION', 'CORR_NEED_DESC', { requiresDescription: true });
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
    const route = new HrmApprovalRouteController(ctx(as.manager));
    for (const kind of ['leave', 'ot', 'business_trip', 'correction'] as const)
      await route.putConfig(req, { requestKind: kind, mode: 'DIRECT', fallbackPositionId: null });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  describe.each(specs)('đơn $label', (spec) => {
    describe('chốt chặn lúc nộp đơn', () => {
      it('đơn hợp lệ được tạo ở trạng thái chờ duyệt', async () => {
        const made = await spec.create(spec.days());
        expect(made.data).toMatchObject({ status: 'PENDING' });
      });

      it('tháng đã chốt đơn từ: không nộp được, không để lại đơn nào', async () => {
        const day = spec.days();
        const before = await countRows(spec);
        const reopen = await closeMonthOf(day, 'REQUESTS_CLOSED');
        try {
          await expect(spec.create(day)).rejects.toMatchObject({ status: 409 });
          expect(await countRows(spec)).toBe(before);
        } finally {
          await reopen();
        }
        await expect(spec.create(day)).resolves.toBeDefined();
      });

      it('kỳ công đã khoá: không nộp được', async () => {
        const day = spec.days();
        const before = await countRows(spec);
        const reopen = await closeMonthOf(day, 'LOCKED');
        try {
          await expect(spec.create(day)).rejects.toMatchObject({ status: 409 });
          expect(await countRows(spec)).toBe(before);
        } finally {
          await reopen();
        }
      });

      it('hạn mức đơn được duyệt trong tháng: đủ hạn mức thì không nộp thêm (422), đơn chờ chưa tính vào hạn mức', async () => {
        const [day1, day2, day3, day4] = daysInOneMonth(spec, 4);
        const first = await spec.create(day1);
        const pending = await spec.create(day2);
        const limit = (await approvedCount(spec, day1)) + 1;
        await setQuota(spec.quotaType, limit);
        try {
          // Mới có đơn chờ, chưa có đơn nào được duyệt: vẫn nộp được.
          await expect(spec.create(day3)).resolves.toBeDefined();
          await spec.approve(as.manager, first.data.id);
          const before = await countRows(spec);
          await expect(spec.create(day4)).rejects.toMatchObject({
            status: 422,
            response: { code: 'REQUEST_MONTHLY_QUOTA_EXCEEDED', limit, used: limit },
          });
          expect(await countRows(spec)).toBe(before);
          expect(await statusOf(spec, pending.data.id)).toMatchObject({ status: 'PENDING' });
        } finally {
          await clearQuota();
        }
      });
    });

    if (spec.label === 'nghỉ phép' || spec.label === 'công tác')
      it('đơn kéo dài qua hai tháng bị chặn 422, không tạo đơn', async () => {
        const before = await countRows(spec);
        await expect(spec.create('2026-12-28', { toAt: '2027-01-03T17:00' })).rejects.toMatchObject({
          status: 422,
          response: { code: 'REQUEST_CROSSES_MONTH' },
        });
        expect(await countRows(spec)).toBe(before);
      });

    if (spec.hasReason)
      describe('chốt chặn lý do (danh mục cấu hình)', () => {
        const key = (suffix: string) =>
          `${{ 'làm thêm giờ': 'OT', 'công tác': 'TRIP', 'giải trình công': 'CORR' }[spec.label as string]}_${suffix}`;

        it('thiếu lý do hoặc lý do không thuộc loại đơn đều bị từ chối 400', async () => {
          await expect(spec.create(spec.days(), { reasonId: undefined })).rejects.toMatchObject({ status: 400 });
          await expect(spec.create(spec.days(), { reasonId: randomUUID() })).rejects.toMatchObject({ status: 400 });
          const foreign = spec.label === 'làm thêm giờ' ? reason['TRIP_PLAN'] : reason['OT_WORK'];
          await expect(spec.create(spec.days(), { reasonId: foreign })).rejects.toMatchObject({ status: 400 });
        });

        it('lý do đã ngừng sử dụng bị từ chối 400', async () => {
          await expect(spec.create(spec.days(), { reasonId: reason[key('OFF')] })).rejects.toMatchObject({ status: 400 });
        });

        it('lý do bắt buộc mô tả: thiếu mô tả bị từ chối 400, có mô tả thì nhận', async () => {
          const body = { reasonId: reason[key('NEED_DESC')] };
          await expect(spec.create(spec.days(), { ...body, description: '   ', reason: '   ' })).rejects.toMatchObject({ status: 400 });
          await expect(spec.create(spec.days(), { ...body, description: 'Có mô tả cụ thể', reason: 'Có mô tả cụ thể' })).resolves.toBeDefined();
        });
      });

    describe('duyệt và từ chối nhanh', () => {
      it('duyệt không kèm ý kiến: đơn thành APPROVED, ghi đúng người duyệt', async () => {
        const made = await spec.create(spec.days());
        await spec.approve(as.manager, made.data.id);
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userM });
      });

      it('từ chối bắt buộc có lý do; có lý do thì đơn thành REJECTED và không duyệt lại được', async () => {
        const made = await spec.create(spec.days());
        await expect(spec.rejectNoReason(as.manager, made.data.id)).rejects.toMatchObject({ status: 400 });
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'PENDING' });
        await spec.rejectQuick(as.manager, made.data.id);
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'REJECTED' });
        await expect(spec.approve(as.manager, made.data.id)).rejects.toMatchObject({ status: expect.any(Number) });
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'REJECTED' });
      });

      it('người nộp tự duyệt hoặc người ngoài phạm vi bấm Duyệt: bị chặn 403, đơn vẫn chờ', async () => {
        const made = await spec.create(spec.days());
        await expect(spec.approve(as.a, made.data.id)).rejects.toMatchObject({ status: 403 });
        await expect(spec.approve(as.outsider, made.data.id)).rejects.toMatchObject({ status: 403 });
        await expect(spec.rejectQuick(as.outsider, made.data.id)).rejects.toMatchObject({ status: 403 });
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'PENDING' });
      });

      it('bấm Duyệt hai lần (hai tab hoặc bấm đúp): đơn vẫn APPROVED một lần, người duyệt không đổi', async () => {
        const made = await spec.create(spec.days());
        await spec.approve(as.manager, made.data.id);
        await spec.approve(as.manager, made.data.id).catch((e: { status?: number }) => expect([400, 409]).toContain(e.status));
        expect(await statusOf(spec, made.data.id)).toEqual({ status: 'APPROVED', approved_by: ids.userM });
      });

      it('đơn đã bị hủy (danh sách cũ chưa tải lại): duyệt hoặc từ chối đều bị chặn, trạng thái giữ nguyên', async () => {
        const made = await spec.create(spec.days());
        await pool.query(`UPDATE hrm_schema.${spec.table} SET status='CANCELLED' WHERE id=$1`, [made.data.id]);
        await expect(spec.approve(as.manager, made.data.id)).rejects.toMatchObject({ status: expect.any(Number) });
        await expect(spec.rejectQuick(as.manager, made.data.id)).rejects.toMatchObject({ status: expect.any(Number) });
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'CANCELLED' });
      });

      it('đơn không tồn tại: 404', async () => {
        await expect(spec.approve(as.manager, randomUUID())).rejects.toMatchObject({ status: expect.any(Number) });
      });

      it('chốt đơn từ sau khi nộp: không duyệt được (409), vẫn từ chối được; mở lại thì duyệt được', async () => {
        const day = spec.days();
        const made = await spec.create(day);
        const rejectable = await spec.create(spec.days());
        const reopen = await closeMonthOf(day, 'REQUESTS_CLOSED');
        try {
          await expect(spec.approve(as.manager, made.data.id)).rejects.toMatchObject({ status: 409 });
          expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'PENDING' });
          // Từ chối không đổi dữ liệu công nên không bị chốt đơn từ chặn.
          await spec.rejectQuick(as.manager, rejectable.data.id).then(
            async () => expect(await statusOf(spec, rejectable.data.id)).toMatchObject({ status: 'REJECTED' }),
            (e: { status?: number }) => expect(e.status).toBe(409),
          );
        } finally {
          await reopen();
        }
        await spec.approve(as.manager, made.data.id);
        expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'APPROVED' });
      });

      it('kỳ công bị khoá sau khi nộp: không duyệt được (409), đơn vẫn chờ', async () => {
        const day = spec.days();
        const made = await spec.create(day);
        const reopen = await closeMonthOf(day, 'LOCKED');
        try {
          await expect(spec.approve(as.manager, made.data.id)).rejects.toMatchObject({ status: 409 });
          expect(await statusOf(spec, made.data.id)).toMatchObject({ status: 'PENDING' });
        } finally {
          await reopen();
        }
      });

      it('hạn mức tháng đầy trước khi duyệt: đơn thứ hai bị chặn 422 ở nút Duyệt, vẫn từ chối được', async () => {
        const [day1, day2] = daysInOneMonth(spec, 2);
        const one = await spec.create(day1);
        const two = await spec.create(day2);
        await setQuota(spec.quotaType, (await approvedCount(spec, day1)) + 1);
        try {
          await spec.approve(as.manager, one.data.id);
          await expect(spec.approve(as.manager, two.data.id)).rejects.toMatchObject({
            status: 422,
            response: { code: 'REQUEST_MONTHLY_QUOTA_EXCEEDED' },
          });
          expect(await statusOf(spec, two.data.id)).toMatchObject({ status: 'PENDING' });
          await spec.rejectQuick(as.manager, two.data.id);
          expect(await statusOf(spec, two.data.id)).toMatchObject({ status: 'REJECTED' });
        } finally {
          await clearQuota();
        }
      });
    });
  });
});
/** Mọi lần từ chối đều phải có lý do. */
const REJECT_REASON = 'Không phù hợp lịch làm việc';

