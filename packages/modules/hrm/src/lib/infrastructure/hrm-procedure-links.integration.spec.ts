import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { Pool } from 'pg';
import { hrmTransaction } from './hrm-transaction';
import { processHrmProcedureSync } from './hrm-procedure-sync';
import { HrmProcedureBridgeService } from './hrm-procedure-bridge.service';
import type { HrmContextService } from './hrm-context.service';
import type { Request } from 'express';
import { HrmSalaryController } from '../presentation/hrm-salary.controller';
import { HrmRequestController } from '../presentation/hrm-request.controller';
import { createProcedureApiFake } from './hrm-test-support';
jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
import {
  normalizeHrmRequestKind,
  prepareHrmProcedureLink,
  saveHrmProcedureBinding,
} from './hrm-procedure-links';

describe('legacy HRM request kind normalization', () => {
  it.each([
    ['LEAVE', 'leave'],
    ['OT', 'ot'],
    ['BUSINESS_TRIP', 'business_trip'],
    ['SHIFT_CHANGE', 'shift_change'],
    ['ATTENDANCE', 'correction'],
    ['ADVANCE', 'advance'],
    ['PROFILE', 'profile_correction'],
  ])('%s resolves to %s', (input, expected) => {
    expect(normalizeHrmRequestKind(input)).toBe(expected);
    expect(normalizeHrmRequestKind(expected)).toBe(expected);
  });
  it('rejects unknown kinds instead of selecting a fallback workflow', () => {
    expect(() => normalizeHrmRequestKind('random')).toThrow();
  });
});

const integration = process.env.HRM_TEST_ADMIN_URL ? describe : describe.skip;
integration('canonical HRM Procedure linkage', () => {
  const name = 'hrm_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID(),
    employeeId = randomUUID(),
    userId = randomUUID();
  // Procedure là module khác: HRM chỉ gọi qua API nội bộ, nên test dùng Procedure giả qua fetch
  // (DB kiểm thử không có schema của Procedure).
  const definitionId = randomUUID(),
    alternateId = randomUUID();
  const publishedDefinition = (id: string) => ({
    id,
    code: id,
    name: 'Duyệt đơn',
    kind: 'process',
    status: 'published',
    steps: [
      {
        id: 'step-s',
        key: 'S',
        name: 'Nộp đơn',
        order: 1,
        assignments: [{ role: 'S' }],
        attributes: [],
      },
      {
        id: 'step-a',
        key: 'A',
        name: 'Duyệt',
        order: 2,
        assignments: [{ role: 'A' }],
      },
    ],
  });
  const procedureApi = createProcedureApiFake({
    definitions: {
      [definitionId]: publishedDefinition(definitionId),
      [alternateId]: publishedDefinition(alternateId),
    },
  });
  let fetchSpy: jest.SpyInstance;
  const tokenBefore = process.env.INTERNAL_SERVICE_TOKEN;
  let pool: ReturnType<typeof createPostgresPool>,
    admin: ReturnType<typeof createPostgresPool>;
  const migrate = async (path: string) =>
    pool.query(
      await readFile(
        resolve(process.cwd(), '../../../migrations/tenant', path),
        'utf8',
      ),
    );
  const request = async (instanceId: string | null = null) =>
    (
      await pool.query(
        `INSERT INTO hrm_schema.business_trip_requests
    (tenant_id,employee_id,destination,from_date,to_date,days_count,reason,procedure_instance_id)
    VALUES ($1,$2,'Đà Nẵng','2026-09-28','2026-09-28',1,'Khảo sát dự án',$3) RETURNING id`,
        [tenantId, employeeId, instanceId],
      )
    ).rows[0].id as string;
  beforeAll(async () => {
    const url = new URL(process.env.HRM_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Local DB required');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = '/' + name;
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
      'hrm/0016-hrm-lifecycle.sql',
      'hrm/0017-hrm-request-drafts.sql',
      'hrm/0018-hrm-request-reversals.sql',
      'hrm/0019-timesheet-attachment-lifecycle.sql',
      'hrm/0020-payroll-lifecycle.sql',
      'hrm/0027-hrm-default-direct-bindings.sql',
      'hrm/0028-hrm-approval-policy.sql',
      'hrm/0029-hrm-procedure-step-progress.sql',
      'hrm/0030-hrm-procedure-field-mappings.sql',
      'hrm/0034-hrm-request-project-links.sql',
      'hrm/0035-hrm-request-trip-links.sql',
      'hrm/0036-hrm-project-request-reversed.sql',
    ])
      await migrate(path);
    process.env.INTERNAL_SERVICE_TOKEN = 'local-test-token';
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,full_name) VALUES($1,$2,'Lê Minh')`,
      [employeeId, tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date) VALUES($1,$2,'NV001','2026-01-01')`,
      [employeeId, tenantId],
    );
  }, 30000);
  beforeEach(() => {
    procedureApi.setAvailable(true);
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(procedureApi.handler);
  });
  afterEach(() => {
    fetchSpy?.mockRestore?.();
  });
  afterAll(async () => {
    if (tokenBefore === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = tokenBefore;
    await pool?.end();
    if (admin) {
      if (!/^hrm_test_[a-f0-9]{32}$/.test(name)) throw new Error('Invalid DB');
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  }, 30_000);
  it('preserves both legacy correlations, merges identical instances, and quarantines conflicting ones', async () => {
    const same = randomUUID(),
      first = randomUUID(),
      second = randomUUID();
    const sameRequest = await request(same),
      conflictRequest = await request(first);
    await pool.query(
      `INSERT INTO hrm_schema.workflow_rules(tenant_id,request_kind,definition_id,updated_by)
      VALUES($1,'LEAVE',$2,$3),($1,'OT',$2,$3)`,
      [tenantId, definitionId, userId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,procedure_definition_id)
      VALUES($1,'leave',$2)`,
      [tenantId, alternateId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.workflow_links(tenant_id,request_kind,request_id,definition_id,instance_id,status)
      VALUES($1,'BUSINESS_TRIP',$2,$3,$4,'RUNNING'),($1,'BUSINESS_TRIP',$5,$3,$6,'RUNNING')`,
      [tenantId, sameRequest, definitionId, same, conflictRequest, second],
    );
    const before = (
      await pool.query(
        `SELECT procedure_instance_id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 ORDER BY id`,
        [tenantId],
      )
    ).rows;
    await migrate('hrm/0015-hrm-procedure-sync.sql');
    await migrate('hrm/0015-hrm-procedure-sync.sql');
    await migrate('hrm/0015-procedure-definition-snapshot.sql');
    await migrate('hrm/0015-shift-submission.sql');
    const links = (
      await pool.query(
        'SELECT request_id,instance_id,sync_status FROM hrm_schema.procedure_links WHERE tenant_id=$1',
        [tenantId],
      )
    ).rows;
    expect(links.find((row) => row.request_id === sameRequest)).toMatchObject({
      instance_id: same,
      sync_status: 'RUNNING',
    });
    expect(
      links.find((row) => row.request_id === conflictRequest),
    ).toMatchObject({ instance_id: null, sync_status: 'CONFLICT' });
    const after = (
      await pool.query(
        `SELECT procedure_instance_id FROM hrm_schema.business_trip_requests WHERE tenant_id=$1 ORDER BY id`,
        [tenantId],
      )
    ).rows;
    expect(after).toEqual(before);
    const correlations = await pool.query(
      `SELECT DISTINCT instance_id FROM hrm_schema.procedure_correlations WHERE tenant_id=$1`,
      [tenantId],
    );
    expect(correlations.rows.map((row) => row.instance_id).sort()).toEqual(
      [same, first, second].sort(),
    );
    await expect(
      pool.query(
        `UPDATE hrm_schema.business_trip_requests SET status='APPROVED' WHERE id=$1`,
        [conflictRequest],
      ),
    ).rejects.toThrow('Procedure');
    const conflictingBindings = await pool.query(
      `SELECT configuration_status FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind='leave' AND is_active`,
      [tenantId],
    );
    expect(conflictingBindings.rows).toEqual([
      { configuration_status: 'CONFLICT' },
      { configuration_status: 'CONFLICT' },
    ]);
    const ot = (
      await pool.query(
        `INSERT INTO hrm_schema.ot_requests(tenant_id,employee_id,work_date,start_time,end_time,planned_minutes,reason)
      VALUES($1,$2,'2026-09-28','17:00','18:00',60,'Hỗ trợ triển khai') RETURNING id`,
        [tenantId, employeeId],
      )
    ).rows[0].id;
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.workflow_links WHERE request_id=$1',
          [ot],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.notifications WHERE request_id=$1',
          [ot],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT id FROM integration_schema.outbox_events WHERE aggregate_id=$1',
          [ot],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('defaults to DIRECT without a binding, snapshots subtype/definition/attributes via the Procedure API, and reuses a submitted revision', async () => {
    const id = await request();
    const input = {
      tenantId,
      kind: 'business_trip' as const,
      requestId: id,
      revision: 1,
      employeeId,
      initiatedBy: userId,
      title: 'Công tác',
      subTypeCode: 'OVERSEAS',
      attributes: { cost: 100 },
    };
    await pool.query(
      `DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind='business_trip'`,
      [tenantId],
    );
    const prepare = () =>
      hrmTransaction(pool as unknown as Pool, (db) =>
        prepareHrmProcedureLink(db, input),
      );
    // FIX-E-06: chưa cấu hình binding thì mặc định DIRECT (không còn lỗi 409), không tạo liên kết.
    await expect(prepare()).resolves.toBeNull();
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.procedure_links WHERE request_id=$1',
          [id],
        )
      ).rowCount,
    ).toBe(0);
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,procedure_definition_id,mode)
      VALUES($1,'business_trip',$2,'PROCEDURE')`,
      [tenantId, definitionId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,sub_type_code,procedure_definition_id,mode)
      VALUES($1,'business_trip','OVERSEAS',$2,'PROCEDURE')`,
      [tenantId, alternateId],
    );
    const link = await prepare();
    expect(link?.syncStatus).toBe('START_PENDING');
    const stored = (
      await pool.query(
        'SELECT definition_id,definition_version_id,definition_snapshot,attributes FROM hrm_schema.procedure_links WHERE id=$1',
        [link?.id],
      )
    ).rows[0];
    // Bản chụp lấy qua API nội bộ của Procedure; PE không lộ version id nên cột này để NULL.
    expect(stored).toMatchObject({
      definition_id: alternateId,
      definition_version_id: null,
      definition_snapshot: { id: alternateId },
      attributes: { cost: 100 },
    });
    expect(
      procedureApi.calls.some((call) =>
        call.path.endsWith('/v1/internal/definitions/' + alternateId),
      ),
    ).toBe(true);
    await pool.query(
      `UPDATE hrm_schema.request_procedure_bindings SET procedure_definition_id=$2 WHERE tenant_id=$1`,
      [tenantId, definitionId],
    );
    expect((await prepare())?.id).toBe(link?.id);
    expect(
      (
        await pool.query(
          'SELECT definition_id FROM hrm_schema.procedure_links WHERE id=$1',
          [link?.id],
        )
      ).rows[0].definition_id,
    ).toBe(alternateId);
    await expect(
      hrmTransaction(pool as unknown as Pool, (db) =>
        prepareHrmProcedureLink(db, { ...input, tenantId: randomUUID() }),
      ),
    ).rejects.toThrow();
  });
  it('rejects a PROCEDURE binding with 409 PROCEDURE_UNAVAILABLE when the Procedure API is off, without creating a link', async () => {
    const id = await request();
    procedureApi.setAvailable(false);
    await expect(
      hrmTransaction(pool as unknown as Pool, (db) =>
        prepareHrmProcedureLink(db, {
          tenantId,
          kind: 'business_trip',
          requestId: id,
          revision: 1,
          employeeId,
          initiatedBy: userId,
          title: 'Công tác',
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROCEDURE_UNAVAILABLE' },
    });
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.procedure_links WHERE request_id=$1',
          [id],
        )
      ).rowCount,
    ).toBe(0);
  });
  it('keeps direct mode explicit and blocks conflicting active defaults', async () => {
    const id = await request();
    const input = {
      tenantId,
      kind: 'business_trip' as const,
      requestId: id,
      revision: 1,
      employeeId,
      initiatedBy: userId,
      title: 'Công tác',
    };
    await pool.query(
      `DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind='business_trip'`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,mode) VALUES($1,'business_trip','DIRECT')`,
      [tenantId],
    );
    expect(
      await hrmTransaction(pool as unknown as Pool, (db) =>
        prepareHrmProcedureLink(db, input),
      ),
    ).toBeNull();
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,procedure_definition_id,mode)
      VALUES($1,'business_trip',$2,'PROCEDURE')`,
      [tenantId, definitionId],
    );
    await expect(
      hrmTransaction(pool as unknown as Pool, (db) =>
        prepareHrmProcedureLink(db, input),
      ),
    ).rejects.toThrow('xung đột');
  });
  it('serializes concurrent configuration writes and resolves duplicate defaults with an audit trail', async () => {
    await Promise.all(
      [1, 2].map(() =>
        hrmTransaction(pool as unknown as Pool, (db) =>
          saveHrmProcedureBinding(db, {
            tenantId,
            kind: 'BUSINESS_TRIP',
            mode: 'PROCEDURE',
            definitionId,
            actorId: userId,
          }),
        ),
      ),
    );
    const selected = await pool.query(
      `SELECT mode,procedure_definition_id,configuration_status FROM hrm_schema.request_procedure_bindings
      WHERE tenant_id=$1 AND request_kind='business_trip' AND sub_type_code IS NULL AND is_active`,
      [tenantId],
    );
    expect(selected.rows).toEqual([
      {
        mode: 'PROCEDURE',
        procedure_definition_id: definitionId,
        configuration_status: 'ACTIVE',
      },
    ]);
    expect(
      (
        await pool.query(
          `SELECT id FROM hrm_schema.audit_log WHERE tenant_id=$1 AND action='PROCEDURE_BINDING_CONFIGURED'`,
          [tenantId],
        )
      ).rowCount,
    ).toBe(2);
  });
  it('rolls back the request with 409 PROCEDURE_UNAVAILABLE when the PROCEDURE binding cannot reach Procedure', async () => {
    await pool.query(
      `DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind='advance'`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,procedure_definition_id,mode)
      VALUES($1,'advance',$2,'PROCEDURE')`,
      [tenantId, definitionId],
    );
    procedureApi.setAvailable(false);
    const ctx = {
      getRequestContext: async () => ({
        pool,
        tenantId,
        employeeId,
        principal: { userId },
      }),
    } as unknown as HrmContextService;
    const controller = new HrmSalaryController(
      ctx,
      new HrmProcedureBridgeService(ctx),
    );
    const before = (
      await pool.query(
        'SELECT id FROM hrm_schema.salary_advance_requests WHERE tenant_id=$1',
        [tenantId],
      )
    ).rowCount;
    await expect(
      controller.createAdvanceRequest({ headers: {} } as Request, {
        employeeId,
        requestedAmount: 1000000,
        numberOfInstallments: 1,
        requestDate: '2026-09-28',
        reason: 'Chi phí gia đình',
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROCEDURE_UNAVAILABLE' },
    });
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.salary_advance_requests WHERE tenant_id=$1',
          [tenantId],
        )
      ).rowCount,
    ).toBe(before);
  });
  it('waits for swap consent, defaults to DIRECT without a binding, routes to Procedure after binding, and retains the original sender and business facts', async () => {
    const peerId = randomUUID(),
      peerUser = randomUUID();
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,full_name) VALUES($1,$2,'Phạm Hồng')`,
      [peerId, tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date) VALUES($1,$2,'NV002','2026-01-01')`,
      [peerId, tenantId],
    );
    const shifts = (
      await pool.query(
        `INSERT INTO hrm_schema.shift_definitions(tenant_id,code,name,start_time,end_time) VALUES($1,'DAY','Ca ngày','08:00','16:00'),($1,'PM','Ca chiều','14:00','22:00') RETURNING id`,
        [tenantId],
      )
    ).rows;
    const ctx = {
      getRequestContext: async () => ({
        pool,
        tenantId,
        employeeId,
        principal: { userId },
      }),
      getContext: async () => ({
        pool,
        tenantId,
        principal: { userId: peerUser },
      }),
      resolveEmployee: async () => ({ employeeId: peerId }),
    } as unknown as HrmContextService;
    const bridge = new HrmProcedureBridgeService(ctx),
      controller = new HrmRequestController(ctx, bridge);
    const starter = jest
      .spyOn(bridge, 'startOrResume')
      .mockImplementation(async (_pool, id) => ({
        id,
        ref: {
          tenantId,
          kind: 'shift_change',
          requestId: 'unused',
          revision: 1,
        },
        instanceId: null,
        syncStatus: 'START_PENDING',
      }));
    // Chưa có binding đổi ca: mặc định DIRECT.
    await pool.query(
      `DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind='shift_change'`,
      [tenantId],
    );
    const body = {
      employeeId,
      changeType: 'SWAP' as const,
      currentShiftId: shifts[0].id,
      requestedShiftId: shifts[1].id,
      fromDate: '2026-10-01',
      toDate: '2026-10-01',
      swapWithEmployeeId: peerId,
      reason: 'Đổi lịch trực',
      attributes: { loai_doi_ca: 'CHANGE_SHIFT', custom: 'Ghi chú' },
    };
    const created = await controller.createShiftChangeRequest(
      { headers: {} } as Request,
      body,
    );
    expect(starter).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.procedure_links WHERE request_id=$1',
          [created.data.id],
        )
      ).rowCount,
    ).toBe(0);
    // DIRECT: đồng nghiệp xác nhận xong thì đơn chờ duyệt trực tiếp, không có liên kết Procedure.
    await controller.peerConfirmShiftChange(
      { headers: {} } as Request,
      created.data.id,
      true,
    );
    expect(starter).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT status,swap_peer_confirmed FROM hrm_schema.shift_change_requests WHERE id=$1',
          [created.data.id],
        )
      ).rows[0],
    ).toEqual({ status: 'PEER_CONFIRMED', swap_peer_confirmed: true });
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.procedure_links WHERE request_id=$1',
          [created.data.id],
        )
      ).rowCount,
    ).toBe(0);
    await hrmTransaction(pool as unknown as Pool, (db) =>
      saveHrmProcedureBinding(db, {
        tenantId,
        kind: 'shift_change',
        mode: 'PROCEDURE',
        definitionId,
        actorId: userId,
      }),
    );
    // Sau khi gắn PROCEDURE, đơn mới (qua API Procedure giả) mới có liên kết sau xác nhận.
    const routed = await controller.createShiftChangeRequest(
      { headers: {} } as Request,
      body,
    );
    await controller.peerConfirmShiftChange(
      { headers: {} } as Request,
      routed.data.id,
      true,
    );
    expect(starter).toHaveBeenCalledTimes(1);
    const link = (
      await pool.query(
        'SELECT initiated_by,attributes FROM hrm_schema.procedure_links WHERE request_id=$1',
        [routed.data.id],
      )
    ).rows[0];
    expect(link.initiated_by).toBe(userId);
    expect(link.attributes).toMatchObject({
      loai_doi_ca: 'SWAP',
      custom: 'Ghi chú',
    });
    const refused = await controller.createShiftChangeRequest(
      { headers: {} } as Request,
      body,
    );
    await controller.peerConfirmShiftChange(
      { headers: {} } as Request,
      refused.data.id,
      false,
    );
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.procedure_links WHERE request_id=$1',
          [refused.data.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(starter).toHaveBeenCalledTimes(1);
    starter.mockRestore();
  });
  it('retries a start timeout with the same key, delegates actions without changing HRM status, and applies the terminal result reported by the Procedure API', async () => {
    const id = await request();
    const link = await hrmTransaction(pool as unknown as Pool, (db) =>
      prepareHrmProcedureLink(db, {
        tenantId,
        kind: 'business_trip',
        requestId: id,
        revision: 1,
        employeeId,
        initiatedBy: userId,
        title: 'Công tác triển khai',
      }),
    );
    const ctx = {
      getContext: async () => ({ pool, tenantId, principal: { userId } }),
      getRequestContext: async () => ({
        pool,
        tenantId,
        employeeId,
        principal: { userId },
      }),
    };
    const bridge = new HrmProcedureBridgeService(
      ctx as unknown as HrmContextService,
    );
    // Procedure giả: mất phản hồi lần tạo đầu (đã commit phía PE), lần thử lại dùng cùng khóa.
    procedureApi.state.loseResponses = 1;
    try {
      expect(
        (
          await bridge.startOrResume(
            pool as unknown as Pool,
            link!.id,
            tenantId,
          )
        ).syncStatus,
      ).toBe('FAILED');
      const resumed = await bridge.startOrResume(
        pool as unknown as Pool,
        link!.id,
        tenantId,
      );
      expect(resumed.syncStatus).toBe('RUNNING');
      expect(procedureApi.instances.size).toBe(1);
      expect(
        procedureApi.startCalls().map((call) => call.body?.initiatedBy),
      ).toEqual([userId, userId]);
      const req = {
        headers: { authorization: 'Bearer user-session' },
      } as Request;
      await bridge.applyAction(req, link!.ref, {
        action: 'APPROVE',
        idempotencyKey: 'approve-first-step',
      });
      const actionCall = procedureApi.calls.at(-1)!;
      expect(actionCall.headers).toMatchObject({
        authorization: 'Bearer user-session',
      });
      expect(actionCall.headers).not.toHaveProperty('x-service-token');
      expect(
        (
          await pool.query(
            'SELECT status FROM hrm_schema.business_trip_requests WHERE id=$1',
            [id],
          )
        ).rows[0].status,
      ).toBe('PENDING');
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ message: 'Không được phân công' }), {
          status: 403,
        }),
      );
      await expect(
        bridge.applyAction(req, link!.ref, {
          action: 'APPROVE',
          idempotencyKey: 'forbidden',
        }),
      ).rejects.toThrow('Không được phân công');
      expect(
        (
          await pool.query(
            'SELECT status FROM hrm_schema.business_trip_requests WHERE id=$1',
            [id],
          )
        ).rows[0].status,
      ).toBe('PENDING');
      // Procedure báo hồ sơ đã hoàn thành (qua API nội bộ, không ghi vào schema của Procedure).
      fetchSpy.mockImplementation(procedureApi.handler);
      procedureApi.setInstanceStatus({
        instanceId: resumed.instanceId!,
        instanceCode: 'PRC-1',
        status: 'completed',
        currentStepId: null,
        currentStepName: null,
        currentAssigneeName: null,
        completedAt: '2026-09-28T02:00:00Z',
        lastActorId: userId,
        sequence: 5,
      });
      // Đối soát chỉ xét liên kết chưa đối soát trong 5 phút; ép đến hạn để mô phỏng mất sự kiện.
      await pool.query(
        'UPDATE hrm_schema.procedure_links SET step_reconciled_at=NULL WHERE id=$1',
        [link!.id],
      );
      const reader = await pool.connect();
      try {
        await reader.query('BEGIN READ ONLY');
        const progress = await bridge.getProcedureProgress(
          reader as unknown as Pool,
          tenantId,
          resumed.instanceId!,
        );
        expect(progress).toMatchObject({
          status: 'completed',
          syncStatus: 'RUNNING',
          hrmSynced: false,
        });
      } finally {
        await reader.query('ROLLBACK');
        reader.release();
      }
      expect(
        (
          await pool.query(
            'SELECT status FROM hrm_schema.business_trip_requests WHERE id=$1',
            [id],
          )
        ).rows[0].status,
      ).toBe('PENDING');
      await processHrmProcedureSync(pool as unknown as Pool, tenantId);
      expect(
        (
          await pool.query(
            'SELECT status FROM hrm_schema.business_trip_requests WHERE id=$1',
            [id],
          )
        ).rows[0].status,
      ).toBe('APPROVED');
      expect(
        (
          await pool.query(
            `SELECT detail FROM hrm_schema.audit_log WHERE entity_id=$1 AND action='PROCEDURE_RESULT_APPLIED'`,
            [id],
          )
        ).rows[0].detail.approverId,
      ).toBe(userId);
    } finally {
      procedureApi.state.loseResponses = 0;
    }
  });
});
