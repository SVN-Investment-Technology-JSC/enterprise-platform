import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { unpostedUsableEntitlement } from './hrm-annual-leave';
import { accrueMonth } from './hrm-leave-accrual';
import { carryoverYear } from './hrm-leave-carryover';
import { createLeave } from './hrm-leave-operations';
import {
  computeLeaveSettlement,
  scheduleSettlement,
  settleLeaveOnTermination,
  waiveSettlement,
} from './hrm-leave-settlement';
import { hrmTransaction } from './hrm-transaction';

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
// Các dòng sổ ghi trong cùng transaction có cùng created_at: so sánh không theo thứ tự.
const sorted = (rows: unknown[][]) =>
  rows.map((r) => JSON.stringify(r)).sort();
integration('Annual leave by labor contract (PostgreSQL)', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const actor = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  let shiftId: string;

  const employee = async (code: string, signDate: string | null) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.employees (id, tenant_id, full_name, work_email) VALUES ($1,$2,$3,$4)`,
      [id, tenantId, code, `${id}@test.local`],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1,$2,$3,'2010-01-01')`,
      [id, tenantId, code],
    );
    // Hợp đồng thử việc ký sớm hơn không được dùng làm mốc.
    await pool.query(
      `INSERT INTO hrm_schema.employment_contracts (tenant_id,employee_id,contract_code,contract_type,sign_date,effective_from,status)
       VALUES ($1,$2,$3,'PROBATION','2009-01-01','2009-01-01','TERMINATED')`,
      [tenantId, id, `${code}-TV`],
    );
    if (signDate)
      await pool.query(
        `INSERT INTO hrm_schema.employment_contracts (tenant_id,employee_id,contract_code,contract_type,sign_date,effective_from,status)
         VALUES ($1,$2,$3,'INDEFINITE',$4,$4,'ACTIVE')`,
        [tenantId, id, `${code}-HD`, signDate],
      );
    await pool.query(
      `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from) VALUES ($1,$2,$3,'2025-01-01')`,
      [tenantId, id, shiftId],
    );
    return id;
  };
  const leaveType = async (
    code: string,
    opts: { carryover?: boolean; maxCarry?: number } = {},
  ) =>
    (
      await pool.query(
        `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,unit,deduct_balance,carryover_allowed,max_carryover_days)
         VALUES ($1,$2,$2,'DAYS',true,$3,$4) RETURNING id`,
        [tenantId, code, Boolean(opts.carryover), opts.maxCarry ?? 0],
      )
    ).rows[0].id as string;
  const schedule = async (
    typeId: string,
    opts: {
      advance?: boolean;
      offset?: number;
      tiers?: [number, number][];
      from?: string;
    } = {},
  ) => {
    const id = (
      await pool.query(
        `INSERT INTO hrm_schema.leave_accrual_schedules (tenant_id,leave_type_id,accrual_frequency,accrual_amount,proration_rule,seniority_bonus_years,seniority_bonus_days,effective_from,accrual_basis,start_offset_months,advance_allowed,annual_days)
         VALUES ($1,$2,'MONTHLY',1,'HALF_MONTH',0,0,$3,'CONTRACT_SIGN_DATE',$4,$5,12) RETURNING id`,
        [tenantId, typeId, opts.from ?? '2026-01-01', opts.offset ?? 0, Boolean(opts.advance)],
      )
    ).rows[0].id as string;
    for (const [years, days] of opts.tiers ?? [])
      await pool.query(
        `INSERT INTO hrm_schema.leave_seniority_tiers (tenant_id,schedule_id,min_years,bonus_days) VALUES ($1,$2,$3,$4)`,
        [tenantId, id, years, days],
      );
    return id;
  };
  const ledger = async (employeeId: string, typeId: string) =>
    (
      await pool.query(
        `SELECT transaction_type,days_changed::float AS days,balance_year,note FROM hrm_schema.leave_transactions
         WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 ORDER BY created_at,id`,
        [tenantId, employeeId, typeId],
      )
    ).rows;
  const balance = async (employeeId: string, typeId: string, year: number) =>
    (
      await pool.query(
        `SELECT opening_balance::float AS opening,accrued::float,used::float,adjusted::float,remaining::float FROM hrm_schema.leave_balances
         WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=$4`,
        [tenantId, employeeId, typeId, year],
      )
    ).rows[0];
  const accrue = (month: string) =>
    hrmTransaction(pool, (db) => accrueMonth(db, tenantId, actor, month));

  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    const migrate = async (path: string) =>
      pool.query(
        await readFile(
          resolve(process.cwd(), '../../../migrations/tenant', path),
          'utf8',
        ),
      );
    for (const path of [
      'core/0001-core-schema.sql',
      'core/0002-organization-soft-delete.sql',
      'core/0006-employees.sql',
      '0001-integration.sql',
      'hrm/0001-hrm.sql',
      'hrm/0002-employee-identity.sql',
      'hrm/0003-time-operations.sql',
      'hrm/0004-leave-operations.sql',
      'hrm/0005-timesheet-calculation.sql',
      'hrm/0006-payroll-formulas.sql',
      'hrm/0007-work-references.sql',
      'hrm/0008-profile-corrections.sql',
      'hrm/0009-leave-carryover.sql',
      'hrm/0010-attachments.sql',
      'hrm/0011-advance-settlement.sql',
      'hrm/0012-operations-and-workflow.sql',
      'hrm/0002-hrm-procedure-integration.sql',
      'hrm/0003-hrm-requests-enhancement.sql',
      'hrm/0014-hrm-profile-compatibility.sql',
      'hrm/0013-payroll-support.sql',
      'hrm/0015-hrm-procedure-sync.sql',
      'hrm/0015-procedure-definition-snapshot.sql',
      'hrm/0015-shift-submission.sql',
      'hrm/0016-hrm-lifecycle.sql',
      'hrm/0016-family-contract-lifecycle.sql',
      'hrm/0020-payroll-lifecycle.sql',
      'hrm/0033-leave-annual-policy.sql',
    ])
      await migrate(path);
    shiftId = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes)
         VALUES ($1,'DAY','Hành chính','08:00','17:00',false,60,0,0) RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName))
        throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 30_000);

  it('cộng phép theo ngày ký HĐ chính thức, tách giao dịch thâm niên và cảnh báo thiếu HĐ', async () => {
    const type = await leaveType('AL-ACCRUE');
    await schedule(type, { tiers: [[5, 1], [10, 2], [15, 3]] });
    const senior = await employee('NV-SENIOR', '2016-07-10');
    const noContract = await employee('NV-NOHD', null);

    await accrue('2026-06');
    const july = await accrue('2026-07');
    expect(july.missingContract).toContain(noContract);
    const rows = await ledger(senior, type);
    expect(sorted(rows.map((r) => [r.transaction_type, r.days, r.note]))).toEqual(
      sorted([
        ['ACCRUAL', 1, 'Cộng phép 2026-06'],
        ['SENIORITY_ACCRUAL', 0.08, 'Cộng phép thâm niên mốc 5 năm 2026-06'], // 1/12
        ['ACCRUAL', 1, 'Cộng phép 2026-07'],
        ['SENIORITY_ACCRUAL', 0.17, 'Cộng phép thâm niên mốc 10 năm 2026-07'], // 2/12
      ]),
    );
    // Chạy lại không ghi trùng.
    const again = await accrue('2026-07');
    expect(again.credited).toBe(0);
    expect(await balance(noContract, type, 2026)).toBeUndefined();
  });

  it('bắt đầu tính sau N tháng kể từ ngày ký', async () => {
    const type = await leaveType('AL-OFFSET');
    await schedule(type, { offset: 2 });
    const fresh = await employee('NV-OFFSET', '2026-03-10');
    for (const month of ['2026-03', '2026-04', '2026-05'])
      await accrue(month);
    expect((await ledger(fresh, type)).map((r) => r.days)).toEqual([1]);
  });

  it('không cho ứng: chỉ dùng phần tích luỹ đến tháng hiện tại; cho ứng: tới hết năm', async () => {
    const strict = await leaveType('AL-STRICT');
    const flexible = await leaveType('AL-ADVANCE');
    await schedule(strict);
    await schedule(flexible, { advance: true });
    const id = await employee('NV-USABLE', '2020-01-01');
    const usable = (typeId: string, year: number) =>
      hrmTransaction(pool, (db) =>
        unpostedUsableEntitlement(db, tenantId, id, typeId, year, 0, '2026-10-08'),
      );
    expect(await usable(strict, 2026)).toMatchObject({ extra: 10, projected: 12 });
    expect(await usable(flexible, 2026)).toMatchObject({ extra: 12, projected: 12 });
    expect((await usable(strict, 2027)).extra).toBe(0);
    expect((await usable(flexible, 2027)).extra).toBe(12);

    const request = (typeId: string, date: string) =>
      hrmTransaction(pool, (db) =>
        createLeave(db, tenantId, actor, {
          employeeId: id,
          leaveTypeId: typeId,
          fromDate: date,
          toDate: date,
          duration: 1,
          reason: 'Việc riêng',
        }),
      );
    await expect(request(strict, '2026-10-12')).resolves.toBeTruthy();
    await expect(request(strict, '2027-01-12')).rejects.toThrow(
      'không cho ứng phép',
    );
    await expect(request(flexible, '2027-01-12')).resolves.toBeTruthy();
  });

  it('cuối năm: reset loại không cho chuyển, chuyển tối đa và reset phần vượt trần', async () => {
    const reset = await leaveType('AL-RESET');
    const carry = await leaveType('AL-CARRY', { carryover: true, maxCarry: 2 });
    const id = await employee('NV-YEAREND', '2020-01-01');
    for (const type of [reset, carry])
      await pool.query(
        `INSERT INTO hrm_schema.leave_balances (tenant_id,employee_id,leave_type_id,year,accrued,remaining) VALUES ($1,$2,$3,2025,5,5)`,
        [tenantId, id, type],
      );
    const result = await hrmTransaction(pool, (db) =>
      carryoverYear(db, tenantId, actor, 2026),
    );
    expect(result).toMatchObject({ count: 1 });
    expect((await ledger(id, reset)).map((r) => [r.transaction_type, r.days])).toEqual([
      ['YEAR_END_RESET', -5],
    ]);
    expect(
      sorted((await ledger(id, carry)).map((r) => [r.transaction_type, r.days, r.balance_year])),
    ).toEqual(
      sorted([
        ['CARRYOVER_OUT', -2, 2025],
        ['CARRYOVER_IN', 2, 2026],
        ['YEAR_END_RESET', -3, 2025],
      ]),
    );
    expect(await balance(id, carry, 2026)).toMatchObject({ opening: 2, remaining: 2 });
    expect((await balance(id, reset, 2025)).remaining).toBe(0);
    // Chạy lại không ghi thêm.
    await hrmTransaction(pool, (db) => carryoverYear(db, tenantId, actor, 2026));
    expect(await ledger(id, reset)).toHaveLength(1);
  });

  it('nghỉ việc sau khi ứng phép: thu hồi phần dùng vượt và tạo khoản khấu trừ lương', async () => {
    const type = await leaveType('AL-SETTLE');
    await schedule(type, { advance: true });
    const id = await employee('NV-QUIT', '2020-01-01');
    await pool.query(
      `INSERT INTO hrm_schema.employee_salary_profiles (tenant_id,employee_id,salary_type,base_salary,effective_from,status) VALUES ($1,$2,'GROSS',27000000,'2026-01-01','ACTIVE')`,
      [tenantId, id],
    );
    for (const month of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])
      await accrue(month);
    // Đã nghỉ 10 ngày (ứng trước 4 ngày).
    await pool.query(
      `UPDATE hrm_schema.leave_balances SET used=used+10,remaining=remaining-10 WHERE tenant_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND year=2026`,
      [tenantId, id, type],
    );
    // Ngừng từ 10/07: tháng 7 chỉ làm 9 ngày nên không được tính.
    const preview = await hrmTransaction(pool, (db) =>
      computeLeaveSettlement(db, tenantId, id, '2026-07-10'),
    );
    expect(preview.find((l) => l.leaveTypeId === type)).toMatchObject({
      entitled: 6,
      excess: 4,
    });
    await pool.query(
      `UPDATE hrm_schema.employee_profiles SET employment_status='RESIGNED',inactive_from='2026-07-10' WHERE tenant_id=$1 AND employee_id=$2`,
      [tenantId, id],
    );
    const settled = await hrmTransaction(pool, (db) =>
      settleLeaveOnTermination(db, tenantId, actor, id, '2026-07-10'),
    );
    const row = settled.find((s) => s.leave_type_id === type);
    // Tháng 7/2026 có 27 ngày công chuẩn (bỏ 4 Chủ nhật): 27.000.000 / 27 = 1.000.000/ngày.
    expect(row).toMatchObject({ status: 'PENDING' });
    expect(Number(row.excess_days)).toBe(4);
    expect(Number(row.recovery_amount)).toBe(4_000_000);
    expect((await ledger(id, type)).at(-1)).toMatchObject({
      transaction_type: 'RECOVERY',
      days: 4,
    });
    expect((await balance(id, type, 2026)).remaining).toBe(0);
    // Chạy lại trả về quyết toán cũ.
    const again = await hrmTransaction(pool, (db) =>
      settleLeaveOnTermination(db, tenantId, actor, id, '2026-07-10'),
    );
    expect(again.find((s) => s.leave_type_id === type).id).toBe(row.id);

    const period = (
      await pool.query(
        `INSERT INTO hrm_schema.payroll_periods (tenant_id,period_code,from_date,to_date,payment_date) VALUES ($1,'2026-07','2026-07-01','2026-07-31','2026-08-05') RETURNING id`,
        [tenantId],
      )
    ).rows[0].id;
    const scheduled = await hrmTransaction(pool, (db) =>
      scheduleSettlement(db, tenantId, actor, row.id, {
        payrollPeriodId: period,
        recoveryAmount: 3_500_000,
        reason: 'Giảm theo thoả thuận',
      }),
    );
    expect(scheduled).toMatchObject({ status: 'SCHEDULED' });
    expect(Number(scheduled.recovery_amount)).toBe(3_500_000);
    const waived = await hrmTransaction(pool, (db) =>
      waiveSettlement(db, tenantId, actor, row.id, 'Miễn trừ theo quyết định'),
    );
    expect(waived.status).toBe('WAIVED');
  });

  it('ngừng làm việc lùi ngày: thu hồi phép đã cộng cho tháng sau ngày nghỉ', async () => {
    const type = await leaveType('AL-BACKDATE');
    await schedule(type);
    const id = await employee('NV-BACKDATE', '2020-01-01');
    for (const month of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'])
      await accrue(month);
    await pool.query(
      `INSERT INTO hrm_schema.leave_requests (tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,status) VALUES ($1,$2,$3,'2026-04-20','2026-04-20',1,'x','PENDING')`,
      [tenantId, id, type],
    );
    await expect(
      hrmTransaction(pool, (db) =>
        settleLeaveOnTermination(db, tenantId, actor, id, '2026-04-01'),
      ),
    ).rejects.toThrow('chờ duyệt');
    await pool.query(
      `UPDATE hrm_schema.leave_requests SET status='CANCELLED' WHERE tenant_id=$1 AND employee_id=$2`,
      [tenantId, id],
    );
    const settled = await hrmTransaction(pool, (db) =>
      settleLeaveOnTermination(db, tenantId, actor, id, '2026-04-01'),
    );
    const row = settled.find((s) => s.leave_type_id === type);
    expect(row).toMatchObject({ status: 'CLOSED' });
    expect(Number(row.unused_days)).toBe(3);
    expect((await ledger(id, type)).at(-1)).toMatchObject({
      transaction_type: 'RECOVERY',
      days: -2,
    });
    expect(await balance(id, type, 2026)).toMatchObject({ accrued: 3, remaining: 3 });
  });
});
