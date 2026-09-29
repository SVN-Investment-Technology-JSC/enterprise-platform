import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmTimesheetController } from './hrm-timesheet.controller';
import { HrmAttachmentController } from './hrm-attachment.controller';
import { S3ObjectStorage } from '@enterprise-platform/adapter-storage';
jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM timesheet lifecycle PostgreSQL integration', () => {
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

  it('edits empty periods with version checks and refuses removal when payroll references them', async () => {
    const c = new HrmTimesheetController(ctx());
    const period = (
      await c.createPeriod(req, {
        periodCode: 'EMPTY',
        fromDate: '2029-01-01',
        toDate: '2029-01-31',
      })
    ).data;
    const edited = (
      await (c as any).updatePeriod(req, period.id, {
        periodCode: 'EMPTY-EDIT',
        fromDate: '2029-01-02',
        toDate: '2029-01-30',
        expectedUpdatedAt: period.updatedAt,
        reason: 'Correct mock dates',
      })
    ).data;
    expect(edited.fromDate).toBe('2029-01-02');
    await expect(
      (c as any).updatePeriod(req, period.id, {
        expectedUpdatedAt: period.updatedAt,
        periodCode: 'STALE',
        reason: 'Stale',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const foreign = new HrmTimesheetController({
      ...ctx(),
      getContext: async () => ({
        pool,
        tenantId: randomUUID(),
        principal: { userId },
      }),
    } as any);
    await expect(
      (foreign as any).deletePeriod(req, period.id, {
        expectedUpdatedAt: edited.updatedAt,
        reason: 'Foreign',
      }),
    ).rejects.toMatchObject({ status: 404 });
    const payroll = (
      await pool.query(
        "INSERT INTO hrm_schema.payroll_periods(tenant_id,period_code,from_date,to_date,payment_date,timesheet_period_id) VALUES($1,'LINKED','2029-01-02','2029-01-30','2029-01-31',$2) RETURNING id",
        [tenantId, period.id],
      )
    ).rows[0];
    await expect(
      (c as any).deletePeriod(req, period.id, {
        expectedUpdatedAt: edited.updatedAt,
        reason: 'Referenced',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query('DELETE FROM hrm_schema.payroll_periods WHERE id=$1', [
      payroll.id,
    ]);
    await (c as any).deletePeriod(req, period.id, {
      expectedUpdatedAt: edited.updatedAt,
      reason: 'Empty mock cleanup',
    });
    await expect(c.getPeriod(req, period.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it('recalculates source facts without losing manual pay and requires renewed review when source changes', async () => {
    const c = new HrmTimesheetController(ctx());
    const shift = (
      await pool.query(
        "INSERT INTO hrm_schema.shift_definitions(tenant_id,code,name,start_time,end_time,break_minutes,break_start_time,break_end_time) VALUES($1,'DAY','Mock day','08:00','17:00',60,'12:00','13:00') RETURNING id",
        [tenantId],
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO hrm_schema.shift_assignments(tenant_id,employee_id,shift_id,effective_from,effective_to) VALUES($1,$2,$3,'2026-08-01','2026-08-03')",
      [tenantId, userId, shift.id],
    );
    for (const [kind, time] of [
      ['IN', '01:00'],
      ['OUT', '10:00'],
    ])
      await pool.query(
        `INSERT INTO hrm_schema.attendance_events(tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence,created_by) VALUES($1,$2,'2026-08-01',$3,$4,'BIOMETRIC',$3,'{}',$2)`,
        [tenantId, userId, kind, '2026-08-01T' + time + ':00Z'],
      );
    const period = (
      await c.createPeriod(req, {
        periodCode: 'MANUAL',
        fromDate: '2026-08-01',
        toDate: '2026-08-01',
      })
    ).data;
    await c.calculatePeriod(req, period.id);
    let line = (await c.listTimesheets(req, period.id)).data[0];
    await c.adjustTimesheet(req, line.id, {
      paidMinutes: 360,
      reason: 'Mock manual adjustment',
      expectedUpdatedAt: line.updatedAt,
    } as any);
    await c.calculatePeriod(req, period.id);
    line = (await c.listTimesheets(req, period.id)).data[0];
    expect(line.paidMinutes).toBe(360);
    expect(line.status).toBe('ADJUSTED');
    await pool.query(
      "UPDATE hrm_schema.attendance_events SET occurred_at='2026-08-01T02:00:00Z' WHERE tenant_id=$1 AND event_kind='IN'",
      [tenantId],
    );
    await c.calculatePeriod(req, period.id);
    line = (await c.listTimesheets(req, period.id)).data[0];
    expect(line.workedMinutes).toBe(420);
    expect(line.paidMinutes).toBe(360);
    expect(line.status).toBe('ABNORMAL');
    expect((line as any).adjustmentNeedsReview).toBe(true);
    await expect(c.lockPeriod(req, period.id)).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      (c as any).deletePeriod(req, period.id, {
        expectedUpdatedAt: (await c.getPeriod(req, period.id)).data.updatedAt,
        reason: 'Contains lines',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await c.adjustTimesheet(req, line.id, {
      paidMinutes: 360,
      reason: 'Confirmed new attendance',
      expectedUpdatedAt: line.updatedAt,
    } as any);
    await c.lockPeriod(req, period.id);
    await expect(
      c.adjustTimesheet(req, line.id, {
        paidMinutes: 300,
        reason: 'Locked',
        expectedUpdatedAt: line.updatedAt,
      } as any),
    ).rejects.toMatchObject({ status: 400 });
    await c.reopenPeriod(req, period.id, 'Reopen mock');
    expect((await c.getPeriod(req, period.id)).data.status).toBe('REOPENED');
  });
  it('does not charge absence on or after the recorded inactive date', async () => {
    const c = new HrmTimesheetController(ctx());
    const period = (
      await c.createPeriod(req, {
        periodCode: 'INACTIVE',
        fromDate: '2026-08-02',
        toDate: '2026-08-03',
      })
    ).data;
    await c.calculatePeriod(req, period.id);
    expect((await c.listTimesheets(req, period.id)).data).toHaveLength(2);
    await pool.query(
      "UPDATE hrm_schema.employee_profiles SET inactive_from='2026-08-02',employment_status='RESIGNED' WHERE tenant_id=$1 AND employee_id=$2",
      [tenantId, userId],
    );
    await c.calculatePeriod(req, period.id);
    expect((await c.listTimesheets(req, period.id)).data).toHaveLength(0);
  });
  it('removes unused attachments from drafts with a new revision and prevents download or revival', async () => {
    const file = (
      await pool.query(
        `INSERT INTO hrm_schema.attachments(tenant_id,employee_id,file_name,object_key,content_type,size_bytes,uploaded_by,status) VALUES($1,$2,'mock.pdf',$3,'application/pdf',12,$2,'READY') RETURNING id`,
        [tenantId, userId, randomUUID()],
      )
    ).rows[0];
    const draft = (
      await pool.query(
        `INSERT INTO hrm_schema.request_drafts(tenant_id,employee_id,request_kind,payload,created_by) VALUES($1,$2,'leave',$3,$2) RETURNING id`,
        [
          tenantId,
          userId,
          JSON.stringify({ attachmentFileId: file.id, reason: 'Draft proof' }),
        ],
      )
    ).rows[0];
    const c = new HrmAttachmentController(ctx());
    const foreign = new HrmAttachmentController({
      ...ctx(),
      getContext: async () => ({
        pool,
        tenantId: randomUUID(),
        principal: { userId },
      }),
    } as any);
    await expect(
      (foreign as any).remove(req, file.id, { reason: 'Foreign' }),
    ).rejects.toMatchObject({ status: 404 });
    const download = jest
      .spyOn(S3ObjectStorage.prototype, 'createDownloadUrl')
      .mockResolvedValue('https://storage.invalid/mock');
    try {
      await expect(foreign.download(req, file.id)).rejects.toMatchObject({
        status: 404,
      });
      await (c as any).remove(req, file.id, {
        reason: 'Replace draft evidence',
      });
      const saved = (
        await pool.query(
          'SELECT payload,revision FROM hrm_schema.request_drafts WHERE id=$1',
          [draft.id],
        )
      ).rows[0];
      expect(saved.payload.attachmentFileId).toBeUndefined();
      expect(saved.revision).toBe(2);
      await expect(c.download(req, file.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(c.complete(req, file.id)).rejects.toMatchObject({
        status: 404,
      });
      expect(download).not.toHaveBeenCalled();
      expect(
        (
          await pool.query(
            'SELECT deleted_at,object_key FROM hrm_schema.attachments WHERE id=$1',
            [file.id],
          )
        ).rows[0].deleted_at,
      ).not.toBeNull();
    } finally {
      download.mockRestore();
    }
  });
  it('retains attachment evidence once any submitted request references it', async () => {
    const file = (
      await pool.query(
        `INSERT INTO hrm_schema.attachments(tenant_id,employee_id,file_name,object_key,content_type,size_bytes,uploaded_by,status) VALUES($1,$2,'submitted.pdf',$3,'application/pdf',12,$2,'READY') RETURNING id`,
        [tenantId, userId, randomUUID()],
      )
    ).rows[0];
    const type = (
      await pool.query(
        `INSERT INTO hrm_schema.leave_types(tenant_id,code,name) VALUES($1,'PROOF','Proof') RETURNING id`,
        [tenantId],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO hrm_schema.leave_requests(tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,attachment_file_id,status) VALUES($1,$2,$3,'2026-08-01','2026-08-01',1,'Submitted proof',$4,'REJECTED')`,
      [tenantId, userId, type.id, file.id],
    );
    await expect(
      (new HrmAttachmentController(ctx()) as any).remove(req, file.id, {
        reason: 'Must retain',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await pool.query(
          'SELECT deleted_at FROM hrm_schema.attachments WHERE id=$1',
          [file.id],
        )
      ).rows[0].deleted_at,
    ).toBeNull();
  });
});
