import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { startHrmProcedure } from './hrm-procedure-bridge.service.js';
import { prepareHrmProcedureLink } from './hrm-procedure-links.js';
import {
  processHrmProcedureSync,
  receiveHrmProcedureResult,
} from './hrm-procedure-sync.js';
import { hrmTransaction } from './hrm-transaction.js';
import { createProcedureApiFake } from './hrm-test-support.js';

jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
const mockApplied: { kind: string; requestId: string; target: string }[] = [];
const mockActors: string[] = [];
jest.mock('./hrm-request-transition.js', () => ({
  applyHrmRequestResult: async (
    _db: unknown,
    ref: { kind: string; requestId: string },
    target: string,
    actorId: string,
  ) => {
    mockApplied.push({ kind: ref.kind, requestId: ref.requestId, target });
    mockActors.push(actorId);
  },
}));

const T = randomUUID();
const EMP = randomUUID();
const USER = randomUUID();
const D = randomUUID();
const MANAGER_ID = randomUUID();
const BACKUP_ID = randomUUID();

const definition = {
  id: D,
  code: 'LEAVE-DUAL-FLOW',
  name: 'Duyệt đơn nghỉ 2 người nhận (Quản lý hoặc Dự phòng)',
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
      name: 'Duyệt (Quản lý hoặc Trưởng HC-VP)',
      order: 2,
      assignments: [
        {
          role: 'A',
          subjectType: 'initiator_manager',
          managerFallback: { subjectType: 'user', subjectId: BACKUP_ID },
        },
      ],
    },
  ],
};

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

class SimDb {
  request: Row = {
    id: randomUUID(),
    employee_id: EMP,
    revision: 1,
    status: 'PENDING',
    current_step_name: null,
    current_assignee_name: null,
    workflow_status: null,
    procedure_instance_id: null,
  };
  bindings: Row[] = [
    {
      id: randomUUID(),
      sub_type_code: null,
      mode: 'PROCEDURE',
      procedure_definition_id: D,
      configuration_status: 'ACTIVE',
    },
  ];
  link: Row | null = null;
  correlations: Row[] = [];
  resultInbox = new Map<string, Row>();
  audit: Row[] = [];
  sql: string[] = [];

  get pool(): Pool {
    const query = (text: string, params?: unknown[]) => this.query(text, params);
    return {
      query,
      connect: async () => ({
        query,
        release: () => undefined,
      }),
    } as unknown as Pool;
  }

  get client(): PoolClient {
    return {
      query: (text: string, params?: unknown[]) => this.query(text, params),
    } as unknown as PoolClient;
  }

  private done(rows: Row[] = []) {
    return { rows, rowCount: rows.length };
  }

  async query(text: string, p: unknown[] = []) {
    this.sql.push(text);
    const has = (fragment: string) => text.includes(fragment);
    const link = this.link;
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) return this.done();
    if (has('pg_advisory_xact_lock') || has('set_config')) return this.done();
    if (has("to_regclass('hrm_schema.procedure_step_inbox')"))
      return this.done([{ inbox: 'hrm_schema.procedure_step_inbox', col: 1 }]);
    if (has('FROM hrm_schema.leave_requests') && has('FOR UPDATE'))
      return this.done([this.request]);
    if (has('request_kind=$2 AND request_id=$3 AND revision=$4'))
      return this.done(link ? [link] : []);
    if (has('FROM hrm_schema.request_procedure_bindings'))
      return this.done(this.bindings);
    if (has('INSERT INTO hrm_schema.procedure_links')) {
      this.link = {
        id: p[0],
        tenant_id: p[1],
        request_kind: p[2],
        request_id: p[3],
        revision: p[4],
        employee_id: p[5],
        initiated_by: p[6],
        title: p[7],
        attributes: JSON.parse(String(p[8])),
        binding_id: p[9],
        definition_id: p[10],
        source_type: 'hrm_request',
        source_id: p[0],
        start_idempotency_key: p[12],
        definition_snapshot: JSON.parse(String(p[13])),
        sync_status: 'START_PENDING',
        instance_id: null,
        instance_code: null,
        lease_token: null,
        attempts: 0,
        last_error: null,
        current_step_seq: 0,
        current_step_name: null,
        current_assignee_name: null,
      };
      return this.done([this.link]);
    }
    if (has('SET lease_token=$3') && has('RETURNING *')) {
      if (
        !link ||
        link.instance_id ||
        !['START_PENDING', 'FAILED'].includes(link.sync_status) ||
        link.lease_token
      )
        return this.done();
      link.lease_token = p[2];
      link.attempts += 1;
      return this.done([{ ...link }]);
    }
    if (has('FROM hrm_schema.procedure_links WHERE tenant_id=$1 AND id=$2')) {
      return this.done(link ? [link] : []);
    }
    if (has("SET instance_id=$3,instance_code=$4,sync_status='RUNNING'")) {
      Object.assign(link!, {
        instance_id: p[2],
        instance_code: p[3],
        sync_status: 'RUNNING',
        last_error: null,
        lease_token: null,
      });
      return this.done();
    }
    if (has('INSERT INTO hrm_schema.procedure_correlations')) {
      this.correlations.push({
        link_id: p[1],
        instance_id: p[2],
        source_type: p[3],
        source_id: p[4],
      });
      return this.done();
    }
    if (has('FROM hrm_schema.leave_requests WHERE tenant_id=$1 AND id=$2')) {
      return this.done([this.request]);
    }
    if (has('UPDATE hrm_schema.leave_requests SET current_step_name=NULL')) {
      Object.assign(this.request, {
        current_step_name: null,
        current_assignee_name: null,
        workflow_status: p[2],
      });
      return this.done();
    }
    if (has("UPDATE hrm_schema.procedure_links SET sync_status='APPLIED'")) {
      link!.sync_status = 'APPLIED';
      return this.done();
    }
    if (has('SET current_step_name=NULL,current_assignee_name=NULL WHERE')) {
      Object.assign(link!, { current_step_name: null, current_assignee_name: null });
      return this.done();
    }
    if (has('INSERT INTO hrm_schema.procedure_result_inbox')) {
      this.resultInbox.set(String(p[1]), {
        tenant_id: p[0],
        event_id: p[1],
        instance_id: p[2],
        source_type: p[3],
        source_id: p[4],
        event: JSON.parse(String(p[5])),
        status: 'PENDING',
        link_id: null,
      });
      return this.done();
    }
    if (has('SELECT instance_id,source_type,source_id,event->')) {
      const row = this.resultInbox.get(String(p[1]));
      return this.done(
        row
          ? [
              {
                instance_id: row.instance_id,
                source_type: row.source_type,
                source_id: row.source_id,
                result: row.event.payload.status,
              },
            ]
          : [],
      );
    }
    if (has('FROM hrm_schema.procedure_result_inbox i LEFT JOIN')) {
      const rows = [...this.resultInbox.values()]
        .filter((i) => i.status === 'PENDING')
        .map((i) => ({ event_id: i.event_id }));
      return this.done(rows);
    }
    if (has('FROM hrm_schema.procedure_result_inbox WHERE tenant_id=$1 AND event_id=$2')) {
      const row = this.resultInbox.get(String(p[1]));
      return this.done(row ? [row] : []);
    }
    if (has('FROM hrm_schema.procedure_links l WHERE l.tenant_id=$1 AND EXISTS')) {
      const matched = this.correlations.some(
        (c) => c.instance_id === p[1] && c.source_type === p[2] && c.source_id === p[3],
      );
      return this.done(matched && link ? [link] : []);
    }
    if (has('SELECT max(revision) AS revision FROM hrm_schema.procedure_links')) {
      return this.done([{ revision: link?.revision ?? 1 }]);
    }
    if (has("SET link_id=$3,status='APPLIED'")) {
      const row = this.resultInbox.get(String(p[1]));
      if (row) {
        row.status = 'APPLIED';
        row.link_id = p[2];
      }
      return this.done();
    }
    if (has("SET sync_status='APPLIED'")) {
      if (link) link.sync_status = 'APPLIED';
      return this.done();
    }
    if (has('INSERT INTO hrm_schema.audit_log')) {
      this.audit.push({ action: p[2] ?? 'PROCEDURE_RESULT_APPLIED', detail: JSON.parse(String(p[4] ?? p[3])) });
      return this.done();
    }
    return this.done();
  }
}

const submission = (sim: SimDb) => ({
  tenantId: T,
  kind: 'leave' as const,
  requestId: sim.request.id as string,
  revision: 1,
  employeeId: EMP,
  initiatedBy: USER,
  title: 'Đơn xin nghỉ phép kiểm thử',
});

const resultEvent = (
  link: Row,
  status: 'completed' | 'rejected',
  actorId: string,
): IntegrationEventEnvelope =>
  ({
    id: randomUUID(),
    type: 'procedure.instance.completed',
    version: 1,
    tenantId: T,
    source: 'procedure-engine',
    occurredAt: new Date().toISOString(),
    correlationId: link.instance_id,
    payload: {
      instanceId: link.instance_id,
      sourceType: 'hrm_request',
      sourceId: link.id,
      status,
      actorId,
    },
  }) as unknown as IntegrationEventEnvelope;

describe('Kiểm thử đồng bộ trạng thái đơn nghỉ trong HRM khi 1 trong 2 người duyệt qua PE', () => {
  const tokenBefore = process.env.INTERNAL_SERVICE_TOKEN;
  let fetchSpy: jest.SpyInstance;
  let pe: ReturnType<typeof createProcedureApiFake>;

  beforeEach(() => {
    mockApplied.length = 0;
    mockActors.length = 0;
    process.env.INTERNAL_SERVICE_TOKEN = 'sim-token';
    pe = createProcedureApiFake({
      definitions: { [D]: definition },
      currentStepName: 'Duyệt (Quản lý hoặc Trưởng HC-VP)',
      currentAssigneeName: 'Quản lý trực tiếp & Trưởng HC-VP',
    });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(pe.handler);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (tokenBefore === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = tokenBefore;
  });

  it('Trường hợp 1: Quản lý trực tiếp duyệt trong PE -> HRM đồng bộ trạng thái đơn sang APPROVED và ghi nhận actorId', async () => {
    const sim = new SimDb();
    const link = await hrmTransaction(sim.pool, (db) => prepareHrmProcedureLink(db, submission(sim)));
    expect(link?.syncStatus).toBe('START_PENDING');

    // Khởi chạy PE
    const started = await startHrmProcedure(sim.pool, link!.id, T);
    expect(started.syncStatus).toBe('RUNNING');
    expect(sim.link?.sync_status).toBe('RUNNING');
    expect(sim.request.status).toBe('PENDING');

    // Quản lý trực tiếp duyệt đơn trong PE -> PE gửi sự kiện procedure.instance.completed với actorId = MANAGER_ID
    const event = resultEvent(sim.link!, 'completed', MANAGER_ID);
    await receiveHrmProcedureResult(sim.pool, T, event);
    await processHrmProcedureSync(sim.pool, T);

    // Kiểm tra HRM đã áp dụng kết quả
    expect(mockApplied).toEqual([
      { kind: 'leave', requestId: sim.request.id, target: 'APPROVED' },
    ]);
    expect(mockActors).toEqual([MANAGER_ID]);
    expect(sim.link?.sync_status).toBe('APPLIED');
    expect(sim.request.workflow_status).toBe('COMPLETED');
  });

  it('Trường hợp 2: Người dự phòng duyệt trong PE -> HRM đồng bộ trạng thái đơn sang APPROVED và ghi nhận actorId', async () => {
    const sim = new SimDb();
    const link = await hrmTransaction(sim.pool, (db) => prepareHrmProcedureLink(db, submission(sim)));
    expect(link?.syncStatus).toBe('START_PENDING');

    // Khởi chạy PE
    const started = await startHrmProcedure(sim.pool, link!.id, T);
    expect(started.syncStatus).toBe('RUNNING');
    expect(sim.link?.sync_status).toBe('RUNNING');

    // Người dự phòng (Trưởng HC-VP) duyệt đơn trong PE -> PE gửi sự kiện với actorId = BACKUP_ID
    const event = resultEvent(sim.link!, 'completed', BACKUP_ID);
    await receiveHrmProcedureResult(sim.pool, T, event);
    await processHrmProcedureSync(sim.pool, T);

    // Kiểm tra HRM đã áp dụng kết quả
    expect(mockApplied).toEqual([
      { kind: 'leave', requestId: sim.request.id, target: 'APPROVED' },
    ]);
    expect(mockActors).toEqual([BACKUP_ID]);
    expect(sim.link?.sync_status).toBe('APPLIED');
    expect(sim.request.workflow_status).toBe('COMPLETED');
  });
});
