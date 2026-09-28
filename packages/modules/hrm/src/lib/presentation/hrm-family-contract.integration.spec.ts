import { HrmDependentController } from './hrm-dependent.controller';
import { HrmContractController } from './hrm-contract.controller';
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
integration('HRM family and contract PostgreSQL integration', () => {
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
    await migrate('hrm/0016-family-contract-lifecycle.sql');
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      resolveEmployee: async () => ({ employeeId: userId }),
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

  it('creates contracts as drafts and rejects caller-forced activation', async () => {
    const body = {
      contractCode: 'DEMO-CONTRACT',
      contractType: 'DEFINITE',
      effectiveFrom: '2026-10-01',
      effectiveTo: '2027-09-30',
      baseSalary: 20000000,
    };
    const draft = (await controller.createEmployeeContract(req, userId, body))
      .data;
    expect(draft.status).toBe('DRAFT');
    await expect(
      controller.createEmployeeContract(req, userId, {
        ...body,
        contractCode: 'FORCED',
        status: 'ACTIVE',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('keeps family declarations separate from tax and rejects stale or foreign edits', async () => {
    const family = (
      await controller.createMyDependent(req, {
        fullName: 'Mock child',
        relationship: 'Con',
        dateOfBirth: '2020-01-01',
        isDependent: true,
      })
    ).data;
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM hrm_schema.employee_dependents',
        )
      ).rows[0].n,
    ).toBe(0);
    const edited = await controller.updateMyDependent(req, family.id, {
      phone: '0900000001',
      expectedUpdatedAt: family.updatedAt,
    } as any);
    await expect(
      controller.updateMyDependent(req, family.id, {
        phone: '0900000002',
        expectedUpdatedAt: family.updatedAt,
      } as any),
    ).rejects.toMatchObject({ status: 409 });
    const foreign = new HrmEmployeeController({
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      resolveEmployee: async () => ({ employeeId: randomUUID() }),
    } as any);
    await expect(
      foreign.updateMyDependent(req, family.id, {
        phone: '0900000002',
        expectedUpdatedAt: edited.data.updatedAt,
      } as any),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('versions drafts, freezes issued contracts and creates an amendment without changing payroll', async () => {
    const c = new HrmContractController({
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
    } as any);
    const draft = (
      await controller.createEmployeeContract(req, userId, {
        contractCode: 'LIFECYCLE',
        contractType: 'DEFINITE',
        effectiveFrom: '2026-10-01',
        effectiveTo: '2027-09-30',
        status: 'DRAFT',
        signDate: '2026-09-28',
        fileUrl: '/documents/mock-contract.pdf',
        baseSalary: 18000000,
      })
    ).data;
    const edited = (
      await c.update(req, draft.id, {
        expectedUpdatedAt: draft.updatedAt,
        note: 'Mock draft revised',
      })
    ).data;
    await expect(
      c.update(req, draft.id, {
        expectedUpdatedAt: draft.updatedAt,
        note: 'stale',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const active = (
      await c.activate(req, draft.id, { expectedUpdatedAt: edited.updatedAt })
    ).data;
    expect(active.status).toBe('ACTIVE');
    expect(active.issuedSnapshot.contract_code).toBe('LIFECYCLE');
    await expect(
      c.update(req, draft.id, {
        expectedUpdatedAt: active.updatedAt,
        note: 'overwrite signed',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      c.remove(req, draft.id, { expectedUpdatedAt: active.updatedAt }),
    ).rejects.toMatchObject({ status: 409 });
    const amendment = (
      await c.amend(req, draft.id, {
        expectedUpdatedAt: active.updatedAt,
        contractCode: 'LIFECYCLE-PL1',
        contractType: 'AMENDMENT',
        effectiveFrom: '2026-11-01',
        effectiveTo: '2027-09-30',
        baseSalary: 19000000,
        reason: 'Mock revision',
      })
    ).data;
    expect(amendment.parentContractId).toBe(draft.id);
    expect(amendment.status).toBe('DRAFT');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int n FROM hrm_schema.employee_salary_profiles',
        )
      ).rows[0].n,
    ).toBe(0);
    const ended = (
      await c.terminate(req, draft.id, {
        expectedUpdatedAt: active.updatedAt,
        effectiveDate: '2027-08-31',
        reason: 'Mock termination',
        evidenceReference: '/documents/mock-end.pdf',
      })
    ).data;
    expect(ended.status).toBe('TERMINATED');
    expect(ended.issuedSnapshot.effective_to).toBe('2027-09-30');
    await expect(
      c.activate(req, amendment.id, { expectedUpdatedAt: amendment.updatedAt }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('soft-deletes unused contract drafts and rejects cross-tenant access', async () => {
    const c = new HrmContractController({
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
    } as any);
    const foreign = new HrmContractController({
      getContext: async () => ({
        pool,
        tenantId: randomUUID(),
        principal: { userId },
      }),
    } as any);
    const d = (
      await controller.createEmployeeContract(req, userId, {
        contractCode: 'DELETE-DRAFT',
        contractType: 'PROBATION',
        effectiveFrom: '2026-10-01',
        status: 'DRAFT',
      })
    ).data;
    await expect(
      foreign.remove(req, d.id, { expectedUpdatedAt: d.updatedAt }),
    ).rejects.toMatchObject({ status: 404 });
    await c.remove(req, d.id, { expectedUpdatedAt: d.updatedAt });
    expect(
      (await controller.getEmployeeContracts(req, userId)).data.some(
        (x) => x.id === d.id,
      ),
    ).toBe(false);
  });
  it('versions verified registrations and prevents changes affecting locked payroll', async () => {
    const c = new HrmDependentController({
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
    } as any);
    const data = (
      await c.create(req, {
        employeeId: userId,
        referenceCode: 'MOCK-TAX',
        fullName: 'Mock child',
        relationship: 'Con',
        birthDate: '2020-01-01',
        evidenceReference: 'Mock evidence',
        effectiveFrom: '2026-09-01',
      })
    ).data;
    const first = (
      await c.update(req, data.id, {
        expectedUpdatedAt: new Date(data.updated_at).toISOString(),
        fullName: 'Mock child updated',
        reason: 'Correction',
        evidenceReference: 'Mock evidence revised',
      })
    ).data;
    await expect(
      c.end(req, data.id, {
        effectiveTo: '2026-10-31',
        reason: 'Stale cutoff',
        expectedUpdatedAt: new Date(data.updated_at).toISOString(),
        evidenceReference: 'Mock evidence',
      } as any),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query(
      "INSERT INTO hrm_schema.payroll_periods(tenant_id,period_code,from_date,to_date,payment_date,status) VALUES($1,'LOCKED-TAX','2026-09-01','2026-09-30','2026-10-05','LOCKED')",
      [tenantId],
    );
    await expect(
      c.update(req, data.id, {
        expectedUpdatedAt: first.updated_at,
        effectiveFrom: '2026-10-01',
        reason: 'Late correction',
        evidenceReference: 'Mock evidence',
      }),
    ).rejects.toThrow('đã chốt');
    const ended = (
      await c.end(req, data.id, {
        expectedUpdatedAt: first.updated_at,
        effectiveTo: '2026-10-31',
        reason: 'End after locked period',
        evidenceReference: 'Mock evidence',
      } as any)
    ).data;
    expect(String(ended.effective_to).slice(0, 10)).toBe('2026-10-31');
  });
});
