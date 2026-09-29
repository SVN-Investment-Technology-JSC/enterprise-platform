import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmPayrollController } from './hrm-payroll.controller';
import { HrmPayrollSettingsController } from './hrm-payroll-settings.controller';
import { HrmSalaryController } from './hrm-salary.controller';
import { HrmPolicyController } from './hrm-policy.controller';
jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM payroll lifecycle PostgreSQL integration', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const userId = randomUUID();
  let pool: ReturnType<typeof createPostgresPool>;
  let admin: ReturnType<typeof createPostgresPool>;
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
    await migrate('hrm/0002-hrm-procedure-integration.sql');
    await migrate('hrm/0003-hrm-requests-enhancement.sql');
    await migrate('hrm/0014-hrm-profile-compatibility.sql');
    await migrate('hrm/0013-payroll-support.sql');
    await migrate('hrm/0015-hrm-procedure-sync.sql');
    await migrate('hrm/0015-procedure-definition-snapshot.sql');
    await migrate('hrm/0015-shift-submission.sql');
    await migrate('hrm/0016-hrm-lifecycle.sql');
    await migrate('hrm/0016-family-contract-lifecycle.sql');
    await migrate('hrm/0016-time-lifecycle.sql');
    await migrate('hrm/0017-hrm-request-drafts.sql');
    await migrate('hrm/0018-hrm-request-reversals.sql');
    await migrate('hrm/0018-hrm-request-reversals.sql');
    await migrate('hrm/0019-timesheet-attachment-lifecycle.sql');
    await migrate('hrm/0020-payroll-lifecycle.sql');
    await migrate('hrm/0019-timesheet-attachment-lifecycle.sql');
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      resolveEmployee: async () => ({ employeeId: userId }),
      getRequestContext: async () => ({
        pool,
        tenantId,
        principal: { userId },
      }),
    };
  }, 30_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName))
        throw new Error('Invalid test database');
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  }, 30_000);

  const ctx = () =>
    ({
      has: () => true,
      getRequestContext: async () => ({
        pool,
        tenantId,
        employeeId: userId,
        principal: { userId },
      }),
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
    }) as any;

  async function period(code: string, from: string, to: string) {
    const ts = (
      await pool.query(
        "INSERT INTO hrm_schema.timesheet_periods(tenant_id,period_code,from_date,to_date,status,calculated_at) VALUES($1,$2,$3,$4,'LOCKED',now()) RETURNING id",
        [tenantId, code, from, to],
      )
    ).rows[0];
    return (
      await new HrmPayrollController(ctx()).createPeriod(req, {
        periodCode: code,
        fromDate: from,
        toDate: to,
        paymentDate: to,
        timesheetPeriodId: ts.id,
      })
    ).data;
  }
  it('edits and deletes empty payroll periods and retains every run after cancellation', async () => {
    const c = new HrmPayrollController(ctx());
    const p = await period('EMPTY-PAY', '2029-01-01', '2029-01-31');
    const changed = (
      await (c as any).updatePeriod(req, p.id, {
        periodCode: 'EMPTY-PAY-EDIT',
        paymentDate: '2029-02-03',
        reason: 'Correct payout date',
        expectedUpdatedAt: p.updatedAt,
      })
    ).data;
    expect(changed.paymentDate).toBe('2029-02-03');
    await expect(
      (c as any).updatePeriod(req, p.id, {
        periodCode: 'STALE',
        reason: 'Stale',
        expectedUpdatedAt: p.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const run = (await c.createRun(req, p.id)).data;
    const cancelled = (
      await (c as any).cancelRun(req, run.id, {
        reason: 'Abandoned mock calculation',
        expectedUpdatedAt: run.updatedAt,
      })
    ).data;
    expect(cancelled.status).toBe('CANCELLED');
    await expect(c.calculateRun(req, run.id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(c.finalizeRun(req, run.id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      (c as any).deletePeriod(req, p.id, {
        reason: 'Has history',
        expectedUpdatedAt: changed.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const empty = await period('DELETE-PAY', '2029-03-01', '2029-03-31');
    await (c as any).deletePeriod(req, empty.id, {
      reason: 'Unused mock',
      expectedUpdatedAt: empty.updatedAt,
    });
    expect((await c.listPeriods(req)).data.some((x) => x.id === empty.id)).toBe(
      false,
    );
  });
  it('versions payroll inputs, invalidates draft calculations and protects finalized periods', async () => {
    const c = new HrmPayrollSettingsController(ctx()),
      pay = new HrmPayrollController(ctx());
    const p = await period('INPUT-PAY', '2030-01-01', '2030-01-31');
    const run = (await pay.createRun(req, p.id)).data;
    const input = (
      await c.inputs(req, userId, {
        effectiveFrom: '2030-01-01',
        inputs: { BONUS: 100 },
      })
    ).data;
    await pool.query(
      "UPDATE hrm_schema.payroll_runs SET status='CALCULATED',calculated_at=now() WHERE id=$1",
      [run.id],
    );
    const changed = (
      await (c as any).updateInputs(req, userId, '2030-01-01', {
        inputs: { BONUS: 250 },
        reason: 'Fix bonus',
        expectedUpdatedAt: input.updated_at,
      })
    ).data;
    expect(changed.inputs.BONUS).toBe(250);
    expect((await pay.getRun(req, run.id)).data.status).toBe('DRAFT');
    await expect(
      (c as any).updateInputs(req, userId, '2030-01-01', {
        inputs: { BONUS: 300 },
        reason: 'Stale',
        expectedUpdatedAt: input.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await (c as any).deleteInputs(req, userId, '2030-01-01', {
      reason: 'Remove unused input',
      expectedUpdatedAt: changed.updated_at,
    });
    expect((await (c as any).listInputs(req, userId)).data).toHaveLength(0);
    const final = (
      await c.inputs(req, userId, {
        effectiveFrom: '2030-02-01',
        inputs: { BONUS: 100 },
      })
    ).data;
    const closed = await period('CLOSED-PAY', '2030-02-01', '2030-02-28');
    await pool.query(
      "UPDATE hrm_schema.payroll_periods SET status='LOCKED' WHERE id=$1",
      [closed.id],
    );
    await expect(
      (c as any).deleteInputs(req, userId, '2030-02-01', {
        reason: 'Closed',
        expectedUpdatedAt: final.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('edits an unused policy version, rejects cyclic formulas and retains referenced versions', async () => {
    const c = new HrmPayrollSettingsController(ctx());
    const config = {
      effectiveFrom: '2031-01-01',
      salaryType: 'GROSS' as const,
      inputs: { BONUS: 100 },
      components: [
        {
          code: 'SALARY',
          name: 'Salary',
          type: 'EARNING',
          formula: 'PRORATED_BASE_PAY + BONUS',
        },
        { code: 'NET', name: 'Net', type: 'NET_PAY', formula: 'SALARY' },
      ],
    };
    const version = (await c.save(req, config)).data;
    expect((await c.get(req)).data.find((row:any)=>row.id===version.id).effective_from).toBe('2031-01-01');
    await expect(
      (c as any).updateConfiguration(req, version.id, {
        ...config,
        components: [
          { code: 'NET', name: 'Net', type: 'NET_PAY', formula: 'NET+1' },
        ],
        reason: 'Cycle',
        expectedUpdatedAt: version.updated_at,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const changed = (
      await (c as any).updateConfiguration(req, version.id, {
        ...config,
        inputs: { BONUS: 200 },
        reason: 'Unused config correction',
        expectedUpdatedAt: version.updated_at,
      })
    ).data;
    expect(changed.config_json.inputs.BONUS).toBe(200);
    await expect(
      (c as any).updateConfiguration(req, version.id, {
        ...config,
        reason: 'Stale',
        expectedUpdatedAt: version.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await (c as any).deleteConfiguration(req, version.id, {
      reason: 'Unused config',
      expectedUpdatedAt: changed.updated_at,
    });
    expect((await c.get(req)).data.some((x: any) => x.id === version.id)).toBe(
      false,
    );
    const used = (await c.save(req, { ...config, effectiveFrom: '2032-01-01' }))
      .data;
    const p = await period('USED-POLICY', '2032-01-01', '2032-01-31');
    const run = (await new HrmPayrollController(ctx()).createRun(req, p.id))
      .data;
    await pool.query(
      "INSERT INTO hrm_schema.payroll_items(tenant_id,payroll_run_id,employee_id,item_code,item_type,description,amount,policy_version_id) VALUES($1,$2,$3,'NET','NET_PAY','Mock calculation',100,$4)",
      [tenantId, run.id, userId, used.id],
    );
    await expect(
      (c as any).deleteConfiguration(req, used.id, {
        reason: 'Referenced',
        expectedUpdatedAt: used.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      (c as any).updateConfiguration(req, used.id, {
        ...config,
        effectiveFrom: '2032-01-01',
        reason: 'Referenced',
        expectedUpdatedAt: used.updated_at,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rejects payroll policy mutations through generic policy routes', async () => {
    const settings = new HrmPayrollSettingsController(ctx()),
      generic = new HrmPolicyController(ctx());
    const v = (
      await settings.save(req, {
        effectiveFrom: '2035-01-01',
        salaryType: 'GROSS',
        inputs: {},
        components: [
          {
            code: 'NET',
            name: 'Net',
            type: 'NET_PAY',
            formula: 'PRORATED_BASE_PAY',
          },
        ],
      })
    ).data;
    await expect(
      generic.updatePolicy(req, v.policy_id, { status: 'INACTIVE' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      generic.createVersion(req, v.policy_id, {
        versionNo: 99,
        effectiveFrom: '2036-01-01',
        configJson: {},
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      generic.activateVersion(req, v.policy_id, v.id),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      generic.deactivateVersion(req, v.policy_id, v.id, '2035-12-31'),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('versions manual adjustments and protects cancelled or locked payroll', async () => {
    const c = new HrmPayrollController(ctx());
    const p = await period('MANUAL-EDIT', '2034-01-01', '2034-01-31');
    const run = (await c.createRun(req, p.id)).data;
    const item = (
      await c.addAdjustment(req, run.id, {
        employeeId: userId,
        itemCode: 'BONUS',
        itemType: 'EARNING',
        amount: 100,
        reason: 'Mock bonus',
      })
    ).data;
    const changed = (
      await (c as any).updateAdjustment(req, item.id, {
        amount: 150,
        reason: 'Correct bonus',
        expectedUpdatedAt: (item as any).updatedAt,
      })
    ).data;
    expect(changed.amount).toBe(150);
    await expect(
      (c as any).updateAdjustment(req, item.id, {
        amount: 200,
        reason: 'Stale edit',
        expectedUpdatedAt: (item as any).updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await (c as any).deleteAdjustment(req, item.id, {
      reason: 'Remove unused bonus',
      expectedUpdatedAt: changed.updatedAt,
    });
    expect((await c.listItems(req, run.id)).data).toHaveLength(0);
    const second = (
      await c.addAdjustment(req, run.id, {
        employeeId: userId,
        itemCode: 'BONUS',
        itemType: 'EARNING',
        amount: 100,
        reason: 'Second mock bonus',
      })
    ).data;
    await pool.query(
      "UPDATE hrm_schema.payroll_periods SET status='LOCKED' WHERE id=$1",
      [p.id],
    );
    await expect(
      (c as any).deleteAdjustment(req, second.id, {
        reason: 'Closed',
        expectedUpdatedAt: (second as any).updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      c.addAdjustment(req, run.id, {
        employeeId: userId,
        itemCode: 'NEW',
        itemType: 'EARNING',
        amount: 100,
        reason: 'Closed',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('edits and cancels scheduled advance recovery without consuming or overbooking the debt', async () => {
    const c = new HrmSalaryController(ctx()),
      pay = new HrmPayrollController(ctx());
    const p = await period('ADVANCE-EDIT', '2033-01-01', '2033-01-31');
    const advance = (
      await pool.query(
        "INSERT INTO hrm_schema.salary_advance_requests(tenant_id,employee_id,request_date,requested_amount,approved_amount,number_of_installments,reason,status) VALUES($1,$2,'2033-01-01',100,100,1,'Mock advance','APPROVED') RETURNING id",
        [tenantId, userId],
      )
    ).rows[0];
    await c.disburseAdvance(req, advance.id, { disbursedAmount: 100 });
    const deduction = (
      await c.scheduleAdvance(req, advance.id, {
        payrollPeriodId: p.id,
        amount: 80,
      })
    ).data;
    const run = (await pay.createRun(req, p.id)).data;
    await pool.query(
      "UPDATE hrm_schema.payroll_runs SET status='CALCULATED' WHERE id=$1",
      [run.id],
    );
    const changed = (
      await (c as any).updateDeduction(req, deduction.id, {
        amount: 90,
        reason: 'Correct scheduled recovery',
        expectedUpdatedAt: deduction.updatedAt,
      })
    ).data;
    expect(changed.scheduledAmount).toBe(90);
    expect((await pay.getRun(req, run.id)).data.status).toBe('DRAFT');
    await expect(
      (c as any).updateDeduction(req, deduction.id, {
        amount: 101,
        reason: 'Too much',
        expectedUpdatedAt: changed.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await (c as any).cancelDeduction(req, deduction.id, {
      reason: 'Reschedule mock',
      expectedUpdatedAt: changed.updatedAt,
    });
    const again = (
      await c.scheduleAdvance(req, advance.id, {
        payrollPeriodId: p.id,
        amount: 100,
      })
    ).data;
    expect(again.installmentNo).toBe(2);
    expect(
      (
        await pool.query(
          'SELECT remaining_balance FROM hrm_schema.salary_advance_requests WHERE id=$1',
          [advance.id],
        )
      ).rows[0].remaining_balance,
    ).toBe('100.00');
    await pool.query(
      "UPDATE hrm_schema.payroll_periods SET status='LOCKED' WHERE id=$1",
      [p.id],
    );
    await expect(
      (c as any).cancelDeduction(req, again.id, {
        reason: 'Closed period',
        expectedUpdatedAt: again.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
