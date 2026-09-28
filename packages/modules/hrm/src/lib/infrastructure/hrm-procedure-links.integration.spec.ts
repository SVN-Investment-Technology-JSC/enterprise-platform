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
  const definitionId = randomUUID(),
    versionId = randomUUID(),
    alternateId = randomUUID(),
    alternateVersion = randomUUID();
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
      'procedure/0001-procedure.sql',
      'procedure/0002-normalized-model.sql',
    ])
      await migrate(path);
    await pool.query(
      `INSERT INTO core_schema.employees(id,tenant_id,full_name) VALUES($1,$2,'Lê Minh')`,
      [employeeId, tenantId],
    );
    await pool.query(
      `INSERT INTO hrm_schema.employee_profiles(employee_id,tenant_id,employee_code,join_date) VALUES($1,$2,'NV001','2026-01-01')`,
      [employeeId, tenantId],
    );
    for (const [id, version] of [
      [definitionId, versionId],
      [alternateId, alternateVersion],
    ]) {
      await pool.query(
        `INSERT INTO procedure_schema.definitions(id,code,name,kind,status,created_at,updated_at) VALUES($1::uuid,$1::text,'Duyệt đơn','process','published',now(),now())`,
        [id],
      );
      await pool.query(
        `INSERT INTO procedure_schema.versions(id,definition_id,version_number,status,snapshot,created_at) VALUES($1,$2,1,'published','{}',now())`,
        [version, id],
      );
      await pool.query(
        'UPDATE procedure_schema.definitions SET current_version_id=$2 WHERE id=$1',
        [id, version],
      );
    }
  }, 30000);
  afterAll(async () => {
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
  it('requires explicit binding, snapshots subtype/version/attributes, and reuses a submitted revision', async () => {
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
    await expect(prepare()).rejects.toThrow('cấu hình');
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
        'SELECT definition_id,definition_version_id,attributes FROM hrm_schema.procedure_links WHERE id=$1',
        [link?.id],
      )
    ).rows[0];
    expect(stored).toMatchObject({
      definition_id: alternateId,
      definition_version_id: alternateVersion,
      attributes: { cost: 100 },
    });
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
  it('rolls back the request when no approval mode has been configured', async () => {
    await pool.query(
      `DELETE FROM hrm_schema.request_procedure_bindings WHERE tenant_id=$1 AND request_kind='advance'`,
      [tenantId],
    );
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
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT id FROM hrm_schema.salary_advance_requests WHERE tenant_id=$1',
          [tenantId],
        )
      ).rowCount,
    ).toBe(before);
  });
  it('waits for swap consent, rolls back failed submission, and retains the original sender and business facts', async () => {
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
    await expect(
      controller.peerConfirmShiftChange(
        { headers: {} } as Request,
        created.data.id,
        true,
      ),
    ).rejects.toThrow();
    expect(
      (
        await pool.query(
          'SELECT status,swap_peer_confirmed FROM hrm_schema.shift_change_requests WHERE id=$1',
          [created.data.id],
        )
      ).rows[0],
    ).toEqual({ status: 'PENDING', swap_peer_confirmed: false });
    await hrmTransaction(pool as unknown as Pool, (db) =>
      saveHrmProcedureBinding(db, {
        tenantId,
        kind: 'shift_change',
        mode: 'PROCEDURE',
        definitionId,
        actorId: userId,
      }),
    );
    await controller.peerConfirmShiftChange(
      { headers: {} } as Request,
      created.data.id,
      true,
    );
    expect(starter).toHaveBeenCalledTimes(1);
    const link = (
      await pool.query(
        'SELECT initiated_by,attributes FROM hrm_schema.procedure_links WHERE request_id=$1',
        [created.data.id],
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
  it('retries a start timeout with the same key and delegates actions without changing HRM status', async () => {
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
    const instances = new Map<string, string>();
    const tokenBefore = process.env.INTERNAL_SERVICE_TOKEN;
    process.env.INTERNAL_SERVICE_TOKEN = 'local-test-token';
    let timedOut = false;
    const calls: RequestInit[] = [];
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        calls.push(init!);
        const body = JSON.parse(String(init?.body));
        if (!instances.has(body.idempotencyKey))
          instances.set(body.idempotencyKey, randomUUID());
        if (!timedOut) {
          timedOut = true;
          throw new Error('Response lost after remote commit');
        }
        return new Response(
          JSON.stringify({
            id: instances.get(body.idempotencyKey),
            code: 'QT001',
          }),
          { status: 201 },
        );
      });
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
      expect(instances.size).toBe(1);
      expect(
        calls.map((call) => JSON.parse(String(call.body)).initiatedBy),
      ).toEqual([userId, userId]);
      fetchMock.mockImplementation(async (_url, init) => {
        expect(init?.headers).toMatchObject({
          authorization: 'Bearer user-session',
        });
        expect(init?.headers).not.toHaveProperty('x-service-token');
        return new Response(JSON.stringify({ status: 'running' }), {
          status: 200,
        });
      });
      const req = {
        headers: { authorization: 'Bearer user-session' },
      } as Request;
      await bridge.applyAction(req, link!.ref, {
        action: 'APPROVE',
        idempotencyKey: 'approve-first-step',
      });
      expect(
        (
          await pool.query(
            'SELECT status FROM hrm_schema.business_trip_requests WHERE id=$1',
            [id],
          )
        ).rows[0].status,
      ).toBe('PENDING');
      fetchMock.mockResolvedValue(
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
      await pool.query(
        `INSERT INTO procedure_schema.instances(id,definition_id,version_id,code,title,status,initiated_by,snapshot,started_at)
        VALUES($1,$2,$3,'QT001','Công tác','completed',$4,$5,now())`,
        [
          resumed.instanceId,
          definitionId,
          versionId,
          userId,
          JSON.stringify({
            id: resumed.instanceId,
            code: 'QT001',
            status: 'completed',
            sourceType: 'hrm_request',
            sourceId: link!.id,
            completedAt: '2026-09-28T02:00:00Z',
            steps: [],
            activity: [
              { actorId: userId, action: 'approve' },
              { actorId: randomUUID(), action: 'start' },
            ],
          }),
        ],
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
      fetchMock.mockRestore();
      if (tokenBefore === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
      else process.env.INTERNAL_SERVICE_TOKEN = tokenBefore;
    }
  });
});
