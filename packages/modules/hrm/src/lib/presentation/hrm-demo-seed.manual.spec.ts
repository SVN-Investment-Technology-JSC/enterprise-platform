/**
 * CÔNG CỤ THỦ CÔNG, không phải test tự động: tạo bộ nhân viên TEST01..TEST13 với đủ các trường hợp chấm công, đơn từ, phân ca
 * trong tháng 09/2026 để thử bảng công, chốt công và bảng lương bằng giao diện. Mặc định bị bỏ qua.
 *
 *   HRM_DEMO_SEED_DATABASE_URL=<URL database của tenant>  HRM_DEMO_SEED_CONFIRM=yes  [HRM_DEMO_SEED_TENANT=<uuid tenant>]
 *   pnpm --dir packages/modules/hrm exec jest src/lib/presentation/hrm-demo-seed.manual.spec.ts --runInBand
 *
 * Chỉ ghi dữ liệu của nhân viên TEST (mã TESTxx) và danh mục tối thiểu cho họ; không đụng dữ liệu nhân viên thật, không
 * chốt đơn từ/chốt công, không tạo kỳ lương. Chạy lần hai sẽ dừng (đã có TEST01).
 *
 * Chế độ kiểm thử công cụ trên PostgreSQL dùng một lần: HRM_TEST_ADMIN_URL + HRM_DEMO_SEED_HARNESS=1.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import { ingestEvent } from '../infrastructure/hrm-attendance-ingest';
import { transitionLeave } from '../infrastructure/hrm-leave-operations';
import { approveOvertime } from '../infrastructure/hrm-overtime';
import { approveAttendanceCorrection, approveBusinessTrip } from '../infrastructure/hrm-request-transition';
import { testApprovalPolicy } from '../infrastructure/hrm-test-support';
import { hrmTransaction } from '../infrastructure/hrm-transaction';
import { createHoliday } from '../infrastructure/hrm-work-schedule';
import { loadBoard } from '../infrastructure/hrm-timesheet-board';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { HrmRequestController } from './hrm-request.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({ HrmContextService: class {} }));

const MONTH = '2026-09';
const realUrl = process.env.HRM_DEMO_SEED_DATABASE_URL;
const harness = process.env.HRM_DEMO_SEED_HARNESS === '1' && Boolean(process.env.HRM_TEST_ADMIN_URL);
const enabled = (Boolean(realUrl) && process.env.HRM_DEMO_SEED_CONFIRM === 'yes') || harness;
const suite = enabled ? describe : describe.skip;

type Pg = ReturnType<typeof createPostgresPool>;
const say = (line: string) => process.stdout.write(`${line}\n`);

/** Ngày dd của tháng seed. */
const D = (n: number) => `${MONTH}-${String(n).padStart(2, '0')}`;
/** Mốc giờ Việt Nam (UTC+7) dạng ISO. */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`).toISOString();
const nextDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
/**
 * Ngày làm việc thường trong tháng 9/2026 (1/9 là thứ Ba). Ngày 2/9 là lễ Quốc khánh của công ty (lịch công ty có sẵn) nên không nằm
 * trong danh sách: ai không đi làm thì hưởng lễ, TEST10 đi làm ngày lễ.
 */
const WORKDAYS = [1, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 28, 29, 30];
const WEEKENDS = [5, 6, 12, 13, 19, 20, 26, 27];

async function registeredMigrations(): Promise<string[]> {
  const source = await readFile(
    resolve(process.cwd(), '../../../packages/platform/entitlement/src/lib/tenant-migrations.ts'),
    'utf8',
  );
  const between = (from: string, to: string) => {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start + 1);
    return [...source.slice(start, end === -1 ? undefined : end).matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
  };
  return [
    ...between('export const TENANT_CORE_MIGRATIONS', 'export const TENANT_MODULE_MIGRATIONS'),
    'tenant/0001-integration.sql',
    ...between('  hrm: [', '  inventory: ['),
  ];
}

interface Emp {
  code: string;
  name: string;
  scenario: string;
  id: string;
  userId: string;
  joinDate?: string;
  inactiveFrom?: string | null;
}

export async function seedDemo(pool: Pg, tenantId: string) {
  const req = { headers: {} } as Request;
  const tx = <T>(work: (db: PoolClient) => Promise<T>) => hrmTransaction(pool as unknown as Pool, work);
  const one = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0];

  // ---------------------------------------------------------------- Điều kiện an toàn
  if ((await one(`SELECT 1 AS x FROM hrm_schema.employee_profiles WHERE tenant_id=$1 AND employee_code='TEST01'`, [tenantId]))) {
    throw new Error('Đã có nhân viên TEST01: dữ liệu test đã được tạo trước đó. Không tạo lại.');
  }
  const period = await one(
    `SELECT status, requests_closed_at FROM hrm_schema.timesheet_periods WHERE tenant_id=$1 AND period_code=$2`,
    [tenantId, MONTH],
  );
  if (period && (period.status === 'LOCKED' || period.requests_closed_at))
    throw new Error(`Tháng ${MONTH} đã chốt đơn từ hoặc chốt công; không thêm dữ liệu test vào tháng đã chốt.`);

  const actor = randomUUID();
  const approverId = randomUUID();
  await pool.query(
    `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,'Người duyệt TEST','test-approver@test.invalid','test-only'),($2,'Người tạo TEST','test-actor@test.invalid','test-only')`,
    [approverId, actor],
  );
  const principal = { userId: actor, permissions: ['hrm.manage'] };

  // ---------------------------------------------------------------- Nhân viên
  const emps: Emp[] = [
    { code: 'TEST01', name: 'Test 01 - Đi làm đủ', scenario: 'Đi làm đủ, đúng giờ; thứ Bảy 5/9 là ngày làm bù (có ca, có chấm); 2/9 lễ Quốc khánh hưởng lương' },
    { code: 'TEST02', name: 'Test 02 - Chấm công lỗi', scenario: 'Trễ, sớm, trễ+sớm, trong ân hạn, thiếu vào/ra, vắng, chấm trùng' },
    { code: 'TEST03', name: 'Test 03 - Nghỉ phép', scenario: 'Nghỉ cả ngày, nửa ngày sáng/chiều, không lương, nhiều ngày qua cuối tuần, đơn nghỉ chờ duyệt' },
    { code: 'TEST04', name: 'Test 04 - Nghỉ và lỗi chấm', scenario: 'Nghỉ cả ngày còn chấm lẻ (không chặn), nghỉ nửa ngày thiếu chấm ra (bất thường), làm trong ngày nghỉ' },
    { code: 'TEST05', name: 'Test 05 - Tăng ca', scenario: 'OT tính theo đơn (không cần chấm ra): OT 2h sau ca (hệ số theo chính sách OT), OT 4h qua đêm 22h-2h hệ số 2 theo lý do, OT ngày nghỉ hệ số 3 theo lý do, OT trộn giờ ngày và đêm 21h-23h, OT chờ duyệt (không tính), làm quá ca không có đơn OT' },
    { code: 'TEST06', name: 'Test 06 - Công tác', scenario: 'Công tác 1 ngày, nhiều ngày qua cuối tuần (quốc tế), nửa ngày, đơn chờ duyệt, vừa công tác vừa chấm' },
    { code: 'TEST07', name: 'Test 07 - Công tác theo giờ', scenario: 'Công tác 3h và 4h = 0,5 ngày (nửa kia chấm công, không tính trễ), 5h và cả ngày = 1 ngày không cần chấm; công tác nửa ngày thiếu chấm nửa kia' },
    { code: 'TEST08', name: 'Test 08 - Giải trình công', scenario: 'Giải trình đã duyệt (bổ sung giờ), bổ sung cả ngày không chấm, giải trình chờ duyệt' },
    { code: 'TEST09', name: 'Test 09 - Chưa phân ca', scenario: 'Nhiều ngày làm việc chưa có ca (chặn chốt công), có chấm công mà không có ca' },
    { code: 'TEST10', name: 'Test 10 - Ngày lễ', scenario: 'Lễ Quốc khánh 2/9: TEST10 đi làm CÓ đơn OT (tính tăng ca), TEST01 đi làm KHÔNG có đơn OT (không tính công); lễ riêng có lương (8/9), không lương (9/9)' },
    { code: 'TEST11', name: 'Test 11 - Nghỉ việc giữa kỳ', scenario: 'Nghỉ việc từ 21/9, chỉ có công đến 18/9', inactiveFrom: D(21) },
    { code: 'TEST12', name: 'Test 12 - Vào làm giữa kỳ', scenario: 'Vào làm từ 14/9', joinDate: D(14) },
    { code: 'TEST13', name: 'Test 13 - Ca đêm', scenario: 'Ca 22:00-06:00 qua đêm: đủ, trễ, thiếu chấm ra, về sớm' },
  ].map((e) => ({ ...e, id: randomUUID(), userId: randomUUID() }));

  for (const e of emps) {
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,$2,$3,'test-only')`,
      [e.userId, e.name, `${e.code.toLowerCase()}@test.invalid`],
    );
    await pool.query(`INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name) VALUES ($1,$2,$3,$4)`, [
      e.id,
      tenantId,
      e.userId,
      e.name,
    ]);
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date, inactive_from) VALUES ($1,$2,$3,$4,$5)`,
      [e.id, tenantId, e.code, e.joinDate ?? '2026-01-01', e.inactiveFrom ?? null],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_salary_profiles (tenant_id,employee_id,salary_type,base_salary,effective_from) VALUES ($1,$2,'GROSS',15000000,'2026-01-01')`,
      [tenantId, e.id],
    );
  }
  const emp = (code: string) => emps.find((e) => e.code === code)!;

  // ---------------------------------------------------------------- Ca, lý do, loại nghỉ
  const shift = async (code: string, name: string, start: string, end: string, cross: boolean, bs: string, be: string) => {
    const found = await one(`SELECT id FROM hrm_schema.shift_definitions WHERE tenant_id=$1 AND code=$2`, [tenantId, code]);
    if (found) return found.id as string;
    return (
      await one(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes,break_start_time,break_end_time)
         VALUES ($1,$2,$3,$4,$5,$6,60,10,5,$7,$8) RETURNING id`,
        [tenantId, code, name, start, end, cross, bs, be],
      )
    ).id as string;
  };
  const shiftHc = await shift('TEST-HC', '[TEST] Hành chính', '08:00', '17:00', false, '12:00', '13:00');
  const shiftDem = await shift('TEST-DEM', '[TEST] Ca đêm', '22:00', '06:00', true, '02:00', '03:00');

  const leaveType = async (code: string, name: string, paid: boolean) => {
    const found = await one(`SELECT id FROM hrm_schema.leave_types WHERE tenant_id=$1 AND code=$2`, [tenantId, code]);
    if (found) return found.id as string;
    return (
      await one(
        `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,paid,deduct_balance) VALUES ($1,$2,$3,'DAYS',$4,false) RETURNING id`,
        [tenantId, code, name, paid],
      )
    ).id as string;
  };
  const paidLeave = await leaveType('TEST_NGHI_CO_LUONG', '[TEST] Nghỉ có lương', true);
  const unpaidLeave = await leaveType('TEST_NGHI_KHONG_LUONG', '[TEST] Nghỉ không lương', false);

  const reason = async (kind: string, code: string, name: string) => {
    const existing = await one(
      `SELECT id FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND kind=$2 AND active ORDER BY sort_order, created_at LIMIT 1`,
      [tenantId, kind],
    );
    if (existing) return existing.id as string;
    return (
      await one(`INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name) VALUES ($1,$2,$3,$4) RETURNING id`, [
        tenantId,
        kind,
        code,
        name,
      ])
    ).id as string;
  };
  const otReason = await reason('OVERTIME', 'TEST_OT', '[TEST] Tăng ca theo công việc');
  // Lý do tăng ca có hệ số riêng (cấu hình động): đơn chọn lý do này lấy hệ số của lý do để tính lương, thay hệ số theo chính sách OT.
  const ratedReason = async (code: string, name: string, rate: number) => {
    const existing = await one(`SELECT id FROM hrm_schema.request_reasons WHERE tenant_id=$1 AND kind='OVERTIME' AND code=$2`, [tenantId, code]);
    if (existing) return existing.id as string;
    return (
      await one(`INSERT INTO hrm_schema.request_reasons (tenant_id,kind,code,name,rate_multiplier) VALUES ($1,'OVERTIME',$2,$3,$4) RETURNING id`, [
        tenantId,
        code,
        name,
        rate,
      ])
    ).id as string;
  };
  const otProjectReason = await ratedReason('TEST_OT_X2', '[TEST] Tăng ca dự án (hệ số 2)', 2);
  const otUrgentReason = await ratedReason('TEST_OT_X3', '[TEST] Tăng ca khẩn / ngày nghỉ (hệ số 3)', 3);
  const tripReason = await reason('BUSINESS_TRIP', 'TEST_CONG_TAC', '[TEST] Công tác theo kế hoạch');
  const fixReason = await reason('ATTENDANCE_CORRECTION', 'TEST_GIAI_TRINH', '[TEST] Quên chấm công');

  // ---------------------------------------------------------------- Lịch phân ca
  const schedule = async (e: Emp, days: number[], dayShift: string, dayShiftOnWeekday = true) => {
    for (const n of days) {
      const weekend = WEEKENDS.includes(n);
      // 2/9 là lễ Quốc khánh của công ty: lịch ghi ngày lễ (giữ ca thường lệ để tính công ngày lễ), như khi tạo ngày lễ trong hệ thống.
      const holiday = n === 2 && !weekend && dayShiftOnWeekday;
      await pool.query(
        `INSERT INTO hrm_schema.employee_work_days (tenant_id,employee_id,work_date,day_type,shift_id,source) VALUES ($1,$2,$3::date,$4,$5,$6)`,
        [
          tenantId,
          e.id,
          D(n),
          holiday ? 'HOLIDAY' : weekend || !dayShiftOnWeekday ? 'OFF' : 'SHIFT',
          weekend || !dayShiftOnWeekday ? null : dayShift,
          holiday ? 'HOLIDAY' : 'MANUAL',
        ],
      );
    }
  };
  const all = Array.from({ length: 30 }, (_, i) => i + 1);
  for (const e of emps) {
    if (e.code === 'TEST09') continue;
    if (e.code === 'TEST12') await schedule(e, all.filter((n) => n >= 14), shiftHc);
    else if (e.code === 'TEST13') await schedule(e, all.filter((n) => n <= 12), shiftDem);
    else await schedule(e, all, shiftHc);
  }
  // TEST09: chỉ phân ca đến 11/9 (nửa đầu tháng); từ 14/9 các ngày làm việc không có ca.
  await schedule(emp('TEST09'), all.filter((n) => n <= 11), shiftHc);

  // ---------------------------------------------------------------- Chính sách làm thêm giờ
  const otPolicy = await one(
    `SELECT 1 AS x FROM hrm_schema.policies p JOIN hrm_schema.policy_versions v ON v.policy_id=p.id WHERE p.tenant_id=$1 AND p.policy_type='OT' AND v.status='ACTIVE' LIMIT 1`,
    [tenantId],
  );
  if (!otPolicy) {
    // Tenant chưa có chính sách OT: tạo một phiên bản để đơn làm thêm giờ của TEST05 tạo được. Giới hạn theo phút, hệ số 1,5 / 2 / 3.
    await new HrmPayrollSettingsController({
      getContext: async () => ({ pool, tenantId, principal }),
      has: () => true,
    } as any).overtime(req, {
      effectiveFrom: '2026-01-01',
      reason: 'Chính sách OT cho dữ liệu test',
      dailyLimitMinutes: 240,
      weeklyLimitMinutes: 1200,
      monthlyLimitMinutes: 2400,
      yearlyLimitMinutes: 12000,
      weekdayRate: 1.5,
      offRate: 2,
      holidayRate: 3,
      nightRate: 2,
    });
    say('Đã tạo chính sách OT (tenant chưa có): hệ số 1,5 / 2 / 3, tối đa 4 giờ mỗi ngày.');
  }
  const hasOtPolicy = true;

  // ---------------------------------------------------------------- Chấm công
  const punch = (e: Emp, date: string, kind: 'IN' | 'OUT', hhmm: string, plusDay = false) =>
    ingestEvent(pool as unknown as Pool, tenantId, e.userId, {
      employeeId: e.id,
      kind,
      occurredAt: at(plusDay ? nextDate(date) : date, hhmm),
      source: 'BIOMETRIC_DEVICE',
      externalEventId: randomUUID(),
    });
  const normal = async (e: Emp, n: number, from = '08:00', to = '17:00') => {
    await punch(e, D(n), 'IN', from);
    await punch(e, D(n), 'OUT', to);
  };
  /** Chấm bình thường mọi ngày làm việc trừ các ngày `skip`. */
  const normalExcept = async (e: Emp, skip: number[], only?: number[]) => {
    for (const n of only ?? WORKDAYS) if (!skip.includes(n)) await normal(e, n);
  };

  // TEST01: đủ công, thêm thứ Bảy 5/9 là ngày "Làm bù" của công ty (lịch công ty có sẵn): phân ca đi làm và có chấm công.
  await normalExcept(emp('TEST01'), []);
  await pool.query(
    `UPDATE hrm_schema.employee_work_days SET day_type='SHIFT', shift_id=$3 WHERE tenant_id=$1 AND employee_id=$2 AND work_date=$4::date AND status='ACTIVE'`,
    [tenantId, emp('TEST01').id, shiftHc, D(5)],
  );
  await normal(emp('TEST01'), 5);

  // TEST02: các lỗi chấm công.
  const t2 = emp('TEST02');
  await normalExcept(t2, [3, 4, 7, 8, 9, 10, 11, 14]);
  await normal(t2, 3, '08:35');
  await normal(t2, 4, '08:00', '16:00');
  await punch(t2, D(7), 'IN', '08:00');
  await punch(t2, D(8), 'OUT', '17:00');
  await normal(t2, 9, '08:08');
  await normal(t2, 10, '08:40', '16:30');
  await punch(t2, D(14), 'IN', '08:00');
  await punch(t2, D(14), 'IN', '08:05');
  await punch(t2, D(14), 'OUT', '17:00');

  // ---------------------------------------------------------------- Đơn từ (tạo bằng đúng luồng của hệ thống, rồi duyệt)
  const ctx = (who: { userId: string; permissions: string[] }, employeeId: string) =>
    ({
      has: () => true,
      getRequestContext: async (_r: Request, requested?: string) => ({ pool, tenantId, employeeId: requested ?? employeeId, principal: who }),
      scoped: async (_r: Request, _p: string, requested?: string) => ({ pool, tenantId, employeeId: requested, principal: who }),
      getContext: async () => ({ pool, tenantId, principal: who }),
      resolveEmployee: async () => ({ employeeId }),
      procedureAvailable: async () => false,
    }) as any;
  const bridge = { startOrResume: async () => undefined } as any;
  const leaves = new HrmLeaveController(ctx(principal, actor), bridge, testApprovalPolicy());
  const requests = new HrmRequestController(ctx(principal, actor), bridge, testApprovalPolicy());
  const attendance = new HrmAttendanceController(ctx(principal, actor), bridge, testApprovalPolicy());

  const leave = async (e: Emp, typeId: string, from: string, to: string, approve = true) => {
    const created = await leaves.createLeaveRequest(req, { employeeId: e.id, leaveTypeId: typeId, fromAt: from, toAt: to } as any);
    if (approve) await tx((db) => transitionLeave(db, tenantId, approverId, created.data.id, 'APPROVED'));
  };
  const trip = async (e: Emp, from: string, to: string, type: 'DOMESTIC' | 'OVERSEAS', destination: string, approve = true) => {
    const created = await requests.createBusinessTripRequest(req, {
      employeeId: e.id,
      reasonId: tripReason,
      destination,
      businessTripType: type,
      fromAt: from,
      toAt: to,
    } as any);
    if (approve) await tx((db) => approveBusinessTrip(db, tenantId, approverId, created.data.id));
  };
  const overtime = async (e: Emp, from: string, to: string, approve = true, reasonId = otReason) => {
    const created = await requests.createOtRequest(req, { employeeId: e.id, reasonId, fromAt: from, toAt: to } as any);
    if (approve) await tx((db) => approveOvertime(db, tenantId, approverId, created.data.id));
  };

  // TEST03: nghỉ phép.
  const t3 = emp('TEST03');
  await leave(t3, paidLeave, `${D(1)}T08:00`, `${D(1)}T17:00`);
  await leave(t3, paidLeave, `${D(3)}T08:00`, `${D(3)}T12:00`);
  await leave(t3, paidLeave, `${D(4)}T13:00`, `${D(4)}T17:00`);
  await leave(t3, unpaidLeave, `${D(7)}T08:00`, `${D(7)}T17:00`);
  await leave(t3, paidLeave, `${D(10)}T08:00`, `${D(14)}T17:00`);
  await leave(t3, paidLeave, `${D(16)}T08:00`, `${D(16)}T17:00`, false);
  await normalExcept(t3, [1, 3, 4, 7, 10, 11, 14, 16]);
  await normal(t3, 3, '13:00');
  await normal(t3, 4, '08:00', '12:00');

  // TEST04: nghỉ kèm lỗi chấm công.
  const t4 = emp('TEST04');
  await leave(t4, paidLeave, `${D(1)}T08:00`, `${D(1)}T17:00`);
  await leave(t4, paidLeave, `${D(3)}T08:00`, `${D(3)}T12:00`);
  await leave(t4, unpaidLeave, `${D(4)}T08:00`, `${D(4)}T17:00`);
  await leave(t4, paidLeave, `${D(7)}T13:00`, `${D(7)}T17:00`);
  await normalExcept(t4, [1, 3, 4, 7]);
  await punch(t4, D(1), 'IN', '08:00');
  await punch(t4, D(3), 'IN', '13:00');
  await normal(t4, 4);
  await normal(t4, 7, '08:00', '12:00');

  // TEST05: làm thêm giờ. Giờ chấm vẫn theo ca; giờ tăng ca lấy theo khoảng thời gian đã duyệt trong đơn, không cần chấm ra.
  const t5 = emp('TEST05');
  await normalExcept(t5, [8]);
  await overtime(t5, `${D(3)}T18:00`, `${D(3)}T20:00`); // 2 giờ sau ca, không chấm ra giờ tăng ca
  await overtime(t5, `${D(4)}T22:00`, `${D(5)}T02:00`, true, otProjectReason); // hệ số 2 theo lý do; qua đêm: 22h đến 2h sáng hôm sau = 4 giờ (tính cho ngày 4/9)
  await overtime(t5, `${D(5)}T08:00`, `${D(5)}T10:00`, true, otUrgentReason); // hệ số 3 theo lý do; thứ Bảy, ngày nghỉ (2 giờ; cộng 2 giờ qua đêm vẫn trong giới hạn 4 giờ/ngày)
  await overtime(t5, `${D(7)}T18:00`, `${D(7)}T19:00`, false); // chờ duyệt: chưa tính
  await overtime(t5, `${D(10)}T21:00`, `${D(10)}T23:00`); // một đơn trộn giờ ngày (21-22h) và giờ đêm (22-23h): hệ số bình quân theo số phút
  await normal(t5, 8, '08:00', '20:00'); // ở lại làm đến 20h nhưng không có đơn OT: không được tính tăng ca

  // TEST06: công tác.
  const t6 = emp('TEST06');
  await trip(t6, `${D(1)}T08:00`, `${D(1)}T17:00`, 'DOMESTIC', 'Đà Nẵng');
  await trip(t6, `${D(10)}T08:00`, `${D(14)}T17:00`, 'OVERSEAS', 'Singapore');
  await trip(t6, `${D(16)}T08:00`, `${D(16)}T12:00`, 'DOMESTIC', 'Biên Hòa');
  await trip(t6, `${D(17)}T08:00`, `${D(17)}T17:00`, 'DOMESTIC', 'Hải Phòng', false);
  await trip(t6, `${D(21)}T08:00`, `${D(21)}T17:00`, 'DOMESTIC', 'Cần Thơ');
  await normalExcept(t6, [1, 10, 11, 14, 16, 17]);
  await normal(t6, 16, '13:00');

  // TEST07: công tác theo giờ (từ 4 giờ trở xuống = 0,5 ngày; trên 4 giờ = 1 ngày; ngày công tác không cần chấm công).
  const t7 = emp('TEST07');
  await trip(t7, `${D(1)}T08:00`, `${D(1)}T11:00`, 'DOMESTIC', 'Quận 1 (3 giờ)');
  await trip(t7, `${D(3)}T13:00`, `${D(3)}T17:00`, 'DOMESTIC', 'Thủ Đức (4 giờ)');
  await trip(t7, `${D(4)}T08:00`, `${D(4)}T13:00`, 'DOMESTIC', 'Long An (5 giờ)');
  await trip(t7, `${D(7)}T08:00`, `${D(7)}T17:00`, 'DOMESTIC', 'Bình Dương (cả ngày)');
  await trip(t7, `${D(8)}T08:00`, `${D(8)}T12:00`, 'DOMESTIC', 'Đồng Nai (4 giờ, thiếu chấm nửa chiều)');
  await normalExcept(t7, [1, 3, 4, 7, 8]);
  await normal(t7, 1, '13:00'); // công tác sáng, chiều đi làm
  await normal(t7, 3, '08:00', '12:00'); // công tác chiều, sáng đi làm

  // TEST08: giải trình công.
  const t8 = emp('TEST08');
  await normalExcept(t8, [3, 4, 7]);
  await punch(t8, D(3), 'IN', '08:00');
  await punch(t8, D(4), 'IN', '08:00');
  const correction = async (day: number, start: string, end: string, approve: boolean) => {
    const created = await attendance.createCorrection(req, {
      employeeId: t8.id,
      requestDate: D(day),
      sessions: [{ start: at(D(day), start), end: at(D(day), end) }],
      reasonId: fixReason,
    } as any);
    if (approve) await tx((db) => approveAttendanceCorrection(db, tenantId, approverId, created.data.id));
  };
  await correction(3, '08:00', '17:00', true);
  await correction(4, '08:00', '17:00', false);
  await correction(7, '08:00', '17:00', true);

  // TEST09: chưa phân ca từ 14/9; vẫn có chấm công ngày 14/9 (có chấm mà không có ca).
  const t9 = emp('TEST09');
  await normalExcept(t9, [], WORKDAYS.filter((n) => n <= 11));
  await normal(t9, 14);

  // TEST10: lễ Quốc khánh 2/9 đi làm có đơn OT; lễ riêng của TEST10 vào 8/9 (có lương) và 9/9 (không lương).
  const t10 = emp('TEST10');
  for (const [n, name, paid] of [[8, '[TEST] Lễ có lương', true], [9, '[TEST] Lễ không lương', false]] as const)
    await tx((db) =>
      createHoliday(db, tenantId, actor, {
        name,
        kind: 'SPECIAL',
        fromDate: D(n),
        toDate: D(n),
        scope: { type: 'EMPLOYEES', employeeIds: [t10.id] },
        treatment: 'OFF',
        paid,
        note: 'Dữ liệu test',
      }),
    );
  await normalExcept(t10, [8, 9]);
  await overtime(t10, `${D(2)}T08:00`, `${D(2)}T12:00`); // đi làm ngày lễ phải có đơn OT: 4 giờ, hệ số ngày lễ
  // TEST01 đi làm ngày lễ 2/9 nhưng KHÔNG có đơn OT: chỉ hưởng lương lễ, giờ làm không được tính.
  await normal(emp('TEST01'), 2);

  // TEST11: nghỉ việc từ 21/9; TEST12: vào làm từ 14/9.
  await normalExcept(emp('TEST11'), [], WORKDAYS.filter((n) => n <= 18));
  await normalExcept(emp('TEST12'), [], WORKDAYS.filter((n) => n >= 14));

  // TEST13: ca đêm 22:00-06:00, ngày công tính theo ngày bắt đầu ca.
  const t13 = emp('TEST13');
  for (const n of WORKDAYS.filter((d) => d <= 11)) {
    if (n === 8) {
      await punch(t13, D(n), 'IN', '22:40');
      await punch(t13, D(n), 'OUT', '06:00', true);
    } else if (n === 9) await punch(t13, D(n), 'IN', '22:00');
    else if (n === 10) {
      await punch(t13, D(n), 'IN', '22:00');
      await punch(t13, D(n), 'OUT', '05:00', true);
    } else {
      await punch(t13, D(n), 'IN', '22:00');
      await punch(t13, D(n), 'OUT', '06:00', true);
    }
  }

  // ---------------------------------------------------------------- Mức công tác phí (chỉ thêm khi tenant chưa cấu hình hình thức đó)
  for (const [type, amount] of [['DOMESTIC', 300000], ['OVERSEAS', 1200000]] as const) {
    const has = await one(
      `SELECT 1 AS x FROM hrm_schema.business_trip_allowance_rates WHERE tenant_id=$1 AND trip_type=$2 AND status='ACTIVE'`,
      [tenantId, type],
    );
    if (!has) {
      await pool.query(
        `INSERT INTO hrm_schema.business_trip_allowance_rates (tenant_id,trip_type,daily_amount,effective_from,note,created_by) VALUES ($1,$2,$3,'2026-01-01','Dữ liệu test',$4)`,
        [tenantId, type, amount, actor],
      );
      say(`Đã thêm mức công tác phí ${type}: ${amount.toLocaleString('vi-VN')} đ/ngày (tenant chưa có mức).`);
    }
  }

  say('\nĐã tạo dữ liệu test tháng 09/2026:');
  for (const e of emps) say(`  ${e.code}: ${e.scenario}`);
  return emps;
}

suite('Tạo dữ liệu test bảng công (thủ công)', () => {
  let pool: Pg;
  let admin: Pg | undefined;
  let databaseName = '';
  let tenantId = '';

  beforeAll(async () => {
    if (harness) {
      const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
      if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Chế độ kiểm thử chỉ chạy trên PostgreSQL local');
      admin = createPostgresPool(url.toString());
      databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      url.pathname = '/' + databaseName;
      pool = createPostgresPool(url.toString());
      for (const path of await registeredMigrations())
        await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
      tenantId = randomUUID();
      const policyUser = randomUUID();
      await pool.query(`INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1,'x','x@test.invalid','t')`, [policyUser]);
      await new HrmPayrollSettingsController({
        getContext: async () => ({ pool, tenantId, principal: { userId: policyUser, permissions: ['hrm.manage'] } }),
        has: () => true,
      } as any).overtime({ headers: {} } as Request, {
        effectiveFrom: '2025-01-01',
        reason: 'Chính sách OT cho kiểm thử',
        dailyLimitMinutes: 240,
        weeklyLimitMinutes: 1200,
        monthlyLimitMinutes: 2400,
        yearlyLimitMinutes: 12000,
        weekdayRate: 1.5,
        offRate: 2,
        holidayRate: 3,
        nightRate: 2,
      });
      return;
    }
    pool = createPostgresPool(realUrl!);
    tenantId = process.env.HRM_DEMO_SEED_TENANT ?? '';
    if (!tenantId) {
      const tenants = (await pool.query(`SELECT DISTINCT tenant_id FROM hrm_schema.employee_profiles`)).rows;
      if (tenants.length !== 1) throw new Error(`Có ${tenants.length} tenant trong database; đặt HRM_DEMO_SEED_TENANT=<uuid>.`);
      tenantId = tenants[0].tenant_id;
    }
    say(`Tenant: ${tenantId}`);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 60_000);

  it('tạo nhân viên TEST01..TEST13 và dữ liệu từng trường hợp', async () => {
    const emps = await seedDemo(pool, tenantId);
    expect(emps).toHaveLength(13);
    if (harness) {
      const stats = await pool.query(
        `SELECT (SELECT count(*) FROM hrm_schema.attendance_events WHERE tenant_id=$1)::int AS events,
                (SELECT count(*) FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='APPROVED')::int AS leaves_ok,
                (SELECT count(*) FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND status='PENDING')::int AS leaves_pending,
                (SELECT count(*) FROM hrm_schema.ot_requests WHERE tenant_id=$1)::int AS ots,
                (SELECT count(*) FROM hrm_schema.business_trip_requests WHERE tenant_id=$1)::int AS trips,
                (SELECT count(*) FROM hrm_schema.shift_change_requests WHERE tenant_id=$1)::int AS shift_changes,
                (SELECT count(*) FROM hrm_schema.attendance_corrections WHERE tenant_id=$1)::int AS corrections`,
        [tenantId],
      );
      say(JSON.stringify(stats.rows[0]));
      expect(stats.rows[0].events).toBeGreaterThan(300);
      const ids = emps.map((e) => e.id);
      const board = await hrmTransaction(pool as unknown as Pool, (db) =>
        loadBoard(db, tenantId, { from: D(1), to: D(30), employeeIds: ids, today: '2026-10-10' }),
      );
      for (const e of board.employees) {
        const line = Object.values(e.days)
          .map((d) => `${d.date.slice(8)}:${d.status}${d.anomalies.length ? '[' + d.anomalies.join(',') + ']' : ''}`)
          .join(' ');
        say(`${e.employeeCode} ${line}`);
        const detail = Object.values(e.days)
          .filter((d) => d.otMinutes > 0 || (d.sources ?? []).some((x) => x.kind === 'TRIP') || (['TEST01', 'TEST10'].includes(e.employeeCode) && d.date.endsWith('-02')))
          .map((d) => `${d.date.slice(8)}: công ${d.workdayUnits} (${d.paidMinutes}/${d.scheduledMinutes} phút), OT ${d.otMinutes} phút`)
          .join(' | ');
        if (detail) say(`  chi tiết ${e.employeeCode}: ${detail}`);
      }
      expect(stats.rows[0]).toMatchObject({ leaves_ok: 9, leaves_pending: 1, ots: 6, trips: 10, shift_changes: 0, corrections: 3 });
    }
  }, 600_000);
});
