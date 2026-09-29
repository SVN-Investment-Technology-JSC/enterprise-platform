import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { HrmEmployeeController } from '../presentation/hrm-employee.controller';
import type { HrmContextService } from './hrm-context.service';
import type { Request } from 'express';

jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

integration.each(['fresh', 'verified-tax', 'legacy-family'])(
  'HRM schema compatibility: %s',
  (layout) => {
    const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
    const tenantId = randomUUID(),
      employeeId = randomUUID(),
      userId = randomUUID(),
      familyId = randomUUID();
    let pool: ReturnType<typeof createPostgresPool>;
    let admin: ReturnType<typeof createPostgresPool>;
    const migrate = async (path: string) =>
      pool.query(
        await readFile(
          resolve(process.cwd(), '../../../migrations/tenant', path),
          'utf8',
        ),
      );
    beforeAll(async () => {
      const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
      if (!['localhost', '127.0.0.1'].includes(url.hostname))
        throw new Error('Local DB required');
      admin = createPostgresPool(url.toString());
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      url.pathname = '/' + databaseName;
      pool = createPostgresPool(url.toString());
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
      ])
        await migrate(path);
      await pool.query(
        `INSERT INTO core_schema.users(id,full_name,email,password_hash) VALUES ($1,'Nguyễn Minh Anh','minhanh@example.test','test');`,
        [userId],
      );
      await pool.query(
        `INSERT INTO core_schema.employees(id,tenant_id,user_id,full_name) VALUES ($1,$2,$3,'Nguyễn Minh Anh')`,
        [employeeId, tenantId, userId],
      );
      await pool.query(
        `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date) VALUES ($1,$2,'NV001','2026-01-01')`,
        [employeeId, tenantId],
      );
      if (layout === 'verified-tax') {
        await migrate('hrm/0013-payroll-support.sql');
        await pool.query(
          `INSERT INTO hrm_schema.employee_dependents(id,tenant_id,employee_id,reference_code,full_name,relationship,birth_date,evidence_reference,effective_from,verified_by)
        VALUES($1,$2,$3,'GT001','Nguyễn An','Con','2020-01-01','HS001','2026-01-01',$4)`,
          [familyId, tenantId, employeeId, userId],
        );
      }
      if (layout === 'legacy-family') {
        await pool.query(`CREATE TABLE hrm_schema.employee_dependents (
        id uuid PRIMARY KEY,tenant_id uuid NOT NULL,employee_id uuid NOT NULL,full_name text NOT NULL,relationship text NOT NULL,
        date_of_birth date,phone text,identity_card_number text,tax_code text,is_dependent boolean DEFAULT false,
        dependent_from date,dependent_to date,note text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
        created_by uuid,updated_by uuid,deleted_at timestamptz,deleted_by uuid);
      `);
        await pool.query(
          `INSERT INTO hrm_schema.employee_dependents(id,tenant_id,employee_id,full_name,relationship,date_of_birth,is_dependent)
        VALUES($1,$2,$3,'Nguyễn An','Con','2020-01-01',true)`,
          [familyId, tenantId, employeeId],
        );
      }
    }, 30_000);
    afterAll(async () => {
      await pool?.end();
      if (admin) {
        if (!/^hrm_test_[a-f0-9]{32}$/.test(databaseName))
          throw new Error('Invalid test DB');
        await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
        await admin.end();
      }
    }, 30_000);
    it('upgrades twice without changing identity or promoting self declarations to tax relief', async () => {
      for (let pass = 0; pass < 2; pass++) {
        await migrate('hrm/0002-hrm-procedure-integration.sql');
        await migrate('hrm/0003-hrm-requests-enhancement.sql');
        await migrate('hrm/0014-hrm-profile-compatibility.sql');
        await migrate('hrm/0013-payroll-support.sql');
      }
      const verified = await pool.query(
        'SELECT id,effective_from::text FROM hrm_schema.employee_dependents',
      );
      expect(verified.rows).toEqual(
        layout === 'verified-tax'
          ? [{ id: familyId, effective_from: '2026-01-01' }]
          : [],
      );
      const family = await pool.query(
        'SELECT id FROM hrm_schema.employee_family_members',
      );
      expect(family.rows).toEqual(
        layout === 'legacy-family' ? [{ id: familyId }] : [],
      );
      const ctx = {
        getContext: jest.fn(async () => ({
          pool,
          tenantId,
          principal: { userId },
        })),
        resolveEmployee: jest.fn(async () => ({
          employeeId,
          fullName: 'Nguyễn Minh Anh',
        })),
        getRequestContext: jest.fn(async () => ({
          pool,
          tenantId,
          principal: { userId },
          employeeId,
        })),
      };
      const controller = new HrmEmployeeController(
        ctx as unknown as HrmContextService,
      );
      const req = { headers: {} } as Request;
      const created = await controller.createMyDependent(req, {
        fullName: 'Nguyễn Bình',
        relationship: 'Con',
        isDependent: true,
      });
      expect(created.data.employeeId).toBe(employeeId);
      expect(ctx.getContext).toHaveBeenCalledWith(
        req,
        'hrm.self.profile.write',
      );
      const mine = await controller.getMyDependents(req);
      expect(mine.data.some((row) => row.id === created.data.id)).toBe(true);
      const count = await pool.query(
        'SELECT count(*)::int AS count FROM hrm_schema.employee_dependents',
      );
      expect(count.rows[0].count).toBe(layout === 'verified-tax' ? 1 : 0);
      await controller.updateMyProfile(req, { nationality: 'Việt Nam' });
      const profile = await controller.getMyProfile(req);
      expect(profile.data.nationality).toBe('Việt Nam');
      expect(
        profile.data.dependents?.some((row) => row.id === created.data.id),
      ).toBe(true);
    });
  },
);
