import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import {
  APPROVAL_OUT_OF_SCOPE,
  SELF_APPROVAL_FORBIDDEN,
  assertCanDecide,
} from './hrm-approval-policy';
import { startHrmProcedure } from './hrm-procedure-bridge.service';
import {
  prepareHrmProcedureLink,
  saveHrmProcedureBinding,
} from './hrm-procedure-links';
import { receiveHrmProcedureStep } from './hrm-procedure-progress';
import {
  processHrmProcedureSync,
  receiveHrmProcedureResult,
} from './hrm-procedure-sync';
import { hrmTransaction } from './hrm-transaction';
import { createProcedureApiFake, fakeOrgScope } from './hrm-test-support';

/**
 * FIX-E-08: mô phỏng đầu cuối luồng gửi đơn PROCEDURE khi không có DB thật.
 * - DB giả có trạng thái, hiểu đúng các câu SQL của luồng liên kết/tiến độ/kết quả.
 * - Procedure Engine giả qua fetch (HRM chỉ giao tiếp với Procedure bằng HTTP).
 * - Hàm áp kết quả nghiệp vụ (trừ phép...) được giả để chỉ kiểm tra "áp đúng kết quả".
 */

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

const definition = {
  id: D,
  code: 'LEAVE-FLOW',
  name: 'Duyệt đơn nghỉ',
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
      name: 'Trưởng phòng duyệt',
      order: 2,
      assignments: [{ role: 'A' }],
    },
  ],
};

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** DB giả có trạng thái cho một đơn nghỉ phép và liên kết Procedure của nó. */
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
  bindings: Row[] = [];
  link: Row | null = null;
  correlations: Row[] = [];
  stepInbox = new Map<string, Row>();
  resultInbox = new Map<string, Row>();
  audit: Row[] = [];
  sql: string[] = [];

  constructor(mode: 'DIRECT' | 'PROCEDURE' | null) {
    if (mode)
      this.bindings.push({
        id: randomUUID(),
        sub_type_code: null,
        mode,
        procedure_definition_id: mode === 'PROCEDURE' ? D : null,
        configuration_status: 'ACTIVE',
      });
  }

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
      return this.done(link ? [link] : []); // chọn theo id (có hoặc không FOR UPDATE)
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
    if (has('SET current_step_name=$3,current_assignee_name=$4,current_step_seq=$5')) {
      if (
        !link ||
        link.id !== p[1] ||
        !(link.current_step_seq < Number(p[4])) ||
        ['APPLIED', 'CONFLICT'].includes(link.sync_status)
      )
        return this.done();
      Object.assign(link, {
        current_step_name: p[2],
        current_assignee_name: p[3],
        current_step_seq: p[4],
      });
      return this.done([link]);
    }
    if (has('SET current_step_name=NULL,current_assignee_name=NULL WHERE')) {
      Object.assign(link!, { current_step_name: null, current_assignee_name: null });
      return this.done();
    }
    if (has('UPDATE hrm_schema.leave_requests SET current_step_name=$3')) {
      Object.assign(this.request, {
        current_step_name: p[2],
        current_assignee_name: p[3],
        workflow_status: 'RUNNING',
      });
      return this.done();
    }
    if (has('UPDATE hrm_schema.leave_requests SET current_step_name=NULL')) {
      Object.assign(this.request, {
        current_step_name: null,
        current_assignee_name: null,
        workflow_status: p[2],
      });
      return this.done();
    }
    if (has('UPDATE hrm_schema.leave_requests SET procedure_instance_id=$3')) {
      this.request.procedure_instance_id = p[2];
      return this.done();
    }
    if (has('SET sync_status=$4,last_error=$5,lease_until=NULL')) {
      if (link && link.lease_token === p[2])
        Object.assign(link, {
          sync_status: p[3],
          last_error: p[4],
          lease_token: null,
        });
      return this.done();
    }
    // Hộp thư tiến độ bước.
    if (has('INSERT INTO hrm_schema.procedure_step_inbox')) {
      const key = `${p[1]}:${p[2]}`;
      if (!this.stepInbox.has(key))
        this.stepInbox.set(key, {
          instance_id: p[1],
          sequence: p[2],
          status: 'PENDING',
          source_type: p[4],
          source_id: p[5],
          event: JSON.parse(String(p[6])),
        });
      return this.done();
    }
    if (has('FROM hrm_schema.procedure_step_inbox') && has('SKIP LOCKED')) {
      const row = this.stepInbox.get(`${p[1]}:${p[2]}`);
      return this.done(
        row && ['PENDING', 'FAILED'].includes(row.status)
          ? [{ ...row, orphaned: false }]
          : [],
      );
    }
    if (has('SELECT instance_id,sequence FROM hrm_schema.procedure_step_inbox'))
      return this.done(
        [...this.stepInbox.values()].filter((r) =>
          ['PENDING', 'FAILED'].includes(r.status),
        ),
      );
    if (has("UPDATE hrm_schema.procedure_step_inbox SET last_error='Chờ"))
      return this.done();
    if (has('UPDATE hrm_schema.procedure_step_inbox SET status=$4,link_id=$5')) {
      this.stepInbox.get(`${p[1]}:${p[2]}`)!.status = String(p[3]);
      return this.done();
    }
    if (has("UPDATE hrm_schema.procedure_step_inbox SET status='FAILED'")) {
      this.stepInbox.get(`${p[1]}:${p[2]}`)!.status = 'FAILED';
      return this.done();
    }
    // Liên kết theo tương quan (cả sự kiện bước lẫn kết quả).
    if (has('SELECT l.* FROM hrm_schema.procedure_links l')) {
      const match = this.correlations.some(
        (c) =>
          c.link_id === link?.id &&
          c.instance_id === p[1] &&
          c.source_type === p[2] &&
          c.source_id === p[3],
      );
      return this.done(match && link ? [link] : []);
    }
    // Hộp thư kết quả.
    if (has('INSERT INTO hrm_schema.procedure_result_inbox')) {
      if (!this.resultInbox.has(String(p[1])))
        this.resultInbox.set(String(p[1]), {
          event_id: p[1],
          instance_id: p[2],
          source_type: p[3],
          source_id: p[4],
          event: JSON.parse(String(p[5])),
          status: 'PENDING',
        });
      return this.done();
    }
    if (has("event->'payload'->>'status' AS result")) {
      const row = this.resultInbox.get(String(p[1]))!;
      return this.done([{ ...row, result: row.event.payload.status }]);
    }
    if (has('SELECT i.event_id FROM hrm_schema.procedure_result_inbox'))
      return this.done(
        [...this.resultInbox.values()].filter((r) => r.status === 'PENDING'),
      );
    if (has('SELECT * FROM hrm_schema.procedure_result_inbox')) {
      const row = this.resultInbox.get(String(p[1]));
      return this.done(
        row && ['PENDING', 'FAILED'].includes(row.status) ? [row] : [],
      );
    }
    if (has("UPDATE hrm_schema.procedure_result_inbox SET link_id=$3,status='APPLIED'")) {
      this.resultInbox.get(String(p[1]))!.status = 'APPLIED';
      return this.done();
    }
    if (has('SELECT max(revision) AS revision'))
      return this.done([{ revision: link?.revision }]);
    if (has('INSERT INTO hrm_schema.audit_log')) {
      this.audit.push({ action: p[2] ?? 'PROCEDURE_RESULT_APPLIED', detail: JSON.parse(String(p[4])) });
      return this.done();
    }
    if (has("UPDATE hrm_schema.procedure_links SET sync_status='APPLIED'")) {
      link!.sync_status = 'APPLIED';
      return this.done();
    }
    // Truy vấn tìm liên kết chờ khởi tạo / đối soát: không có gì cần xử lý trong mô phỏng.
    if (has('instance_id IS NULL AND sync_status IN') || has('step_reconciled_at IS NULL OR'))
      return this.done();
    if (has('procedure_schema'))
      throw new Error('HRM không được truy vấn schema của Procedure');
    throw new Error('SimDb chưa hiểu câu SQL: ' + text.slice(0, 120));
  }
}

const submission = (sim: SimDb) => ({
  tenantId: T,
  kind: 'leave' as const,
  requestId: sim.request.id as string,
  revision: 1,
  employeeId: EMP,
  initiatedBy: USER,
  title: 'Đơn nghỉ phép',
});

const prepare = (sim: SimDb) =>
  hrmTransaction(sim.pool, (db) => prepareHrmProcedureLink(db, submission(sim)));

function stepEvent(
  link: Row,
  sequence: number,
  stepName: string,
  assignees: string[],
): IntegrationEventEnvelope {
  return {
    id: randomUUID(),
    type: 'procedure.instance.step_changed',
    version: 1,
    tenantId: T,
    source: 'procedure-engine',
    occurredAt: new Date().toISOString(),
    correlationId: link.instance_id,
    payload: {
      instanceId: link.instance_id,
      instanceCode: 'PRC-1',
      sourceType: 'hrm_request',
      sourceId: link.id,
      stepId: 'x',
      stepName,
      assignees,
      status: 'running',
      sequence,
    },
  } as unknown as IntegrationEventEnvelope;
}

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

describe('FIX-E-08 mô phỏng đầu cuối: đơn PROCEDURE', () => {
  const tokenBefore = process.env.INTERNAL_SERVICE_TOKEN;
  let fetchSpy: jest.SpyInstance;
  let pe: ReturnType<typeof createProcedureApiFake>;

  beforeEach(() => {
    mockApplied.length = 0;
    mockActors.length = 0;
    process.env.INTERNAL_SERVICE_TOKEN = 'sim-token';
    pe = createProcedureApiFake({ definitions: { [D]: definition } });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(pe.handler);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    if (tokenBefore === undefined) delete process.env.INTERNAL_SERVICE_TOKEN;
    else process.env.INTERNAL_SERVICE_TOKEN = tokenBefore;
  });

  it('(a) START_PENDING -> startHrmProcedure -> RUNNING, tiến độ ghi vào đơn', async () => {
    const sim = new SimDb('PROCEDURE');
    const link = await prepare(sim);
    expect(link?.syncStatus).toBe('START_PENDING');
    expect(sim.link?.definition_snapshot.id).toBe(D);
    expect(sim.request.current_step_name).toBeNull();

    const started = await startHrmProcedure(sim.pool, link!.id, T);
    expect(started.syncStatus).toBe('RUNNING');
    expect(started.currentStepName).toBe('Trưởng phòng duyệt');
    const call = pe.startCalls()[0].body!;
    expect(call).toMatchObject({
      autoCompleteInitiatorStep: true,
      sourceType: 'hrm_request',
      initiatedBy: USER,
      definitionId: D,
    });
    expect(sim.link?.instance_id).toBe([...pe.instances.values()][0].id);
    expect(sim.request).toMatchObject({
      procedure_instance_id: sim.link?.instance_id,
      current_step_name: 'Trưởng phòng duyệt',
      current_assignee_name: 'Trưởng phòng A',
      workflow_status: 'RUNNING',
      status: 'PENDING', // trạng thái nghiệp vụ chỉ đổi khi có kết quả cuối
    });
  });

  it('(b) PE lỗi -> link FAILED, đơn vẫn tồn tại, retry thành công', async () => {
    const sim = new SimDb('PROCEDURE');
    const link = await prepare(sim);
    pe.state.failStarts = 1;
    const failed = await startHrmProcedure(sim.pool, link!.id, T);
    expect(failed.syncStatus).toBe('FAILED');
    expect(failed.lastError).toContain('Procedure tạm ngưng');
    expect(sim.request.id).toBeTruthy();
    expect(sim.request.status).toBe('PENDING');
    const retried = await startHrmProcedure(sim.pool, link!.id, T);
    expect(retried.syncStatus).toBe('RUNNING');
    expect(sim.link?.last_error).toBeNull();
  });

  it('(b) mất phản hồi sau khi PE đã commit: thử lại dùng cùng khóa, vẫn một instance', async () => {
    const sim = new SimDb('PROCEDURE');
    const link = await prepare(sim);
    pe.state.loseResponses = 1;
    expect((await startHrmProcedure(sim.pool, link!.id, T)).syncStatus).toBe('FAILED');
    expect((await startHrmProcedure(sim.pool, link!.id, T)).syncStatus).toBe('RUNNING');
    expect(pe.instances.size).toBe(1);
    const keys = pe.startCalls().map((c) => c.body?.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it('(c) gửi trùng cùng khóa idempotency: một liên kết, một instance', async () => {
    const sim = new SimDb('PROCEDURE');
    const first = await prepare(sim);
    const second = await prepare(sim);
    expect(second?.id).toBe(first?.id);
    const [a, b] = await Promise.all([
      startHrmProcedure(sim.pool, first!.id, T),
      startHrmProcedure(sim.pool, first!.id, T),
    ]);
    // Bên thua khóa lease thấy liên kết đang khởi tạo, không gọi PE lần hai.
    expect([a.syncStatus, b.syncStatus].sort()).toEqual(['RUNNING', 'START_PENDING']);
    expect(sim.link?.sync_status).toBe('RUNNING');
    // Gọi lại khi đã RUNNING không gọi PE thêm.
    await startHrmProcedure(sim.pool, first!.id, T);
    expect(pe.startCalls()).toHaveLength(1);
    expect(pe.instances.size).toBe(1);
  });

  it('(d) step_changed cũ/trùng bị bỏ qua; completed áp kết quả đúng một lần', async () => {
    const sim = new SimDb('PROCEDURE');
    const link = await prepare(sim);
    await startHrmProcedure(sim.pool, link!.id, T);
    const l = sim.link!;

    await receiveHrmProcedureStep(
      sim.pool,
      T,
      stepEvent(l, 3, 'Giám đốc duyệt', ['Giám đốc']),
    );
    expect(sim.request.current_step_name).toBe('Giám đốc duyệt');
    expect(l.current_step_seq).toBe(3);

    // Sự kiện cũ hơn (sequence 2) đến muộn.
    await receiveHrmProcedureStep(sim.pool, T, stepEvent(l, 2, 'Bước cũ', ['Ai đó']));
    expect(sim.request.current_step_name).toBe('Giám đốc duyệt');
    expect(sim.stepInbox.get(`${l.instance_id}:2`)?.status).toBe('SKIPPED');

    // Giao trùng sequence 3 (id sự kiện khác): không áp lại, không đổi bước.
    await receiveHrmProcedureStep(sim.pool, T, stepEvent(l, 3, 'Trùng lặp', ['X']));
    expect(sim.request.current_step_name).toBe('Giám đốc duyệt');
    expect(sim.stepInbox.size).toBe(2);

    const approver = randomUUID();
    await receiveHrmProcedureResult(sim.pool, T, resultEvent(l, 'completed', approver));
    await processHrmProcedureSync(sim.pool, T);
    await processHrmProcedureSync(sim.pool, T);
    expect(mockApplied).toEqual([
      { kind: 'leave', requestId: sim.request.id, target: 'APPROVED' },
    ]);
    expect(l.sync_status).toBe('APPLIED');
    expect(sim.request).toMatchObject({
      current_step_name: null,
      workflow_status: 'COMPLETED',
    });
    expect(sim.audit.find((a) => a.detail.approverId)?.detail.approverId).toBe(approver);
    expect(mockActors).toEqual([approver]);

    // Bước đến sau khi kết thúc không làm đơn quay lại RUNNING.
    await receiveHrmProcedureStep(sim.pool, T, stepEvent(l, 9, 'Muộn', ['Y']));
    expect(sim.request.workflow_status).toBe('COMPLETED');
  });

  it('(d) kết quả rejected áp trạng thái REJECTED', async () => {
    const sim = new SimDb('PROCEDURE');
    const link = await prepare(sim);
    await startHrmProcedure(sim.pool, link!.id, T);
    await receiveHrmProcedureResult(
      sim.pool,
      T,
      resultEvent(sim.link!, 'rejected', randomUUID()),
    );
    await processHrmProcedureSync(sim.pool, T);
    expect(mockApplied[0].target).toBe('REJECTED');
    expect(sim.request.workflow_status).toBe('REJECTED');
  });

  it('(e) tenant không có PE: mặc định DIRECT, không gọi PE', async () => {
    const none = new SimDb(null);
    expect(await prepare(none)).toBeNull();
    const direct = new SimDb('DIRECT');
    expect(await prepare(direct)).toBeNull();
    expect(pe.calls).toHaveLength(0);
    expect(direct.link).toBeNull();
  });

  it('(e) gắn PROCEDURE bị từ chối khi PE không khả dụng, không ghi cấu hình', async () => {
    const sim = new SimDb(null);
    pe.setAvailable(false);
    await expect(
      hrmTransaction(sim.pool, (db) =>
        saveHrmProcedureBinding(db, {
          tenantId: T,
          kind: 'LEAVE',
          mode: 'PROCEDURE',
          definitionId: D,
          actorId: USER,
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROCEDURE_UNAVAILABLE' },
    });
    expect(sim.sql.some((s) => s.includes('INSERT INTO'))).toBe(false);
  });

  it('(e) PE tắt sau khi đã gắn: gửi đơn trả 409 PROCEDURE_UNAVAILABLE, không tạo liên kết', async () => {
    const sim = new SimDb('PROCEDURE');
    pe.setAvailable(false);
    await expect(prepare(sim)).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROCEDURE_UNAVAILABLE' },
    });
    expect(sim.link).toBeNull();
  });
});

describe('FIX-E-08 mô phỏng: duyệt DIRECT', () => {
  const MANAGER = 'user-manager';
  const OWNER = 'user-staff';
  const deps = (ownerUserId: string | null, subordinates: string[]) => ({
    tenantId: T,
    orgScope: fakeOrgScope(subordinates),
    db: {
      query: async (sql: string) => {
        if (sql.includes('to_regclass')) return { rows: [{ ready: true }], rowCount: 1 };
        if (sql.includes('approval_policy_settings'))
          return { rows: [{ allow_self_approval: false }], rowCount: 1 };
        if (sql.includes('procedure_links')) return { rows: [], rowCount: 0 };
        return { rows: [{ employee_id: EMP, user_id: ownerUserId }], rowCount: 1 };
      },
    } as never,
  });
  const manager = { userId: MANAGER, permissions: ['hrm.leave.approve'] };

  it('tự duyệt đơn của mình: 403 SELF_APPROVAL_FORBIDDEN', async () => {
    await expect(
      assertCanDecide(manager, { id: 'r' }, 'leave', deps(MANAGER, [MANAGER])),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: SELF_APPROVAL_FORBIDDEN },
    });
  });

  it('duyệt đơn ngoài phạm vi đơn vị: 403 APPROVAL_OUT_OF_SCOPE', async () => {
    await expect(
      assertCanDecide(manager, { id: 'r' }, 'leave', deps(OWNER, ['nguoi-khac'])),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: APPROVAL_OUT_OF_SCOPE },
    });
  });

  it('duyệt đơn cấp dưới trong phạm vi: cho phép', async () => {
    await expect(
      assertCanDecide(manager, { id: 'r' }, 'leave', deps(OWNER, [OWNER])),
    ).resolves.toBeUndefined();
  });
});
