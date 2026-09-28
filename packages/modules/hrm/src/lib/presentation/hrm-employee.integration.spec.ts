import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import type { Pool } from 'pg';
import {
  carryoverYear,
  expireCarryovers,
} from '../infrastructure/hrm-leave-carryover';
import {
  createLeave,
  transitionLeave,
} from '../infrastructure/hrm-leave-operations';
import { hrmTransaction } from '../infrastructure/hrm-transaction';
import { ingestEvent } from '../infrastructure/hrm-attendance-ingest';
import { HrmTimesheetController } from './hrm-timesheet.controller';
import { HrmPayrollController } from './hrm-payroll.controller';
import {
  createOvertime,
  approveOvertime,
} from '../infrastructure/hrm-overtime';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmEmployeeController } from './hrm-employee.controller';
import { HrmSalaryController } from './hrm-salary.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import {
  processHrmWorkflows,
  receiveHrmWorkflowResult,
} from '../infrastructure/hrm-workflow';
import { runHrmAutomation } from '../infrastructure/hrm-automation';
import { HrmOperationsController } from './hrm-operations.controller';
import { HrmDependentController } from './hrm-dependent.controller';
import { HrmAttachmentController } from './hrm-attachment.controller';
import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
import { HrmShiftController } from './hrm-shift.controller';
import { HrmTimeSettingsController } from './hrm-time-settings.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { approveShiftChange } from '../infrastructure/hrm-shift-change';
import { accrueMonth } from '../infrastructure/hrm-leave-accrual';
import { timeContext } from '../infrastructure/hrm-time';
import { deviceTokenHash } from '../infrastructure/hrm-attendance-ingest';
import type { HrmContextService } from '../infrastructure/hrm-context.service';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM employee PostgreSQL integration', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userId = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
  let controller: HrmEmployeeController;
  const req = { headers: {} } as Request;
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
    ])
      await migrate(path);
    await pool.query(
      `INSERT INTO core_schema.users (id, full_name, email, password_hash) VALUES ($1, 'Legacy employee', 'legacy@test.local', 'test-only')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id, tenant_id, employee_code, join_date) VALUES ($1, $2, 'LEGACY', '2026-01-01')`,
      [userId, tenantId],
    );
    await migrate('hrm/0002-employee-identity.sql');
    await migrate('hrm/0002-employee-identity.sql');
    await migrate('hrm/0003-time-operations.sql');
    await migrate('hrm/0003-time-operations.sql');
    await migrate('hrm/0004-leave-operations.sql');
    await migrate('hrm/0005-timesheet-calculation.sql');
    await migrate('hrm/0006-payroll-formulas.sql');
    await migrate('hrm/0007-work-references.sql');
    await migrate('hrm/0008-profile-corrections.sql');
    await migrate('hrm/0009-leave-carryover.sql');
    await migrate('hrm/0010-attachments.sql');
    await migrate('hrm/0011-advance-settlement.sql');
    await migrate('hrm/0012-operations-and-workflow.sql');
    await migrate('hrm/0013-payroll-support.sql');
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      getRequestContext: async () => ({
        pool,
        tenantId,
        principal: { userId },
      }),
    };
    controller = new HrmEmployeeController(ctx as unknown as HrmContextService);
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName))
        throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });
  it('preserves legacy IDs and idempotently links the Core account', async () => {
    const profile = await controller.getMyProfile(req);
    expect(profile.data.employeeId).toBe(userId);
    expect(profile.data.userId).toBe(userId);
    expect(profile.data.fullName).toBe('Legacy employee');
  });
  it('creates an accountless employee atomically', async () => {
    const result = await controller.createEmployee(req, {
      employeeCode: 'NO-ACCOUNT',
      fullName: 'Accountless employee',
      joinDate: '2026-09-01',
    });
    expect(result.data.userId).toBeNull();
    const profile = await controller.getEmployeeProfile(
      req,
      result.data.employeeId,
    );
    expect(profile.data.fullName).toBe('Accountless employee');
    const users = await pool.query(
      'SELECT count(*)::int AS count FROM core_schema.users',
    );
    expect(users.rows[0].count).toBe(1);
  });
  it('rolls back Core creation when profile uniqueness fails', async () => {
    const before = await pool.query(
      'SELECT count(*)::int AS count FROM core_schema.employees',
    );
    await expect(
      controller.createEmployee(req, {
        employeeCode: 'LEGACY',
        fullName: 'Duplicate',
        joinDate: '2026-01-01',
      }),
    ).rejects.toThrow('Mã nhân viên');
    const after = await pool.query(
      'SELECT count(*)::int AS count FROM core_schema.employees',
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
  it('does not expose employee profiles across tenant boundaries', async () => {
    const other = new HrmEmployeeController({
      getContext: async () => ({
        pool,
        tenantId: randomUUID(),
        principal: { userId },
      }),
    } as unknown as HrmContextService);
    await expect(other.getEmployeeProfile(req, userId)).rejects.toThrow();
    expect((await other.listEmployees(req)).data).toEqual([]);
  });
  it('returns a missing profile without creating data on GET', async () => {
    const unknown = new HrmEmployeeController({
      getContext: async () => ({
        pool,
        tenantId,
        principal: { userId: randomUUID() },
      }),
    } as unknown as HrmContextService);
    const before = await pool.query(
      'SELECT count(*)::int AS count FROM hrm_schema.employee_profiles',
    );
    await expect(unknown.getMyProfile(req)).rejects.toThrow(
      'chưa được liên kết',
    );
    const after = await pool.query(
      'SELECT count(*)::int AS count FROM hrm_schema.employee_profiles',
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
  it('ingests repeated overnight sessions once and excludes unworked gaps', async () => {
    const shift = await pool.query(
      `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,cross_midnight,break_minutes,grace_late_minutes,grace_early_minutes) VALUES ($1,'NIGHT','Night','22:00','06:00',true,0,0,0) RETURNING id`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from,effective_to) VALUES ($1,$2,$3,'2026-09-20','2026-09-20')`,
      [tenantId, userId, shift.rows[0].id],
    );
    const events = [
      ['IN', '2026-09-20T15:00:00Z'],
      ['OUT', '2026-09-20T18:00:00Z'],
      ['IN', '2026-09-20T19:00:00Z'],
      ['OUT', '2026-09-20T23:00:00Z'],
    ] as const;
    let final;
    for (let i = 0; i < events.length; i++)
      final = await ingestEvent(pool as unknown as Pool, tenantId, userId, {
        employeeId: userId,
        kind: events[i][0],
        occurredAt: events[i][1],
        source: 'BIOMETRIC_DEVICE',
        externalEventId: `night-${i}`,
      });
    expect(final.worked_minutes).toBe(420);
    expect(final.scheduled_minutes).toBe(480);
    expect(final.calculation_snapshot.sessions).toHaveLength(2);
    const retry = await ingestEvent(pool as unknown as Pool, tenantId, userId, {
      employeeId: userId,
      kind: 'OUT',
      occurredAt: events[3][1],
      source: 'BIOMETRIC_DEVICE',
      externalEventId: 'night-3',
    });
    expect(retry.worked_minutes).toBe(420);
    const raw = await pool.query(
      `SELECT count(*)::int AS n FROM hrm_schema.attendance_events WHERE tenant_id=$1`,
      [tenantId],
    );
    expect(raw.rows[0].n).toBe(4);
    await expect(
      ingestEvent(pool as unknown as Pool, tenantId, userId, {
        employeeId: userId,
        kind: 'IN',
        occurredAt: events[3][1],
        source: 'BIOMETRIC_DEVICE',
        externalEventId: 'night-3',
      }),
    ).rejects.toThrow('Mã sự kiện');
  });
  it('recalculates approved corrections once and retains original events', async () => {
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      resolveEmployee: async () => ({ employeeId: userId }),
      getRequestContext: async () => ({
        pool,
        tenantId,
        principal: { userId },
        employeeId: userId,
      }),
    };
    const attendance = new HrmAttendanceController(
      ctx as unknown as HrmContextService,
    );
    const correction = await attendance.createCorrection(req, {
      employeeId: userId,
      requestDate: '2026-09-20',
      reason: 'Missing lunch return',
      sessions: [
        { start: '2026-09-20T15:00:00Z', end: '2026-09-20T23:00:00Z' },
      ],
    });
    await attendance.approveCorrection(req, correction.data.id);
    await attendance.approveCorrection(req, correction.data.id);
    const result = await pool.query(
      `SELECT worked_minutes FROM hrm_schema.attendances WHERE tenant_id=$1 AND employee_id=$2`,
      [tenantId, userId],
    );
    expect(result.rows[0].worked_minutes).toBe(480);
    const events = await pool.query(
      `SELECT count(*)::int AS total,count(*) FILTER (WHERE voided_by_correction_id IS NOT NULL)::int AS replaced FROM hrm_schema.attendance_events WHERE tenant_id=$1`,
      [tenantId],
    );
    expect(events.rows[0]).toEqual({ total: 6, replaced: 4 });
  });
  it('rejects self attendance for another employee and client-supplied timestamps', async () => {
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      resolveEmployee: async () => ({ employeeId: userId }),
      getRequestContext: async () => ({
        pool,
        tenantId,
        principal: { userId },
        employeeId: userId,
      }),
    };
    const attendance = new HrmAttendanceController(
      ctx as unknown as HrmContextService,
    );
    await expect(
      attendance.checkIn(req, { employeeId: randomUUID() }),
    ).rejects.toThrow('nhân viên khác');
    await expect(
      attendance.checkIn(req, { occurredAt: '2026-09-20T15:00:00Z' }),
    ).rejects.toThrow('giờ máy chủ');
  });

  it('reserves leave atomically, prevents overbooking and reverses approved leave once', async () => {
    const type = await pool.query(
      `INSERT INTO hrm_schema.leave_types (tenant_id,code,name) VALUES ($1,'ANNUAL','Annual') RETURNING id`,
      [tenantId],
    );
    const leaveTypeId = type.rows[0].id;
    await pool.query(
      `INSERT INTO hrm_schema.leave_balances (tenant_id,employee_id,leave_type_id,year,accrued,remaining) VALUES ($1,$2,$3,2026,1,1)`,
      [tenantId, userId, leaveTypeId],
    );
    const body = {
      employeeId: userId,
      leaveTypeId,
      fromDate: '2026-09-20',
      toDate: '2026-09-20',
      duration: 1,
      reason: 'Annual leave',
    };
    const pending = await hrmTransaction(pool as unknown as Pool, (db) =>
      createLeave(db, tenantId, userId, body),
    );
    await expect(
      hrmTransaction(pool as unknown as Pool, (db) =>
        createLeave(db, tenantId, userId, body),
      ),
    ).rejects.toThrow('trùng');
    for (let i = 0; i < 2; i++)
      await hrmTransaction(pool as unknown as Pool, (db) =>
        transitionLeave(db, tenantId, userId, pending.id, 'APPROVED'),
      );
    let balance = await pool.query(
      `SELECT used,pending,remaining FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND leave_type_id=$2`,
      [tenantId, leaveTypeId],
    );
    expect(balance.rows[0]).toEqual({
      used: '1.00',
      pending: '0.00',
      remaining: '0.00',
    });
    for (let i = 0; i < 2; i++)
      await hrmTransaction(pool as unknown as Pool, (db) =>
        transitionLeave(db, tenantId, userId, pending.id, 'CANCELLED'),
      );
    balance = await pool.query(
      `SELECT used,pending,remaining FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND leave_type_id=$2`,
      [tenantId, leaveTypeId],
    );
    expect(balance.rows[0]).toEqual({
      used: '0.00',
      pending: '0.00',
      remaining: '1.00',
    });
    const ledger = await pool.query(
      `SELECT transaction_type FROM hrm_schema.leave_transactions WHERE reference_request_id=$1 ORDER BY created_at`,
      [pending.id],
    );
    expect(ledger.rows.map((r) => r.transaction_type)).toEqual([
      'USAGE',
      'REVERSAL',
    ]);
    const leave = new HrmLeaveController({
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
    } as unknown as HrmContextService);
    const adjustment = {
      employeeId: userId,
      leaveTypeId,
      year: 2026,
      daysAdjusted: 2,
      reason: 'Annual adjustment',
      operationId: randomUUID(),
    };
    const first = await leave.adjustLeaveBalance(req, adjustment);
    expect((await leave.adjustLeaveBalance(req, adjustment)).data.id).toBe(
      first.data.id,
    );
    await expect(
      leave.adjustLeaveBalance(req, { ...adjustment, daysAdjusted: 3 }),
    ).rejects.toThrow('nội dung điều chỉnh khác');
    expect(
      (
        await pool.query(
          `SELECT remaining FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND leave_type_id=$2`,
          [tenantId, leaveTypeId],
        )
      ).rows[0].remaining,
    ).toBe('3.00');
  });

  it.each([false, true])(
    'runs attendance → OT → locked timesheet → formula payroll → immutable payslip (mid-period join: %s)',
    async (midPeriod) => {
      const t = randomUUID(),
        e = randomUUID();
      await pool.query(
        `INSERT INTO core_schema.employees (id,tenant_id,full_name) VALUES ($1,$2,'Payroll employee')`,
        [e, t],
      );
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles (employee_id,tenant_id,employee_code,join_date) VALUES ($1,$2,'PAY-001',$3)`,
        [e, t, midPeriod ? '2026-09-21' : '2026-01-01'],
      );
      const shift = await pool.query(
        `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,break_minutes) VALUES ($1,'DAY','Day','08:00','16:00',0) RETURNING id`,
        [t],
      );
      await pool.query(
        `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from,effective_to) VALUES ($1,$2,$3,'2026-09-21','2026-09-23')`,
        [t, e, shift.rows[0].id],
      );
      await pool.query(
        `INSERT INTO hrm_schema.work_calendar (tenant_id,work_date,day_kind,name,paid) VALUES ($1,'2026-09-22','OFF','Off',false),($1,'2026-09-23','HOLIDAY','Company holiday',true)`,
        [t],
      );
      for (const [kind, at] of [
        ['IN', '2026-09-21T01:00:00Z'],
        ['OUT', '2026-09-21T10:00:00Z'],
      ] as const)
        await ingestEvent(pool as unknown as Pool, t, userId, {
          employeeId: e,
          kind,
          occurredAt: at,
          source: 'BIOMETRIC_DEVICE',
          externalEventId: randomUUID(),
        });
      for (const [type, config] of [
        [
          'OT',
          {
            dailyLimitMinutes: 240,
            weeklyLimitMinutes: 1200,
            monthlyLimitMinutes: 2400,
            yearlyLimitMinutes: 12000,
            weekdayRate: 1.5,
            offRate: 2,
            holidayRate: 3,
            nightRate: 2,
          },
        ],
        [
          'PAYROLL',
          {
            salaryType: 'GROSS',
            inputs: { INSURANCE_AMOUNT: 1000000 },
            components: [
              {
                code: 'SALARY',
                name: 'Salary',
                type: 'EARNING',
                formula: 'PRORATED_BASE_PAY',
              },
              {
                code: 'OT_PAY',
                name: 'Overtime',
                type: 'OVERTIME',
                formula:
                  'BASE_SALARY / SCHEDULED_MINUTES * WEIGHTED_OT_MINUTES',
              },
              {
                code: 'INSURANCE',
                name: 'Insurance fixture',
                type: 'STATUTORY_DEDUCTION',
                formula: 'INSURANCE_AMOUNT',
              },
              {
                code: 'ADVANCE',
                name: 'Advance',
                type: 'ADVANCE_DEDUCTION',
                formula: 'ADVANCE_DUE',
              },
              {
                code: 'NET',
                name: 'Net',
                type: 'NET_PAY',
                formula: 'SALARY + OT_PAY - INSURANCE - ADVANCE',
              },
            ],
          },
        ],
      ] as const) {
        const p = await pool.query(
          `INSERT INTO hrm_schema.policies (tenant_id,code,name,policy_type) VALUES ($1,$2,$2,$2) RETURNING id`,
          [t, type],
        );
        await pool.query(
          `INSERT INTO hrm_schema.policy_versions (policy_id,version_no,effective_from,config_json,status) VALUES ($1,1,'2026-01-01',$2,'ACTIVE')`,
          [p.rows[0].id, JSON.stringify(config)],
        );
      }
      const ot = await hrmTransaction(pool as unknown as Pool, (db) =>
        createOvertime(db, t, {
          employeeId: e,
          workDate: '2026-09-21',
          startTime: '16:00',
          endTime: '17:00',
          plannedMinutes: 60,
          reason: 'Delivery',
        }),
      );
      await hrmTransaction(pool as unknown as Pool, (db) =>
        approveOvertime(db, t, userId, ot.id),
      );
      const ctx = {
        getContext: async () => ({ pool, tenantId: t, principal: { userId } }),
        resolveEmployee: async () => ({ employeeId: e }),
        getRequestContext: async () => ({
          pool,
          tenantId: t,
          principal: { userId },
          employeeId: e,
        }),
      };
      const ts = new HrmTimesheetController(
          ctx as unknown as HrmContextService,
        ),
        pay = new HrmPayrollController(ctx as unknown as HrmContextService);
      const period = await ts.createPeriod(req, {
        periodCode: 'TEST',
        fromDate: midPeriod ? '2026-09-20' : '2026-09-21',
        toDate: '2026-09-23',
      });
      const calc = await ts.calculatePeriod(req, period.data.id);
      expect(calc.data).toEqual({ count: 3, abnormal: 0 });
      const rows = await ts.listTimesheets(req, period.data.id);
      expect(rows.data.map((r) => r.status).sort()).toEqual([
        'HOLIDAY',
        'NORMAL',
        'OFF',
      ]);
      expect(rows.data.reduce((n, r) => n + r.otMinutes, 0)).toBe(60);
      await ts.lockPeriod(req, period.data.id);
      await expect(
        ingestEvent(pool as unknown as Pool, t, userId, {
          employeeId: e,
          kind: 'IN',
          occurredAt: '2026-09-21T01:01:00Z',
          source: 'BIOMETRIC_DEVICE',
          externalEventId: randomUUID(),
        }),
      ).rejects.toThrow('đã khóa');
      await pool.query(
        `INSERT INTO hrm_schema.employee_salary_profiles (tenant_id,employee_id,salary_type,base_salary,effective_from) VALUES ($1,$2,'GROSS',12000000,'2026-01-01')`,
        [t, e],
      );
      const p = await pay.createPeriod(req, {
        periodCode: 'PAY-TEST',
        fromDate: midPeriod ? '2026-09-20' : '2026-09-21',
        toDate: '2026-09-23',
        timesheetPeriodId: period.data.id,
        paymentDate: '2026-09-25',
      });
      const run = await pay.createRun(req, p.data.id);
      const dependents = new HrmDependentController(
        ctx as unknown as HrmContextService,
      );
      await pool.query(
        `UPDATE hrm_schema.payroll_runs SET status='APPROVED' WHERE id=$1`,
        [run.data.id],
      );
      const registered = await dependents.create(req, {
        employeeId: e,
        referenceCode: 'CHILD-1',
        fullName: 'Test dependent',
        relationship: 'Child',
        birthDate: '2020-01-01',
        evidenceReference: 'Verified test record',
        effectiveFrom: '2026-09-01',
      });
      expect(
        (await pool.query(`SELECT status FROM hrm_schema.payroll_runs WHERE id=$1`, [run.data.id])).rows[0].status,
      ).toBe('DRAFT');
      await expect(
        dependents.create(req, {
          employeeId: e,
          referenceCode: 'CHILD-1',
          fullName: 'Duplicate',
          relationship: 'Child',
          birthDate: '2020-01-01',
          evidenceReference: 'Test',
          effectiveFrom: '2026-09-01',
        }),
      ).rejects.toThrow('trùng hiệu lực');
      await pool.query(
        `UPDATE hrm_schema.employee_profiles SET bank_name='TEST BANK',bank_account_number='001234567890',bank_branch='Test branch' WHERE tenant_id=$1 AND employee_id=$2`,
        [t, e],
      );
      await expect(pay.exportRun(req, run.data.id, 'payments')).rejects.toThrow(
        'đã chốt',
      );
      for (const itemType of ['EARNING', 'OTHER_DEDUCTION'] as const) {
        const adjustment = {
          employeeId: e,
          itemType,
          itemCode: `TEST_${itemType}`,
          reason: 'Manual correction',
          amount: 100,
          operationId: randomUUID(),
        };
        const first = await pay.addAdjustment(req, run.data.id, adjustment);
        expect(
          (await pay.addAdjustment(req, run.data.id, adjustment)).data.id,
        ).toBe(first.data.id);
        await expect(
          pay.addAdjustment(req, run.data.id, { ...adjustment, amount: 200 }),
        ).rejects.toThrow('nội dung điều chỉnh khác');
      }
      const salary = new HrmSalaryController(
        ctx as unknown as HrmContextService,
      );
      const advance = await salary.createAdvanceRequest(req, {
        employeeId: e,
        requestedAmount: 500000,
        numberOfInstallments: 1,
        requestDate: '2026-09-01',
        reason: 'Test advance',
      });
      await salary.approveAdvance(req, advance.data.id, 500000);
      await salary.disburseAdvance(req, advance.data.id, {
        disbursedAmount: 500000,
      });
      await salary.scheduleAdvance(req, advance.data.id, {
        payrollPeriodId: p.data.id,
        amount: 500000,
      });
      if (midPeriod) {
        await expect(pay.calculateRun(req, run.data.id)).rejects.toThrow(
          'vào giữa kỳ',
        );
        await pool.query(
          `UPDATE hrm_schema.policy_versions v SET config_json=jsonb_set(config_json,'{standardMinutes}','1200'::jsonb) FROM hrm_schema.policies p WHERE p.id=v.policy_id AND p.tenant_id=$1 AND p.policy_type='PAYROLL'`,
          [t],
        );
      }
      await pay.calculateRun(req, run.data.id);
      await pay.calculateRun(req, run.data.id);
      await ts.reopenPeriod(req, period.data.id, 'Recheck sources');
      await expect(pay.finalizeRun(req, run.data.id)).rejects.toThrow(
        'Cần tính',
      );
      await ts.calculatePeriod(req, period.data.id);
      await ts.lockPeriod(req, period.data.id);
      await pay.calculateRun(req, run.data.id);
      const totals = await pool.query(
        `SELECT gross_salary,net_salary FROM hrm_schema.payroll_employee_totals WHERE tenant_id=$1`,
        [t],
      );
      expect(totals.rows).toEqual([
        midPeriod
          ? { gross_salary: '10725100.00', net_salary: '9225000.00' }
          : { gross_salary: '13125100.00', net_salary: '11625000.00' },
      ]);
      expect((await pay.listItems(req, run.data.id)).data).toHaveLength(7);
      expect(
        (
          await pool.query(
            `SELECT calculation_snapshot->'inputs'->>'REGISTERED_DEPENDENT_COUNT' AS n FROM hrm_schema.payroll_items WHERE tenant_id=$1 AND payroll_run_id=$2 AND source_type='FORMULA' LIMIT 1`,
            [t, run.data.id],
          )
        ).rows[0].n,
      ).toBe('1');
      await pay.finalizeRun(req, run.data.id);
      await pay.finalizeRun(req, run.data.id);
      await expect(
        dependents.end(req, registered.data.id, {
          effectiveTo: '2026-09-22',
          reason: 'Late correction',
        }),
      ).rejects.toThrow('đã chốt');
      await pool.query(
        `UPDATE hrm_schema.employee_profiles SET bank_account_number='CHANGED-LATER' WHERE tenant_id=$1 AND employee_id=$2`,
        [t, e],
      );
      const exported = await pay.exportRun(req, run.data.id, 'payments');
      expect(exported.data.csv).toContain('001234567890');
      expect(exported.data.csv).not.toContain('CHANGED-LATER');
      expect(
        (await pay.exportRun(req, run.data.id, 'reconciliation')).data.csv,
      ).toContain('ADVANCE');
      expect(
        (
          await pool.query(
            `SELECT remaining_balance,status FROM hrm_schema.salary_advance_requests WHERE id=$1`,
            [advance.data.id],
          )
        ).rows[0],
      ).toEqual({ remaining_balance: '0.00', status: 'REPAID' });
      await expect(pay.calculateRun(req, run.data.id)).rejects.toThrow(
        'không được tính lại',
      );
      await expect(
        ts.reopenPeriod(req, period.data.id, 'Late correction'),
      ).rejects.toThrow('lương chốt');
      await pay.generatePayslips(req, run.data.id);
      await pay.generatePayslips(req, run.data.id);
      expect((await pay.myPayslips(req)).data).toHaveLength(1);
      const payments = new HrmPayrollSettingsController(
        ctx as unknown as HrmContextService,
      );
      const total = (await payments.totals(req, run.data.id)).data[0];
      await payments.payment(req, total.id, { reference: 'TEST-PAYMENT' });
      await payments.payment(req, total.id, { reference: 'TEST-PAYMENT' });
      expect(
        (
          await pool.query(
            `SELECT status FROM hrm_schema.payroll_periods WHERE id=$1`,
            [p.data.id],
          )
        ).rows[0].status,
      ).toBe('PAID');
    },
  );

  it('expires carryover once and does not revive expired days on cancellation', async () => {
    const t = randomUUID(),
      e = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.employees (id,tenant_id,full_name) VALUES ($1,$2,'Carry employee')`,
      [e, t],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles (employee_id,tenant_id,employee_code,join_date) VALUES ($1,$2,'CARRY','2020-01-01')`,
      [e, t],
    );
    const type = await pool.query(
      `INSERT INTO hrm_schema.leave_types (tenant_id,code,name,carryover_allowed,max_carryover_days,carryover_expiry_month) VALUES ($1,'ANNUAL','Annual',true,3,3) RETURNING id`,
      [t],
    );
    const typeId = type.rows[0].id;
    await pool.query(
      `INSERT INTO hrm_schema.leave_balances (tenant_id,employee_id,leave_type_id,year,accrued,remaining) VALUES ($1,$2,$3,2025,3,3)`,
      [t, e, typeId],
    );
    const shift = await pool.query(
      `INSERT INTO hrm_schema.shift_definitions (tenant_id,code,name,start_time,end_time,break_minutes) VALUES ($1,'DAY','Day','08:00','16:00',0) RETURNING id`,
      [t],
    );
    await pool.query(
      `INSERT INTO hrm_schema.shift_assignments (tenant_id,employee_id,shift_id,effective_from,effective_to) VALUES ($1,$2,$3,'2026-03-01','2026-03-02')`,
      [t, e, shift.rows[0].id],
    );
    for (let i = 0; i < 2; i++)
      await hrmTransaction(pool as unknown as Pool, (db) =>
        carryoverYear(db, t, userId, 2026),
      );
    const leave = await hrmTransaction(pool as unknown as Pool, (db) =>
      createLeave(db, t, userId, {
        employeeId: e,
        leaveTypeId: typeId,
        fromDate: '2026-03-01',
        toDate: '2026-03-02',
        duration: 2,
        reason: 'Carry use',
      }),
    );
    await hrmTransaction(pool as unknown as Pool, (db) =>
      transitionLeave(db, t, userId, leave.id, 'APPROVED'),
    );
    for (let i = 0; i < 2; i++)
      await hrmTransaction(pool as unknown as Pool, (db) =>
        expireCarryovers(db, t, userId, '2026-09-01'),
      );
    await hrmTransaction(pool as unknown as Pool, (db) =>
      transitionLeave(db, t, userId, leave.id, 'CANCELLED'),
    );
    const balance = await pool.query(
      `SELECT remaining,used,pending FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND year=2026`,
      [t],
    );
    expect(balance.rows[0]).toEqual({
      remaining: '0.00',
      used: '0.00',
      pending: '0.00',
    });
    const carry = await pool.query(
      `SELECT reserved,used,expired FROM hrm_schema.leave_carryovers WHERE tenant_id=$1`,
      [t],
    );
    expect(carry.rows[0]).toEqual({
      reserved: '0.00',
      used: '0.00',
      expired: '3.00',
    });
  });

  async function fixture() {
    const t = randomUUID(),
      e = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,full_name) VALUES($1,$2,'Test employee')`,
      [e, t],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date) VALUES($1,$2,'TEST','2020-02-15')`,
      [e, t],
    );
    const ctx = {
      getContext: async () => ({ pool, tenantId: t, principal: { userId } }),
      getRequestContext: async () => ({
        pool,
        tenantId: t,
        principal: { userId },
        employeeId: e,
      }),
      resolveEmployee: async () => ({ employeeId: e }),
    } as unknown as HrmContextService;
    const shifts = new HrmShiftController(ctx),
      settings = new HrmTimeSettingsController(ctx);
    const day = await shifts.createShift(req, {
      code: 'DAY',
      name: 'Day',
      startTime: '08:00',
      endTime: '16:00',
      breakMinutes: 0,
      graceLateMinutes: 0,
      graceEarlyMinutes: 0,
    });
    await shifts.createEmployeeAssignment(req, e, {
      shiftId: day.data.id,
      effectiveFrom: '2025-01-01',
    });
    return { t, e, ctx, shifts, settings, day: day.data.id };
  }
  it('routes configured leave through Procedure, blocks direct approval and applies a repeated callback once', async () => {
    const { t, e, ctx } = await fixture();
    const type = (
      await pool.query(
        `INSERT INTO hrm_schema.leave_types(tenant_id,code,name) VALUES($1,'WF','Workflow leave') RETURNING id`,
        [t],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO hrm_schema.leave_balances(tenant_id,employee_id,leave_type_id,year,accrued,remaining) VALUES($1,$2,$3,2025,5,5)`,
      [t, e, type],
    );
    await pool.query(
      `INSERT INTO hrm_schema.workflow_rules(tenant_id,request_kind,definition_id,updated_by) VALUES($1,'LEAVE',$2,$3)`,
      [t, randomUUID(), userId],
    );
    const request = await hrmTransaction(pool as unknown as Pool, (db) =>
      createLeave(db, t, userId, {
        employeeId: e,
        leaveTypeId: type,
        fromDate: '2025-03-03',
        toDate: '2025-03-03',
        duration: 1,
        reason: 'Workflow integration',
      }),
    );
    await expect(
      hrmTransaction(pool as unknown as Pool, (db) =>
        transitionLeave(db, t, userId, request.id, 'APPROVED'),
      ),
    ).rejects.toThrow('Procedure Engine');
    const instanceId = randomUUID(),
      oldToken = process.env.INTERNAL_SERVICE_TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = 'test-only';
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: instanceId, code: 'WF-001' }), {
          status: 201,
        }),
      );
    try {
      await processHrmWorkflows(pool as unknown as Pool, t);
      const link = (
        await pool.query(
          `SELECT * FROM hrm_schema.workflow_links WHERE tenant_id=$1`,
          [t],
        )
      ).rows[0];
      expect(link.status).toBe('RUNNING');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const event = {
        id: randomUUID(),
        type: 'procedure.instance.completed',
        version: 1,
        occurredAt: new Date().toISOString(),
        tenantId: t,
        source: 'procedure-engine',
        correlationId: instanceId,
        payload: {
          instanceId,
          sourceType: 'hrm_request',
          sourceId: link.id,
          status: 'completed',
        },
      };
      await expect(
        receiveHrmWorkflowResult(pool as unknown as Pool, t, {
          ...event,
          payload: { ...event.payload, instanceId: randomUUID() },
        }),
      ).rejects.toThrow('không khớp');
      await receiveHrmWorkflowResult(pool as unknown as Pool, t, event);
      await processHrmWorkflows(pool as unknown as Pool, t);
      await receiveHrmWorkflowResult(pool as unknown as Pool, t, event);
      await processHrmWorkflows(pool as unknown as Pool, t);
      expect(
        (
          await pool.query(
            `SELECT status FROM hrm_schema.leave_requests WHERE id=$1`,
            [request.id],
          )
        ).rows[0].status,
      ).toBe('APPROVED');
      expect(
        (
          await pool.query(
            `SELECT used,pending,remaining FROM hrm_schema.leave_balances WHERE tenant_id=$1`,
            [t],
          )
        ).rows[0],
      ).toEqual({ used: '1.00', pending: '0.00', remaining: '4.00' });
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM hrm_schema.workflow_callbacks WHERE tenant_id=$1`,
            [t],
          )
        ).rows[0].n,
      ).toBe(1);
      const operations = new HrmOperationsController(ctx);
      expect((await operations.notifications(req)).data).toHaveLength(2);
      expect(
        (await operations.calendar(req, '2025-03-03', '2025-03-03')).data.map(
          (r) => r.kind,
        ),
      ).toContain('LEAVE');
      expect(
        (
          await pool.query(
            `SELECT count(*)::int AS n FROM integration_schema.outbox_events WHERE payload->>'tenantId'=$1`,
            [t],
          )
        ).rows[0].n,
      ).toBe(2);
    } finally {
      fetchMock.mockRestore();
      if (oldToken === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
      else process.env.INTERNAL_SERVICE_TOKEN = oldToken;
    }
  });
  it('automates closed-month accrual once and preserves a retryable job history', async () => {
    const { t, e } = await fixture();
    const type = (
      await pool.query(
        `INSERT INTO hrm_schema.leave_types(tenant_id,code,name) VALUES($1,'AUTO','Automated leave') RETURNING id`,
        [t],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO hrm_schema.leave_accrual_schedules(tenant_id,leave_type_id,accrual_frequency,accrual_amount,effective_from,seniority_bonus_years,seniority_bonus_days) VALUES($1,$2,'MONTHLY',1,'2025-01-01',0,0)`,
      [t, type],
    );
    await pool.query(
      `INSERT INTO hrm_schema.automation_settings(tenant_id,enabled,from_month,run_hour,configured_by) VALUES($1,true,'2025-01',0,$2)`,
      [t, userId],
    );
    const now = new Date('2025-03-10T05:00:00Z');
    await runHrmAutomation(pool as unknown as Pool, t, false, now);
    expect(
      await runHrmAutomation(pool as unknown as Pool, t, false, now),
    ).toEqual({ skipped: true });
    await runHrmAutomation(pool as unknown as Pool, t, true, now);
    expect(
      (
        await pool.query(
          `SELECT accrued FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2`,
          [t, e],
        )
      ).rows[0].accrued,
    ).toBe('2.00');
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM hrm_schema.automation_runs WHERE tenant_id=$1 AND status='SUCCEEDED'`,
          [t],
        )
      ).rows[0].n,
    ).toBe(2);
    await runHrmAutomation(
      pool as unknown as Pool,
      t,
      false,
      new Date('2025-04-10T05:00:00Z'),
    );
    expect(
      (
        await pool.query(
          `SELECT accrued FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2`,
          [t, e],
        )
      ).rows[0].accrued,
    ).toBe('3.00');
    expect(
      (
        await pool.query(
          `SELECT last_accrual_month FROM hrm_schema.automation_settings WHERE tenant_id=$1`,
          [t],
        )
      ).rows[0].last_accrual_month,
    ).toBe('2025-03');
  });
  it('withdraws a pending leave once, releases its reservation and ignores late workflow completion', async () => {
    const { t, e, ctx } = await fixture();
    const type = (
      await pool.query(
        `INSERT INTO hrm_schema.leave_types(tenant_id,code,name) VALUES($1,'WITHDRAW','Withdraw leave') RETURNING id`,
        [t],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO hrm_schema.leave_balances(tenant_id,employee_id,leave_type_id,year,accrued,remaining) VALUES($1,$2,$3,2025,5,5)`,
      [t, e, type],
    );
    await pool.query(
      `INSERT INTO hrm_schema.workflow_rules(tenant_id,request_kind,definition_id,updated_by) VALUES($1,'LEAVE',$2,$3)`,
      [t, randomUUID(), userId],
    );
    const request = await hrmTransaction(pool as unknown as Pool, (db) =>
      createLeave(db, t, userId, {
        employeeId: e,
        leaveTypeId: type,
        fromDate: '2025-03-03',
        toDate: '2025-03-03',
        duration: 1,
        reason: 'Withdraw fixture',
      }),
    );
    const operations = new HrmOperationsController(ctx);
    await operations.withdraw(req, 'leave', request.id);
    await operations.withdraw(req, 'leave', request.id);
    await processHrmWorkflows(pool as unknown as Pool, t);
    expect(
      (
        await pool.query(
          `SELECT pending,remaining,used FROM hrm_schema.leave_balances WHERE tenant_id=$1`,
          [t],
        )
      ).rows[0],
    ).toEqual({ pending: '0.00', remaining: '5.00', used: '0.00' });
    expect(
      (
        await pool.query(
          `SELECT status FROM hrm_schema.workflow_links WHERE tenant_id=$1`,
          [t],
        )
      ).rows[0].status,
    ).toBe('IGNORED');
  });
  it('links an existing account without creating another employee or losing history', async () => {
    const { t, e, ctx } = await fixture();
    const employees = new HrmEmployeeController(ctx);
    await employees.linkAccount(req, e, {
      userId,
      reason: 'ERP account mapping',
    });
    await employees.linkAccount(req, e, { userId, reason: 'Retry' });
    expect((await employees.getMyProfile(req)).data.employeeId).toBe(e);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM core_schema.employees WHERE tenant_id=$1`,
          [t],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('enforces IP, GPS and one approved device, including revocation', async () => {
    const { t, e, settings } = await fixture();
    await settings.policy(req, {
      effectiveFrom: '2025-01-01',
      timezone: 'Asia/Ho_Chi_Minh',
      requireIp: true,
      allowedIps: ['10.0.0.10'],
      requireGps: true,
      maxGpsAccuracyMeters: 50,
      requireDevice: true,
    });
    await settings.site(req, {
      name: 'Office',
      latitude: 10,
      longitude: 106,
      radiusMeters: 100,
    });
    const token = 'a'.repeat(64),
      otherToken = 'b'.repeat(64);
    const devices = await pool.query(
      `INSERT INTO hrm_schema.attendance_devices(tenant_id,employee_id,name,token_hash) VALUES($1,$2,'First',$3),($1,$2,'Second',$4) RETURNING id`,
      [t, e, deviceTokenHash(token), deviceTokenHash(otherToken)],
    );
    await settings.deviceAction(req, devices.rows[0].id, 'approve');
    const request = {
      headers: { cookie: `ep_hrm_device=${token}` },
      socket: { remoteAddress: '10.0.0.10' },
    } as unknown as Request;
    const input = {
      employeeId: e,
      kind: 'IN' as const,
      occurredAt: '2025-03-03T01:00:00Z',
      source: 'WEB_PORTAL',
      externalEventId: randomUUID(),
      latitude: 10,
      longitude: 106,
      accuracy: 20,
    };
    await expect(
      ingestEvent(pool as unknown as Pool, t, userId, input, {
        ...request,
        socket: { remoteAddress: '10.0.0.11' },
      } as Request),
    ).rejects.toThrow('IP');
    await expect(
      ingestEvent(
        pool as unknown as Pool,
        t,
        userId,
        { ...input, latitude: 11 },
        request,
      ),
    ).rejects.toThrow('bán kính');
    await ingestEvent(pool as unknown as Pool, t, userId, input, request);
    await settings.deviceAction(req, devices.rows[1].id, 'approve');
    await expect(
      ingestEvent(
        pool as unknown as Pool,
        t,
        userId,
        {
          ...input,
          kind: 'OUT',
          externalEventId: randomUUID(),
          occurredAt: '2025-03-03T09:00:00Z',
        },
        request,
      ),
    ).rejects.toThrow('Thiết bị');
    await expect(
      settings.deviceAction(req, devices.rows[0].id, 'approve'),
    ).rejects.toThrow('thu hồi');
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM hrm_schema.attendance_devices WHERE tenant_id=$1 AND status='ACTIVE'`,
          [t],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('resolves a policy at local midnight and protects locked schedules', async () => {
    const { t, e, ctx, shifts, settings, day } = await fixture();
    await settings.policy(req, {
      effectiveFrom: '2025-03-01',
      timezone: 'Asia/Ho_Chi_Minh',
      requireIp: false,
      allowedIps: [],
      requireGps: false,
      maxGpsAccuracyMeters: 50,
      requireDevice: false,
    });
    const context = await hrmTransaction(pool as unknown as Pool, (db) =>
      timeContext(db, t, e, '2025-02-28T18:00:00Z'),
    );
    expect(context.policy).toBeDefined();
    const ts = new HrmTimesheetController(ctx);
    const period = await ts.createPeriod(req, {
      periodCode: 'MARCH',
      fromDate: '2025-03-01',
      toDate: '2025-03-01',
    });
    await ts.calculatePeriod(req, period.data.id);
    await ts.lockPeriod(req, period.data.id);
    await expect(
      shifts.updateShift(req, day, { startTime: '07:00' }),
    ).rejects.toThrow('đã khóa');
    await expect(
      settings.policy(req, {
        effectiveFrom: '2025-03-01',
        timezone: 'Asia/Ho_Chi_Minh',
        requireIp: false,
        allowedIps: [],
        requireGps: false,
        maxGpsAccuracyMeters: 50,
        requireDevice: false,
      }),
    ).rejects.toThrow('đã khóa');
  });
  it('applies both sides of a confirmed swap once while preserving surrounding dates', async () => {
    const { t, e, shifts, day } = await fixture();
    const peer = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,full_name) VALUES($1,$2,'Peer')`,
      [peer, t],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date) VALUES($1,$2,'PEER','2020-01-01')`,
      [peer, t],
    );
    const night = await shifts.createShift(req, {
      code: 'NIGHT',
      name: 'Night',
      startTime: '22:00',
      endTime: '06:00',
      crossMidnight: true,
      breakMinutes: 0,
    });
    await shifts.createEmployeeAssignment(req, peer, {
      shiftId: night.data.id,
      effectiveFrom: '2025-01-01',
    });
    const change = await pool.query(
      `INSERT INTO hrm_schema.shift_change_requests(tenant_id,employee_id,current_shift_id,requested_shift_id,from_date,to_date,swap_with_employee_id,swap_peer_confirmed,status,reason) VALUES($1,$2,$3,$4,'2025-03-05','2025-03-06',$5,true,'PEER_CONFIRMED','Swap') RETURNING id`,
      [t, e, day, night.data.id, peer],
    );
    for (let i = 0; i < 2; i++)
      await hrmTransaction(pool as unknown as Pool, (db) =>
        approveShiftChange(db, t, userId, change.rows[0].id),
      );
    const rows = await pool.query(
      `SELECT employee_id,shift_id FROM hrm_schema.shift_assignments WHERE tenant_id=$1 AND status='ACTIVE' AND '2025-03-05' BETWEEN effective_from AND COALESCE(effective_to,'infinity'::date)`,
      [t],
    );
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        { employee_id: e, shift_id: night.data.id },
        { employee_id: peer, shift_id: day },
      ]),
    );
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS n FROM hrm_schema.shift_assignments WHERE tenant_id=$1 AND status='ACTIVE'`,
          [t],
        )
      ).rows[0].n,
    ).toBe(6);
  });
  it('accrues seniority in the anniversary month even for a yearly schedule and retries safely', async () => {
    const { t, e } = await fixture();
    const type = await pool.query(
      `INSERT INTO hrm_schema.leave_types(tenant_id,code,name) VALUES($1,'ANNUAL','Annual') RETURNING id`,
      [t],
    );
    await pool.query(
      `INSERT INTO hrm_schema.leave_accrual_schedules(tenant_id,leave_type_id,accrual_frequency,accrual_amount,seniority_bonus_years,seniority_bonus_days,effective_from) VALUES($1,$2,'YEARLY',12,5,1,'2025-01-01')`,
      [t, type.rows[0].id],
    );
    for (let i = 0; i < 2; i++)
      await hrmTransaction(pool as unknown as Pool, (db) =>
        accrueMonth(db, t, userId, '2025-02'),
      );
    expect(
      (
        await pool.query(
          `SELECT accrued FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2`,
          [t, e],
        )
      ).rows[0].accrued,
    ).toBe('1.00');
    await hrmTransaction(pool as unknown as Pool, (db) =>
      accrueMonth(db, t, userId, '2025-12'),
    );
    expect(
      (
        await pool.query(
          `SELECT accrued FROM hrm_schema.leave_balances WHERE tenant_id=$1 AND employee_id=$2`,
          [t, e],
        )
      ).rows[0].accrued,
    ).toBe('13.00');
  });
  it('validates saved payroll formulas and OT limits through configuration APIs', async () => {
    const { ctx } = await fixture();
    const settings = new HrmPayrollSettingsController(ctx);
    await settings.save(req, {
      effectiveFrom: '2025-01-01',
      salaryType: 'GROSS',
      inputs: { TAX: 0 },
      components: [
        {
          code: 'SALARY',
          type: 'EARNING',
          name: 'Salary',
          formula: 'PRORATED_BASE_PAY',
        },
        { code: 'NET', type: 'NET_PAY', name: 'Net', formula: 'SALARY-TAX' },
      ],
    });
    await settings.overtime(req, {
      effectiveFrom: '2025-01-01',
      dailyLimitMinutes: 240,
      weeklyLimitMinutes: 720,
      monthlyLimitMinutes: 2400,
      yearlyLimitMinutes: 12000,
      weekdayRate: 1.5,
      offRate: 2,
      holidayRate: 3,
      nightRate: 2,
    });
    expect((await settings.get(req)).data).toHaveLength(2);
  });
  it('derives OT rates from actual hours and enforces limits across midnight', async () => {
    const { t, e, ctx } = await fixture();
    const settings = new HrmPayrollSettingsController(ctx);
    await settings.overtime(req, {
      effectiveFrom: '2025-01-01',
      dailyLimitMinutes: 120,
      weeklyLimitMinutes: 600,
      monthlyLimitMinutes: 2400,
      yearlyLimitMinutes: 12000,
      weekdayRate: 1.5,
      offRate: 2,
      holidayRate: 3,
      nightRate: 2,
      nightOffRate: 3,
      nightHolidayRate: 4,
    });
    const submit = (
      workDate: string,
      startTime: string,
      endTime: string,
      plannedMinutes: number,
    ) =>
      hrmTransaction(pool as unknown as Pool, (db) =>
        createOvertime(db, t, {
          employeeId: e,
          workDate,
          startTime,
          endTime,
          plannedMinutes,
          otType: 'NIGHT',
          reason: 'Actual night rules',
        }),
      );
    const day = await submit('2025-03-02', '18:00', '19:00', 60);
    expect(day.ot_type).toBe('WEEKDAY');
    expect(Number(day.ot_rate_multiplier)).toBe(1.5);
    await submit('2025-03-03', '23:00', '01:00', 120);
    await expect(submit('2025-03-04', '01:00', '03:00', 120)).rejects.toThrow(
      'giới hạn OT day',
    );
    await expect(submit('2025-03-05', '21:00', '23:00', 120)).rejects.toThrow(
      'ranh giới',
    );
  });
  it('requires confirmed object metadata and isolates leave attachments by employee', async () => {
    const { t, e, ctx } = await fixture();
    const upload = jest
      .spyOn(S3ObjectStorage.prototype, 'createUploadUrl')
      .mockResolvedValue('https://storage.invalid/test');
    const head = jest
      .spyOn(S3ObjectStorage.prototype, 'objectMetadata')
      .mockResolvedValue({ sizeBytes: 12, contentType: 'application/pdf' });
    try {
      const files = new HrmAttachmentController(ctx);
      const file = await files.create(req, {
        employeeId: e,
        fileName: 'evidence.pdf',
        contentType: 'application/pdf',
        sizeBytes: 13,
      });
      await expect(files.complete(req, file.data.id)).rejects.toThrow(
        'không khớp',
      );
      head.mockResolvedValue({ sizeBytes: 13, contentType: 'application/pdf' });
      await files.complete(req, file.data.id);
      const type = await pool.query(
        `INSERT INTO hrm_schema.leave_types(tenant_id,code,name,requires_attachment,deduct_balance) VALUES($1,'DOC','Documented leave',true,false) RETURNING id`,
        [t],
      );
      await expect(
        hrmTransaction(pool as unknown as Pool, (db) =>
          createLeave(db, t, userId, {
            employeeId: e,
            leaveTypeId: type.rows[0].id,
            fromDate: '2025-03-03',
            toDate: '2025-03-03',
            duration: 1,
            reason: 'Proof',
            attachmentFileId: randomUUID(),
          }),
        ),
      ).rejects.toThrow('Chứng từ');
      const leave = await hrmTransaction(pool as unknown as Pool, (db) =>
        createLeave(db, t, userId, {
          employeeId: e,
          leaveTypeId: type.rows[0].id,
          fromDate: '2025-03-03',
          toDate: '2025-03-03',
          duration: 1,
          reason: 'Proof',
          attachmentFileId: file.data.id,
        }),
      );
      expect(leave.attachment_file_id).toBe(file.data.id);
    } finally {
      upload.mockRestore();
      head.mockRestore();
    }
  });
});
