import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmEmployeeController } from './hrm-employee.controller';
import { HrmSalaryController } from './hrm-salary.controller';
import type { HrmContextService } from '../infrastructure/hrm-context.service';
import type { HrmProcedureBridgeService } from '../infrastructure/hrm-procedure-bridge.service';
import { submitHrmRequest } from '../infrastructure/hrm-submission';
import { ingestEvent } from '../infrastructure/hrm-attendance-ingest';
jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM catalog lifecycle PostgreSQL integration', () => {
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
    await migrate('hrm/0002-hrm-procedure-integration.sql');
    await migrate('hrm/0003-hrm-requests-enhancement.sql');
    await migrate('hrm/0014-hrm-profile-compatibility.sql');
    await migrate('hrm/0013-payroll-support.sql');
    await migrate('hrm/0015-hrm-procedure-sync.sql');
    await migrate('hrm/0015-procedure-definition-snapshot.sql');
    await migrate('hrm/0015-shift-submission.sql');
    await migrate('hrm/0016-hrm-lifecycle.sql');
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
  }, 30_000);

  const salary = (tenant = tenantId) =>
    new HrmSalaryController(
      {
        getContext: async () => ({
          pool,
          tenantId: tenant,
          principal: { userId },
        }),
      } as unknown as HrmContextService,
      {} as HrmProcedureBridgeService,
    );
  it('preserves JD authorities, rejects stale edits and protects an assigned position', async () => {
    const tree = randomUUID(),
      type = randomUUID(),
      position = randomUUID();
    await pool.query(
      "INSERT INTO core_schema.organization_trees(id,code,name) VALUES ($1,'TEST','Test')",
      [tree],
    );
    await pool.query(
      "INSERT INTO core_schema.organization_node_types(id,code,name,category) VALUES ($1,'POS','Position','position')",
      [type],
    );
    await pool.query(
      "INSERT INTO core_schema.organization_nodes(id,tree_id,node_type_id,code,name,category) VALUES ($1,$2,$3,'P1','Test position','position')",
      [position, tree, type],
    );
    const before = (
      await controller.createPositionProfile(req, position, {
        description: 'Original JD',
        authorities: ['Approve a draft'],
      })
    ).data;
    expect((before as any).authorities).toEqual(['Approve a draft']);
    const next = (
      await controller.updatePositionProfile(req, position, {
        description: 'Changed',
        expectedUpdatedAt: before.updatedAt,
      })
    ).data;
    await expect(
      controller.updatePositionProfile(req, position, {
        description: 'Stale',
        expectedUpdatedAt: before.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      controller.createPositionProfile(req, position, {
        description: 'Overwrite by POST',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query(
      'INSERT INTO core_schema.organization_node_assignments(id,node_id,user_id) VALUES ($1,$2,$3)',
      [randomUUID(), position, userId],
    );
    await expect(
      (controller.deletePositionProfile as any)(req, position, {
        expectedUpdatedAt: next.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const inactive = await controller.updatePositionProfile(req, position, {
      active: false,
      expectedUpdatedAt: next.updatedAt,
    });
    expect(inactive.data.active).toBe(false);
  });
  it('rejects stale profile writes and preserves the winning edit', async () => {
    const before = (await controller.getMyProfile(req)).data;
    const first = await controller.updateEmployeeProfile(req, userId, {
      phone: '0900000001',
      expectedUpdatedAt: before.updatedAt,
    } as any);
    await expect(
      controller.updateEmployeeProfile(req, userId, {
        phone: '0900000002',
        expectedUpdatedAt: before.updatedAt,
      } as any),
    ).rejects.toMatchObject({ status: 409 });
    expect((await controller.getMyProfile(req)).data.phone).toBe('0900000001');
    expect(first.data.updatedAt).not.toBe(before.updatedAt);
  });
  it('requires a version, rejects cross-tenant writes, and never updates the Core account during deactivation', async () => {
    const before = (await controller.getMyProfile(req)).data;
    await expect(
      controller.updateEmployeeProfile(req, userId, { phone: '0900000003' }),
    ).rejects.toMatchObject({ status: 400 });
    const other = new HrmEmployeeController({
      getContext: async () => ({
        pool,
        tenantId: randomUUID(),
        principal: { userId },
      }),
    } as unknown as HrmContextService);
    await expect(
      other.updateEmployeeProfile(req, userId, {
        phone: '0900000003',
        expectedUpdatedAt: before.updatedAt,
      } as any),
    ).rejects.toMatchObject({ status: 404 });
    const period = await pool.query(
      "INSERT INTO hrm_schema.timesheet_periods (tenant_id,period_code,from_date,to_date) VALUES ($1,'HISTORY','2026-01-01','2026-01-31') RETURNING id",
      [tenantId],
    );
    await pool.query(
      "INSERT INTO hrm_schema.timesheets (tenant_id,period_id,employee_id,work_date,worked_minutes) VALUES ($1,$2,$3,'2026-01-02',480)",
      [tenantId, period.rows[0].id, userId],
    );
    const result = await (controller as any).deactivateEmployee(req, userId, {
      effectiveDate: '2026-09-01',
      reason: 'End employment for lifecycle test',
      expectedUpdatedAt: before.updatedAt,
    });
    expect(result.data.employmentStatus).toBe('RESIGNED');
    expect(
      (
        await pool.query(
          'SELECT worked_minutes FROM hrm_schema.timesheets WHERE employee_id=$1',
          [userId],
        )
      ).rows[0].worked_minutes,
    ).toBe(480);
    expect(
      (
        await pool.query(
          'SELECT is_active FROM core_schema.users WHERE id=$1',
          [userId],
        )
      ).rows[0].is_active,
    ).toBe(true);
    expect(
      (
        await pool.query(
          "SELECT detail FROM hrm_schema.audit_log WHERE entity_id=$1 AND action='EMPLOYEE_DEACTIVATED'",
          [userId],
        )
      ).rows[0].detail.reason,
    ).toBe('End employment for lifecycle test');
  });
  it('rejects concurrent grade edits and prevents a foreign tenant from attaching steps', async () => {
    const s = salary();
    const grade = (await s.createGrade(req, { code: 'G1', name: 'Grade one' }))
      .data;
    const results = await Promise.allSettled([
      s.updateGrade(req, grade.id, {
        name: 'Winner A',
        expectedUpdatedAt: grade.updatedAt,
      } as any),
      s.updateGrade(req, grade.id, {
        name: 'Winner B',
        expectedUpdatedAt: grade.updatedAt,
      } as any),
    ]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((x) => x.status === 'rejected')).toHaveLength(1);
    await expect(
      salary(randomUUID()).createGradeStep(req, grade.id, {
        stepNo: 1,
        minSalary: 1,
        midSalary: 2,
        maxSalary: 3,
        baseSalary: 2,
        effectiveFrom: '2026-01-01',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('blocks new HRM submissions after deactivation without disabling the ERP login', async () => {
    const create = jest.fn(async () => ({
      id: randomUUID(),
      employee_id: userId,
      status: 'DRAFT',
    }));
    await expect(
      submitHrmRequest(
        pool,
        {} as HrmProcedureBridgeService,
        {
          tenantId,
          employeeId: userId,
          initiatedBy: userId,
          kind: 'advance',
          title: 'Inactive submission',
        },
        create,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects attendance after the employee end date and excludes inactive employee options', async () => {
    await expect(
      ingestEvent(pool, tenantId, userId, {
        employeeId: userId,
        kind: 'IN',
        occurredAt: '2026-09-02T02:00:00.000Z',
        source: 'BIOMETRIC_DEVICE',
        externalEventId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await controller.employeeOptions(req)).data.some(
        (x) => x.employeeId === userId,
      ),
    ).toBe(false);
  });
  it('allows removal of unused catalog rows but protects referenced salary history', async () => {
    const s = salary();
    const grade = (
      await s.createGrade(req, { code: 'G2', name: 'Historical grade' })
    ).data;
    const step = (
      await s.createGradeStep(req, grade.id, {
        stepNo: 1,
        minSalary: 100,
        midSalary: 200,
        maxSalary: 300,
        baseSalary: 200,
        effectiveFrom: '2026-01-01',
      })
    ).data;
    const changed = (
      await (s as any).updateGradeStep(req, grade.id, step.id, {
        baseSalary: 250,
        expectedUpdatedAt: step.updatedAt,
      })
    ).data;
    await expect(
      (s as any).updateGradeStep(req, grade.id, step.id, {
        baseSalary: 260,
        expectedUpdatedAt: step.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query(
      "INSERT INTO hrm_schema.employee_salary_profiles (tenant_id,employee_id,salary_grade_id,salary_step_id,effective_from) VALUES ($1,$2,$3,$4,'2026-01-01')",
      [tenantId, userId, grade.id, step.id],
    );
    await expect(
      (s as any).deleteGradeStep(req, grade.id, step.id, {
        expectedUpdatedAt: changed.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      (s as any).deleteGrade(req, grade.id, {
        expectedUpdatedAt: grade.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const unused = (
      await s.createGrade(req, { code: 'UNUSED', name: 'Unused' })
    ).data;
    await (s as any).deleteGrade(req, unused.id, {
      expectedUpdatedAt: unused.updatedAt,
    });
    expect((await s.listGrades(req)).data.some((x) => x.id === unused.id)).toBe(
      false,
    );
  });
});
