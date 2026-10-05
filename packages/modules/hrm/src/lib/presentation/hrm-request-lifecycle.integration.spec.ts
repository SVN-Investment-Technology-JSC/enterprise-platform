import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { HrmOperationsController } from './hrm-operations.controller';
import { HrmSalaryController } from './hrm-salary.controller';
import { HrmLeaveController } from './hrm-leave.controller';
import { HrmAttendanceController } from './hrm-attendance.controller';
import { HrmRequestController } from './hrm-request.controller';
import { hrmTransaction } from '../infrastructure/hrm-transaction';
import { approveAttendanceCorrection } from '../infrastructure/hrm-request-transition';
import { testApprovalPolicy } from '../infrastructure/hrm-test-support';
jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));
const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('HRM request draft lifecycle PostgreSQL integration', () => {
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

  // FIX-E-07: người nộp không được tự duyệt/hủy hiệu lực đơn của mình (403 SELF_APPROVAL_FORBIDDEN).
  // Thao tác duyệt dùng người duyệt riêng có quyền duyệt toàn tenant; cổng phạm vi tổ chức được giả lập.
  const approverId = randomUUID();
  const approver = { userId: approverId, permissions: ['hrm.manage'] };
  const ctx = (principal: { userId: string; permissions?: string[] } = { userId }) =>
    ({
      has: () => true,
      getRequestContext: async () => ({
        pool,
        tenantId,
        employeeId: userId,
        principal,
      }),
      getContext: async () => ({ pool, tenantId, principal }),
    }) as any;
  const approvals = testApprovalPolicy();

  const bridge = { startOrResume: jest.fn() };
  it('requires current leave-type versions and validates carryover limits', async () => {
    const c = new HrmLeaveController(ctx(), bridge as any);
    const type = (
      await c.createLeaveType(req, {
        code: 'TYPE-EDIT',
        name: 'Editable leave',
      } as any)
    ).data;
    await c.updateLeaveType(req, type.id, {
      name: 'Changed leave',
      expectedUpdatedAt: type.updatedAt,
      reason: 'Rename',
    } as any);
    await expect(
      c.updateLeaveType(req, type.id, {
        name: 'Stale name',
        expectedUpdatedAt: type.updatedAt,
        reason: 'Stale',
      } as any),
    ).rejects.toMatchObject({ status: 409 });
    const latest = (await c.listLeaveTypes(req)).data.find(
      (row) => row.id === type.id,
    )!;
    await expect(
      c.updateLeaveType(req, type.id, {
        carryoverExpiryMonth: 13,
        expectedUpdatedAt: latest.updatedAt,
        reason: 'Invalid expiry',
      } as any),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('edits unused accrual rules and versions used rules without crediting a closed month twice', async () => {
    const c = new HrmLeaveController(ctx(), bridge as any);
    const type = (
      await c.createLeaveType(req, {
        code: 'VERSIONED-LEAVE',
        name: 'Versioned leave',
      } as any)
    ).data;
    const initial = {
      accrualFrequency: 'MONTHLY',
      accrualAmount: 1,
      prorationRule: 'NONE',
      seniorityBonusYears: 0,
      seniorityBonusDays: 0,
      effectiveFrom: '2026-01-01',
    } as const;
    const schedule = (await c.createAccrualSchedule(req, type.id, initial))
      .data;
    const edited = (
      await (c as any).updateAccrualSchedule(req, type.id, schedule.id, {
        ...initial,
        accrualAmount: 1.5,
        expectedUpdatedAt: schedule.updatedAt,
        reason: 'New amount',
      })
    ).data;
    expect(edited.effectiveFrom).toBe('2026-01-01');
    expect(edited.seniorityBonusYears).toBe(0);
    await c.runAccrual(req, '2026-07');
    await expect(
      (c as any).updateAccrualSchedule(req, type.id, schedule.id, {
        ...initial,
        expectedUpdatedAt: edited.updatedAt,
        reason: 'Rewrite history',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const version = (
      await (c as any).versionAccrualSchedule(req, type.id, schedule.id, {
        ...initial,
        accrualAmount: 2,
        effectiveFrom: '2026-08-01',
        expectedUpdatedAt: edited.updatedAt,
        reason: 'New policy',
      })
    ).data;
    await c.runAccrual(req, '2026-07');
    await c.runAccrual(req, '2026-08');
    await c.runAccrual(req, '2026-08');
    const transactions = await pool.query(
      'SELECT days_changed FROM hrm_schema.leave_transactions WHERE tenant_id=$1 AND leave_type_id=$2',
      [tenantId, type.id],
    );
    expect(transactions.rows.map((r) => Number(r.days_changed)).sort()).toEqual(
      [1.5, 2],
    );
    await expect(
      (c as any).deactivateAccrualSchedule(req, type.id, version.id, {
        effectiveTo: '2026-07-31',
        expectedUpdatedAt: version.updatedAt,
        reason: 'Before accrued month',
      }),
    ).rejects.toThrow();
    const ended = (
      await (c as any).deactivateAccrualSchedule(req, type.id, version.id, {
        effectiveTo: '2026-08-31',
        expectedUpdatedAt: version.updatedAt,
        reason: 'End after accrued month',
      })
    ).data;
    expect(ended.effectiveTo).toBe('2026-08-31');
    await expect(
      (c as any).deleteAccrualSchedule(req, type.id, version.id, {
        expectedUpdatedAt: version.updatedAt,
        reason: 'Delete used',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const unused = (
      await c.createAccrualSchedule(req, type.id, {
        ...initial,
        effectiveFrom: '2027-01-01',
      })
    ).data;
    await (c as any).deleteAccrualSchedule(req, type.id, unused.id, {
      expectedUpdatedAt: unused.updatedAt,
      reason: 'Remove unused',
    });
    expect(
      (await c.listAccrualSchedules(req, type.id)).data.some(
        (row) => row.id === unused.id,
      ),
    ).toBe(false);
    const balances = await c.listAllLeaveBalances(req, '2026', userId);
    expect(
      balances.data.some(
        (row) => row.leaveTypeId === type.id && row.accrued === 3.5,
      ),
    ).toBe(true);
  });
  it('rejects stale submission and foreign-tenant edits without creating business effects', async () => {
    const ops = new HrmOperationsController(ctx(), bridge as any);
    const salary = new HrmSalaryController(ctx(), bridge as any);
    const first = (
      await ops.createDraft(req, 'advance', {
        employeeId: userId,
        payload: { requestedAmount: 100, reason: 'Version one' },
      })
    ).data;
    const edited = (
      await ops.updateDraft(req, 'advance', String(first.id), {
        expectedUpdatedAt: first.updatedAt,
        payload: { requestedAmount: -1, reason: 'Invalid amount' },
      })
    ).data;
    await expect(
      salary.createAdvanceRequest(req, {
        employeeId: userId,
        draftId: first.id,
        expectedUpdatedAt: first.updatedAt,
      } as any),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      salary.createAdvanceRequest(req, {
        employeeId: userId,
        draftId: first.id,
        expectedUpdatedAt: edited.updatedAt,
      } as any),
    ).rejects.toMatchObject({ status: 400 });
    const foreign = new HrmOperationsController(
      {
        ...ctx(),
        getContext: async () => ({
          pool,
          tenantId: randomUUID(),
          principal: { userId },
        }),
      } as any,
      bridge as any,
    );
    await expect(
      foreign.deleteDraft(req, 'advance', String(first.id), {
        expectedUpdatedAt: edited.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await pool.query(
          'SELECT status FROM hrm_schema.request_drafts WHERE id=$1',
          [first.id],
        )
      ).rows[0].status,
    ).toBe('DRAFT');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM hrm_schema.salary_advance_requests',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('saves, versions and deletes drafts without reserving leave or starting Procedure', async () => {
    const ops = new HrmOperationsController(ctx(), bridge as any);
    const first = (
      await (ops as any).createDraft(req, 'advance', {
        employeeId: userId,
        payload: { reason: 'Initial' },
      })
    ).data;
    expect(first.status).toBe('DRAFT');
    const edited = (
      await (ops as any).updateDraft(req, 'advance', first.id, {
        expectedUpdatedAt: first.updatedAt,
        payload: { reason: 'Updated', requestedAmount: 750000 },
      })
    ).data;
    expect(edited.payload.reason).toBe('Updated');
    await expect(
      (ops as any).updateDraft(req, 'advance', first.id, {
        expectedUpdatedAt: first.updatedAt,
        payload: { reason: 'Stale' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM hrm_schema.salary_advance_requests',
        )
      ).rows[0].n,
    ).toBe(0);
    expect(bridge.startOrResume).not.toHaveBeenCalled();
    await (ops as any).deleteDraft(req, 'advance', first.id, {
      expectedUpdatedAt: edited.updatedAt,
    });
    await expect(
      (ops as any).updateDraft(req, 'advance', first.id, {
        expectedUpdatedAt: edited.updatedAt,
        payload: { reason: 'Deleted' },
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('submits a saved draft once and uses saved values instead of caller overrides', async () => {
    const ops = new HrmOperationsController(ctx(), bridge as any);
    const salary = new HrmSalaryController(ctx(), bridge as any);
    const draft = (
      await (ops as any).createDraft(req, 'advance', {
        employeeId: userId,
        payload: {
          requestedAmount: 750000,
          numberOfInstallments: 1,
          reason: 'Mock advance',
          requestDate: '2026-09-28',
        },
      })
    ).data;
    const submit = {
      employeeId: userId,
      draftId: draft.id,
      expectedUpdatedAt: draft.updatedAt,
      requestedAmount: 99999999,
    } as any;
    const [a, b] = await Promise.all([
      salary.createAdvanceRequest(req, submit),
      salary.createAdvanceRequest(req, submit),
    ]);
    expect(a.data.id).toBe(b.data.id);
    expect(Number(a.data.requestedAmount)).toBe(750000);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM hrm_schema.salary_advance_requests',
        )
      ).rows[0].n,
    ).toBe(1);
    await expect(
      (ops as any).deleteDraft(req, 'advance', draft.id, {
        expectedUpdatedAt: draft.updatedAt,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('reverses an approved advance once without changing its completed Procedure link', async () => {
    const salary = new HrmSalaryController(ctx(), bridge as any);
    const operations = new HrmOperationsController(
      ctx(approver),
      bridge as any,
      approvals,
    );
    const created = (
      await salary.createAdvanceRequest(req, {
        employeeId: userId,
        requestedAmount: 123456,
        requestDate: '2026-08-15',
        numberOfInstallments: 1,
        reason: 'Reversal test',
      } as any)
    ).data;
    expect(created.requestDate).toBe('2026-08-15');
    await pool.query(
      "UPDATE hrm_schema.salary_advance_requests SET status='APPROVED',approved_amount=requested_amount WHERE tenant_id=$1 AND id=$2",
      [tenantId, created.id],
    );
    const before = (
      await pool.query(
        'SELECT * FROM hrm_schema.salary_advance_requests WHERE id=$1',
        [created.id],
      )
    ).rows[0];
    const link = (
      await pool.query(
        `INSERT INTO hrm_schema.procedure_links(tenant_id,employee_id,request_kind,request_id,revision,definition_id,initiated_by,title,source_id,start_idempotency_key,sync_status,result_event,applied_at) VALUES($1,$2,'advance',$3,1,$4,$2,'Mock approved advance',$3,$3::uuid::text,'APPLIED','{"status":"APPROVED"}',now()) RETURNING id`,
        [tenantId, userId, created.id, randomUUID()],
      )
    ).rows[0];
    const payload = {
      expectedUpdatedAt: before.updated_at.toISOString(),
      reason: 'Mock approval no longer needed',
    };
    const results = await Promise.all(
      [1, 2].map(() =>
        (operations as any).reverseRequest(req, 'advance', created.id, payload),
      ),
    );
    expect(results[0].data.id).toBe(results[1].data.id);
    expect(
      (
        await pool.query(
          'SELECT status FROM hrm_schema.salary_advance_requests WHERE id=$1',
          [created.id],
        )
      ).rows[0].status,
    ).toBe('CANCELLED');
    expect(
      (
        await pool.query(
          'SELECT sync_status,result_event FROM hrm_schema.procedure_links WHERE id=$1',
          [link.id],
        )
      ).rows[0],
    ).toEqual({ sync_status: 'APPLIED', result_event: { status: 'APPROVED' } });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM hrm_schema.request_reversals WHERE request_id=$1',
          [created.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('reverses approved leave with one compensating entry and enforces stale, tenant and period guards', async () => {
    const type = (
      await pool.query(
        "INSERT INTO hrm_schema.leave_types(tenant_id,code,name) VALUES($1,'REVERSE','Reversal leave') RETURNING id",
        [tenantId],
      )
    ).rows[0];
    const leave = (
      await pool.query(
        `INSERT INTO hrm_schema.leave_requests(tenant_id,employee_id,leave_type_id,from_date,to_date,duration,reason,status,balance_reserved) VALUES($1,$2,$3,'2026-08-18','2026-08-18',1,'Approved mock','APPROVED',true) RETURNING *`,
        [tenantId, userId, type.id],
      )
    ).rows[0];
    await pool.query(
      'INSERT INTO hrm_schema.leave_balances(tenant_id,employee_id,leave_type_id,year,opening_balance,used,remaining) VALUES($1,$2,$3,2026,5,1,4)',
      [tenantId, userId, type.id],
    );
    const op = new HrmOperationsController(
      ctx(approver),
      bridge as any,
      approvals,
    );
    const payload = {
      expectedUpdatedAt: leave.updated_at.toISOString(),
      reason: 'Reverse approved mock',
    };
    await expect(
      op.reverseRequest(req, 'leave', leave.id, {
        ...payload,
        expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const foreign = new HrmOperationsController(
      {
        ...ctx(),
        getContext: async () => ({
          pool,
          tenantId: randomUUID(),
          principal: { userId },
        }),
      } as any,
      bridge as any,
    );
    await expect(
      foreign.reverseRequest(req, 'leave', leave.id, payload),
    ).rejects.toMatchObject({ status: 404 });
    const locked = (
      await pool.query(
        "INSERT INTO hrm_schema.timesheet_periods(tenant_id,period_code,from_date,to_date,status) VALUES($1,'REVERSE-LOCK','2026-08-18','2026-08-18','LOCKED') RETURNING id",
        [tenantId],
      )
    ).rows[0];
    await expect(
      op.reverseRequest(req, 'leave', leave.id, payload),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await pool.query(
          'SELECT remaining FROM hrm_schema.leave_balances WHERE leave_type_id=$1',
          [type.id],
        )
      ).rows[0].remaining,
    ).toBe('4.00');
    await pool.query(
      "UPDATE hrm_schema.timesheet_periods SET status='OPEN' WHERE id=$1",
      [locked.id],
    );
    await Promise.all(
      [1, 2].map(() => op.reverseRequest(req, 'leave', leave.id, payload)),
    );
    expect(
      (
        await pool.query(
          'SELECT used,remaining FROM hrm_schema.leave_balances WHERE leave_type_id=$1',
          [type.id],
        )
      ).rows[0],
    ).toEqual({ used: '0.00', remaining: '5.00' });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM hrm_schema.leave_transactions WHERE reference_request_id=$1 AND transaction_type='REVERSAL'",
          [leave.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('invalidates timesheets when reversing OT/trips and blocks closed payroll or settled advances', async () => {
    const op = new HrmOperationsController(
      ctx(approver),
      bridge as any,
      approvals,
    );
    const ot = (
      await pool.query(
        `INSERT INTO hrm_schema.ot_requests(tenant_id,employee_id,work_date,start_time,end_time,planned_minutes,approved_minutes,reason,status) VALUES($1,$2,'2026-08-20','18:00','19:00',60,60,'Mock OT','APPROVED') RETURNING *`,
        [tenantId, userId],
      )
    ).rows[0];
    const trip = (
      await pool.query(
        `INSERT INTO hrm_schema.business_trip_requests(tenant_id,employee_id,destination,from_date,to_date,days_count,reason,status) VALUES($1,$2,'Mock site','2026-08-21','2026-08-21',1,'Mock trip','APPROVED') RETURNING *`,
        [tenantId, userId],
      )
    ).rows[0];
    const period = (
      await pool.query(
        "INSERT INTO hrm_schema.timesheet_periods(tenant_id,period_code,from_date,to_date,calculated_at) VALUES($1,'REVERSE-OPEN','2026-08-20','2026-08-21',now()) RETURNING id",
        [tenantId],
      )
    ).rows[0];
    const payroll = (
      await pool.query(
        "INSERT INTO hrm_schema.payroll_periods(tenant_id,period_code,from_date,to_date,payment_date,status) VALUES($1,'REVERSE-PAY','2026-08-20','2026-08-21','2026-08-31','LOCKED') RETURNING id",
        [tenantId],
      )
    ).rows[0];
    await expect(
      op.reverseRequest(req, 'ot', ot.id, {
        expectedUpdatedAt: ot.updated_at.toISOString(),
        reason: 'Mock reversal',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query(
      "UPDATE hrm_schema.payroll_periods SET status='OPEN' WHERE id=$1",
      [payroll.id],
    );
    for (const [kind, row] of [
      ['ot', ot],
      ['business_trip', trip],
    ] as const)
      await op.reverseRequest(req, kind, row.id, {
        expectedUpdatedAt: row.updated_at.toISOString(),
        reason: 'Mock reversal',
      });
    expect(
      (
        await pool.query(
          'SELECT calculated_at FROM hrm_schema.timesheet_periods WHERE id=$1',
          [period.id],
        )
      ).rows[0].calculated_at,
    ).toBeNull();
    const advance = (
      await pool.query(
        `INSERT INTO hrm_schema.salary_advance_requests(tenant_id,employee_id,request_date,requested_amount,approved_amount,disbursed_amount,reason,status) VALUES($1,$2,'2026-08-22',500,500,500,'Mock settled advance','APPROVED') RETURNING *`,
        [tenantId, userId],
      )
    ).rows[0];
    await expect(
      op.reverseRequest(req, 'advance', advance.id, {
        expectedUpdatedAt: advance.updated_at.toISOString(),
        reason: 'Cannot reverse funds',
      }),
    ).rejects.toMatchObject({ status: 409 });
    const denied = new HrmOperationsController(
      {
        ...ctx(),
        getContext: async (_req: Request, action: string) => {
          expect(action).toBe('hrm.ot.approve');
          throw { status: 403 };
        },
      } as any,
      bridge as any,
    );
    await expect(
      denied.reverseRequest(req, 'ot', ot.id, {
        expectedUpdatedAt: ot.updated_at.toISOString(),
        reason: 'No right',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('restores original raw attendance on reversal and refuses to overwrite a later correction', async () => {
    const op = new HrmOperationsController(
      ctx(approver),
      bridge as any,
      approvals,
    );
    const original = (
      await pool.query(
        `INSERT INTO hrm_schema.attendance_events(tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence,created_by) VALUES($1,$2,'2026-08-24','IN','2026-08-24T02:00:00Z','BIOMETRIC','reverse-raw','{}',$2) RETURNING id`,
        [tenantId, userId],
      )
    ).rows[0];
    const correction = (
      await pool.query(
        `INSERT INTO hrm_schema.attendance_corrections(tenant_id,employee_id,request_date,reason,submitted_by,corrected_sessions) VALUES($1,$2,'2026-08-24','Mock correction',$2,'[{"start":"2026-08-24T01:00:00Z","end":"2026-08-24T10:00:00Z"}]') RETURNING *`,
        [tenantId, userId],
      )
    ).rows[0];
    await hrmTransaction(pool, (db) =>
      approveAttendanceCorrection(db, tenantId, userId, correction.id),
    );
    const approved = (
      await pool.query(
        'SELECT * FROM hrm_schema.attendance_corrections WHERE id=$1',
        [correction.id],
      )
    ).rows[0];
    const payload = {
      expectedUpdatedAt: approved.updated_at.toISOString(),
      reason: 'Mock revert',
    };
    const later = (
      await pool.query(
        `INSERT INTO hrm_schema.attendance_events(tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence,created_by) VALUES($1,$2,'2026-08-24','OUT','2026-08-24T11:00:00Z','BIOMETRIC','reverse-later','{}',$2) RETURNING id`,
        [tenantId, userId],
      )
    ).rows[0];
    await expect(
      op.reverseRequest(req, 'correction', correction.id, payload),
    ).rejects.toMatchObject({ status: 409 });
    await pool.query('DELETE FROM hrm_schema.attendance_events WHERE id=$1', [
      later.id,
    ]);
    await op.reverseRequest(req, 'correction', correction.id, payload);
    expect(
      (
        await pool.query(
          "SELECT id FROM hrm_schema.attendance_events WHERE employee_id=$1 AND work_date='2026-08-24' AND voided_by_correction_id IS NULL",
          [userId],
        )
      ).rows.map((r) => r.id),
    ).toEqual([original.id]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM hrm_schema.attendance_events WHERE employee_id=$1 AND work_date='2026-08-24'",
          [userId],
        )
      ).rows[0].n,
    ).toBe(3);
  });
  it('returns a business error instead of 500 for legacy correction actions linked to Procedure', async () => {
    const c = new HrmAttendanceController(ctx(), bridge as any);
    const row = (
      await pool.query(
        `INSERT INTO hrm_schema.attendance_corrections(tenant_id,employee_id,request_date,reason,submitted_by) VALUES($1,$2,'2026-08-25','Linked correction',$2) RETURNING id`,
        [tenantId, userId],
      )
    ).rows[0];
    await pool.query(
      `INSERT INTO hrm_schema.procedure_links(tenant_id,employee_id,request_kind,request_id,initiated_by,title,source_id,start_idempotency_key) VALUES($1,$2,'correction',$3,$2,'Mock linked correction',$3,$3::uuid::text)`,
      [tenantId, userId, row.id],
    );
    // Đơn đã có liên kết Procedure: trả 409 PROCEDURE_IN_PROGRESS thân thiện (không còn lỗi trigger 400).
    const reviewer = new HrmAttendanceController(
      ctx(approver),
      bridge as any,
      approvals,
    );
    await expect(
      reviewer.rejectCorrection(req, row.id, 'Mock reject'),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROCEDURE_IN_PROGRESS' },
    });
    await expect(c.cancelCorrection(req, row.id)).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROCEDURE_IN_PROGRESS' },
    });
    // Người nộp tự duyệt đơn của mình bị chặn trước cả bước kiểm tra liên kết.
    await expect(
      c.rejectCorrection(req, row.id, 'Tự từ chối'),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SELF_APPROVAL_FORBIDDEN' },
    });
    expect(
      (
        await pool.query(
          'SELECT status FROM hrm_schema.attendance_corrections WHERE id=$1',
          [row.id],
        )
      ).rows[0].status,
    ).toBe('PENDING');
  });
  it('reverses a manual leave adjustment once while retaining the original transaction', async () => {
    const c = new HrmLeaveController(ctx(), bridge as any);
    const type = (
      await c.createLeaveType(req, {
        code: 'ADJUST-REVERSE',
        name: 'Mock balance',
      } as any)
    ).data;
    const tx = (
      await c.adjustLeaveBalance(req, {
        employeeId: userId,
        leaveTypeId: type.id,
        year: 2026,
        daysAdjusted: 3,
        reason: 'Mock credit',
        operationId: randomUUID(),
      })
    ).data;
    const values = await Promise.all(
      [1, 2].map(() =>
        (c as any).reverseLeaveAdjustment(req, tx.id, {
          reason: 'Mistaken manual credit',
        }),
      ),
    );
    expect(values[0].data.id).toBe(values[1].data.id);
    expect(
      (
        await pool.query(
          'SELECT remaining,adjusted FROM hrm_schema.leave_balances WHERE leave_type_id=$1',
          [type.id],
        )
      ).rows[0],
    ).toEqual({ remaining: '0.00', adjusted: '0.00' });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM hrm_schema.leave_transactions WHERE leave_type_id=$1',
          [type.id],
        )
      ).rows[0].n,
    ).toBe(2);
    await expect(
      (c as any).reverseLeaveAdjustment(req, values[0].data.id, {
        reason: 'Cannot reverse reversal',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('returns every proposed correction session to the reviewer', async () => {
    const c = new HrmAttendanceController(ctx(), bridge as any);
    const sessions = [
      { start: '2026-08-26T01:00:00Z', end: '2026-08-26T05:00:00Z' },
      { start: '2026-08-26T06:00:00Z', end: '2026-08-26T10:00:00Z' },
    ];
    const created = await c.createCorrection(req, {
      employeeId: userId,
      requestDate: '2026-08-26',
      sessions,
      reason: 'Two-session correction',
    });
    expect((created.data as any).correctedSessions).toEqual(sessions);
  });
  it('re-submits amendments through the configured binding and rolls back cancellation if the binding is missing', async () => {
    const c = new HrmLeaveController(ctx(), bridge as any);
    const type = (
      await c.createLeaveType(req, {
        code: 'AMEND',
        name: 'Mock amendment',
        deductBalance: false,
      } as any)
    ).data;
    const shift = (
      await pool.query(
        "INSERT INTO hrm_schema.shift_definitions(tenant_id,code,name,start_time,end_time) VALUES($1,'AMEND','Mock shift','08:00','17:00') RETURNING id",
        [tenantId],
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO hrm_schema.shift_assignments(tenant_id,employee_id,shift_id,effective_from,effective_to) VALUES($1,$2,$3,'2026-08-27','2026-08-28')",
      [tenantId, userId, shift.id],
    );
    const original = (
      await c.createLeaveRequest(req, {
        employeeId: userId,
        leaveTypeId: type.id,
        fromDate: '2026-08-27',
        toDate: '2026-08-27',
        duration: 1,
        reason: 'Mock original',
      })
    ).data;
    const body = {
      fromDate: '2026-08-28',
      toDate: '2026-08-28',
      duration: 1,
      reason: 'Mock amendment',
      expectedUpdatedAt: original.updatedAt,
    };
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,mode,configuration_status,is_active)
       VALUES($1,'leave','DIRECT','CONFLICT',true)`,
      [tenantId],
    );
    try {
      await expect(
        c.amendLeaveRequest(req, original.id, body),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (
          await pool.query(
            'SELECT status FROM hrm_schema.leave_requests WHERE id=$1',
            [original.id],
          )
        ).rows[0].status,
      ).toBe('PENDING');
    } finally {
      await pool.query(
        "DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind='leave' AND configuration_status='CONFLICT'",
        [tenantId],
      );
    }
    const replacement = await c.amendLeaveRequest(req, original.id, body);
    expect(replacement.data.fromDate).toBe('2026-08-28');
    expect(replacement.data.status).toBe('PENDING');
    await expect(
      c.approveLeaveRequest(req, replacement.data.id),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: 'SELF_APPROVAL_FORBIDDEN' },
    });
    await new HrmLeaveController(
      ctx(approver),
      bridge as any,
      approvals,
    ).approveLeaveRequest(req, replacement.data.id);
    await expect(
      c.cancelLeaveRequest(req, replacement.data.id),
    ).rejects.toMatchObject({ status: 409 });
    const trip = (
      await pool.query(
        `INSERT INTO hrm_schema.business_trip_requests(tenant_id,employee_id,destination,from_date,to_date,days_count,reason,status) VALUES($1,$2,'Legacy path','2026-08-29','2026-08-29',1,'Mock approved','APPROVED') RETURNING id`,
        [tenantId, userId],
      )
    ).rows[0];
    await expect(
      new HrmRequestController(ctx(), bridge as any).cancelBusinessTrip(
        req,
        trip.id,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});
