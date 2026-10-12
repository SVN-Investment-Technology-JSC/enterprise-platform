import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Request } from 'express';
import { processHrmProcedureSync } from '../infrastructure/hrm-procedure-sync';
import type { HrmContextService } from '../infrastructure/hrm-context.service';
import {
  createProcedureApiFake,
  testApprovalPolicy,
} from '../infrastructure/hrm-test-support';
import { HrmOperationsController } from './hrm-operations.controller';

jest.mock('../infrastructure/hrm-context.service.js', () => ({
  HrmContextService: class {},
}));

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;

integration('HRM operations and workflow recovery', () => {
  const databaseName = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const employeeId = randomUUID();
  const otherEmployeeId = randomUUID();
  const operatorId = randomUUID();
  // Procedure là module khác: test không ghi vào schema của nó mà giả lập API nội bộ qua fetch.
  const definitionId = randomUUID();
  const procedureApi = createProcedureApiFake();
  const req = { headers: {} } as Request;
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
      throw new Error('Only local disposable PostgreSQL is allowed');
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
      'hrm/0002-hrm-procedure-integration.sql',
      'hrm/0003-hrm-requests-enhancement.sql',
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
      'hrm/0014-hrm-profile-compatibility.sql',
      'hrm/0013-payroll-support.sql',
      'hrm/0015-hrm-procedure-sync.sql',
      'hrm/0015-procedure-definition-snapshot.sql',
      'hrm/0015-shift-submission.sql',
      'hrm/0029-hrm-procedure-step-progress.sql',
      'hrm/0033-leave-annual-policy.sql',
      'hrm/0034-hrm-request-project-links.sql',
      'hrm/0035-hrm-request-trip-links.sql',
      'hrm/0036-hrm-project-request-reversed.sql',
    ])
      await migrate(path);
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,full_name)
      VALUES($1,$3,'Nhân viên A'),($2,$3,'Nhân viên B')`,
      [employeeId, otherEmployeeId, tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date)
      VALUES($1,$3,'OPS-A','2026-01-01'),($2,$3,'OPS-B','2026-01-01')`,
      [employeeId, otherEmployeeId, tenantId],
    );
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

  const context = (
    permissions: string[],
    currentEmployeeId = employeeId,
  ): HrmContextService =>
    ({
      has: (_context: unknown, action: string) => permissions.includes(action),
      getContext: async (_request: Request, action: string) => {
        if (action !== 'hrm.read' && !permissions.includes(action))
          throw new ForbiddenException('Không có quyền');
        return { pool, tenantId, principal: { userId: operatorId } };
      },
      resolveEmployee: async () => ({ employeeId: currentEmployeeId }),
      procedureAvailable: async () => true,
    }) as unknown as HrmContextService;

  const controller = (permissions: string[]) =>
    new HrmOperationsController(
      context(permissions),
      {} as never,
      testApprovalPolicy(),
    );

  async function insertLink(input: {
    employee?: string;
    requestId?: string;
    status?: string;
    instanceId?: string | null;
    lastError?: string;
    attempts?: number;
    legacyLinkId?: string | null;
  }) {
    const id = randomUUID();
    const requestId = input.requestId ?? randomUUID();
    await pool.query(
      `INSERT INTO hrm_schema.procedure_links
      (id,tenant_id,request_kind,request_id,employee_id,initiated_by,title,definition_id,definition_version_id,
       source_id,start_idempotency_key,instance_id,sync_status,attempts,last_error,attempted_at,legacy_link_id)
      VALUES($1,$2,'business_trip',$3,$4,$5,'Kiểm thử vận hành',$6,$7,$1,$13,$8,$9,$10,$11,now(),$12)`,
      [
        id,
        tenantId,
        requestId,
        input.employee ?? employeeId,
        operatorId,
        definitionId,
        null, // PE không lộ version id qua API; cột definition_version_id để NULL
        input.instanceId ?? null,
        input.status ?? 'FAILED',
        input.attempts ?? 2,
        input.lastError ?? 'Mất kết nối Procedure',
        input.legacyLinkId ?? null,
        id,
      ],
    );
    return { id, requestId };
  }

  it('exposes canonical error metadata and all conflict correlations', async () => {
    const link = await insertLink({
      status: 'CONFLICT',
      legacyLinkId: randomUUID(),
      lastError: 'Một đơn có nhiều instance',
    });
    const first = randomUUID();
    const second = randomUUID();
    await pool.query(
      `INSERT INTO hrm_schema.procedure_correlations(tenant_id,link_id,instance_id,source_type,source_id)
      VALUES($1,$2,$3,'manual',$5),($1,$2,$4,'hrm_request',$2)`,
      [tenantId, link.id, first, second, link.requestId],
    );
    const result = await controller(['hrm.integration.manage']).get(req);
    const row = result.data.workflows.find((item) => item.id === link.id);
    expect(row).toMatchObject({
      status: 'CONFLICT',
      attempts: 2,
      last_error: 'Một đơn có nhiều instance',
    });
    expect(row.related_instances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: first }),
        expect.objectContaining({ instanceId: second }),
      ]),
    );
  });

  it('queues only one concurrent retry and keeps the root cause for operators', async () => {
    const link = await insertLink({
      status: 'FAILED',
      instanceId: null,
      lastError: 'Timeout sau khi gửi yêu cầu',
      attempts: 3,
    });
    const operations = controller(['hrm.integration.manage']);
    const outcomes = await Promise.allSettled([
      operations.retry(req, link.id),
      operations.retry(req, link.id),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(
      1,
    );
    const stored = (
      await pool.query(
        'SELECT sync_status,attempts,last_error FROM hrm_schema.procedure_links WHERE id=$1',
        [link.id],
      )
    ).rows[0];
    expect(stored).toEqual({
      sync_status: 'START_PENDING',
      attempts: 3,
      last_error: 'Timeout sau khi gửi yêu cầu',
    });
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM hrm_schema.audit_log
          WHERE tenant_id=$1 AND entity_id=$2 AND action='PROCEDURE_RETRY_QUEUED'`,
          [tenantId, link.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('requires integration permission for retry and scopes employee progress', async () => {
    const own = await insertLink({ employee: employeeId });
    await insertLink({ employee: otherEmployeeId });
    await expect(controller([]).retry(req, own.id)).rejects.toMatchObject({
      status: 403,
    });
    const self = new HrmOperationsController(
      context(['hrm.self.read'], employeeId),
      {} as never,
      testApprovalPolicy(),
    );
    const rows = (await self.requestWorkflows(req)).data;
    expect(rows.some((row) => row.id === own.id)).toBe(true);
    expect(rows.every((row) => row.id !== own.id || row.attempts === 2)).toBe(
      true,
    );
    const otherIds = new Set(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND employee_id=$2',
          [tenantId, otherEmployeeId],
        )
      ).rows.map((row) => row.id),
    );
    expect(rows.every((row) => !otherIds.has(row.id))).toBe(true);
  });

  it('keeps notifications transactional, read-scoped, and audit filtering read-only', async () => {
    const rolledBackRequestId = randomUUID();
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        `INSERT INTO hrm_schema.business_trip_requests
        (id,tenant_id,employee_id,destination,from_date,to_date,days_count,reason,status)
        VALUES($1,$2,$3,'Huế','2026-09-29','2026-09-29',1,'Rollback notification','PENDING')`,
        [rolledBackRequestId, tenantId, employeeId],
      );
      await db.query('ROLLBACK');
    } finally {
      db.release();
    }
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM hrm_schema.notifications WHERE tenant_id=$1 AND request_id=$2',
          [tenantId, rolledBackRequestId],
        )
      ).rows[0].count,
    ).toBe(0);

    const foreignNotice = (
      await pool.query(
        `INSERT INTO hrm_schema.notifications(tenant_id,employee_id,request_kind,request_id,status)
        VALUES($1,$2,'BUSINESS_TRIP',$3,'PENDING') RETURNING id`,
        [tenantId, otherEmployeeId, randomUUID()],
      )
    ).rows[0];
    const self = new HrmOperationsController(
      context(['hrm.self.read'], employeeId),
      {} as never,
      testApprovalPolicy(),
    );
    await expect(
      self.readNotification(req, foreignNotice.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await pool.query(
          'SELECT read_at FROM hrm_schema.notifications WHERE id=$1',
          [foreignNotice.id],
        )
      ).rows[0].read_at,
    ).toBeNull();

    const entityId = randomUUID();
    await pool.query(
      `INSERT INTO hrm_schema.audit_log(tenant_id,actor_id,action,entity_type,entity_id,detail)
      VALUES($1,$2,'FILTER_ME','operation',$3,'{"reason":"root cause"}'),
            ($1,$2,'OTHER_ACTION','operation',$3,'{}')`,
      [tenantId, operatorId, entityId],
    );
    const audit = await controller(['hrm.audit.read']).get(
      req,
      'FILTER_ME',
      entityId,
    );
    expect(audit.data.audit).toHaveLength(1);
    expect(audit.data.audit[0]).toMatchObject({
      action: 'FILTER_ME',
      entity_id: entityId,
      detail: { reason: 'root cause' },
    });
  });

  it('reconciles a missed Procedure event through the same inbox exactly once', async () => {
    const request = (
      await pool.query(
        `INSERT INTO hrm_schema.business_trip_requests
        (tenant_id,employee_id,destination,from_date,to_date,days_count,reason,status)
        VALUES($1,$2,'Đà Nẵng','2026-09-29','2026-09-29',1,'Đối soát sự kiện','PENDING')
        RETURNING id`,
        [tenantId, employeeId],
      )
    ).rows[0];
    const instanceId = randomUUID();
    const link = await insertLink({
      requestId: request.id,
      status: 'RUNNING',
      instanceId,
      attempts: 1,
      lastError: '',
    });
    await pool.query(
      `INSERT INTO hrm_schema.procedure_correlations(tenant_id,link_id,instance_id,source_type,source_id)
      VALUES($1,$2,$3,'hrm_request',$2)`,
      [tenantId, link.id, instanceId],
    );
    // Procedure báo hồ sơ đã hoàn thành qua API nội bộ (đối soát), không qua sự kiện.
    const tokenBefore = process.env.INTERNAL_SERVICE_TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = 'local-test-token';
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(procedureApi.handler);
    procedureApi.setInstanceStatus({
      instanceId,
      instanceCode: 'OPS-001',
      status: 'completed',
      currentStepId: null,
      currentStepName: null,
      currentAssigneeName: null,
      completedAt: '2026-09-29T00:00:00Z',
      lastActorId: operatorId,
      sequence: 4,
    });
    try {
      await processHrmProcedureSync(pool, tenantId);
      await processHrmProcedureSync(pool, tenantId);
    } finally {
      fetchSpy.mockRestore();
      if (tokenBefore === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
      else process.env.INTERNAL_SERVICE_TOKEN = tokenBefore;
    }
    expect(
      (
        await pool.query(
          'SELECT status FROM hrm_schema.business_trip_requests WHERE id=$1',
          [request.id],
        )
      ).rows[0].status,
    ).toBe('APPROVED');
    expect(
      (
        await pool.query(
          'SELECT sync_status FROM hrm_schema.procedure_links WHERE id=$1',
          [link.id],
        )
      ).rows[0].sync_status,
    ).toBe('APPLIED');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM hrm_schema.procedure_result_inbox WHERE tenant_id=$1 AND link_id=$2',
          [tenantId, link.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM hrm_schema.audit_log
          WHERE tenant_id=$1 AND entity_id=$2 AND action='PROCEDURE_RESULT_APPLIED'`,
          [tenantId, request.id],
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM hrm_schema.notifications
          WHERE tenant_id=$1 AND request_id=$2 AND status='APPROVED'`,
          [tenantId, request.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });
});
