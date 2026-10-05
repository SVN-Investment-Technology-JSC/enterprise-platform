import type { Pool } from 'pg';
import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import { HrmProcedureBridgeService } from './hrm-procedure-bridge.service';
import { fetchProcedureProgress, fetchProcedureStatuses } from './hrm-procedure-api';
import {
  applyHrmProcedureStep,
  receiveHrmProcedureStep,
  writeProcedureStepProgress,
} from './hrm-procedure-progress';
import { processHrmProcedureSync } from './hrm-procedure-sync';
import { workflowProgressFilter } from './hrm-workflow-filter';

jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));

const T = '11111111-1111-4111-8111-111111111111';
const I = '33333333-3333-4333-8333-333333333333';
const S = '44444444-4444-4444-8444-444444444444';
const E = '55555555-5555-4555-8555-555555555555';
const L = '66666666-6666-4666-8666-666666666666';
const R = '77777777-7777-4777-8777-777777777777';

const json = (status: number, body: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

function stepEvent(sequence: number, over: Record<string, unknown> = {}): IntegrationEventEnvelope {
  return {
    id: E,
    type: 'procedure.instance.step_changed',
    version: 1,
    tenantId: T,
    source: 'procedure-engine',
    occurredAt: '2026-10-05T08:00:00.000Z',
    correlationId: I,
    payload: {
      instanceId: I,
      instanceCode: 'PRC-1',
      sourceType: 'hrm_request',
      sourceId: S,
      stepId: 'step-2',
      stepName: 'Trưởng phòng duyệt',
      assignees: ['Trưởng phòng A', 'Phó phòng B'],
      status: 'running',
      sequence,
      occurredAt: '2026-10-05T08:00:00.000Z',
      ...over,
    },
  } as unknown as IntegrationEventEnvelope;
}

/** Cơ sở dữ liệu giả: ghi lại câu SQL, trả dòng theo từ khóa. */
function fakeDb(options: {
  inbox?: Record<string, unknown> | null;
  link?: Record<string, unknown> | null;
  linkUpdated?: boolean;
  ready?: boolean;
}) {
  const calls: { text: string; params: unknown[] }[] = [];
  const query = jest.fn(async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    if (text.includes('to_regclass')) return { rows: [{ inbox: options.ready === false ? null : 'x', col: options.ready === false ? 0 : 1 }] };
    if (text.includes('FROM hrm_schema.procedure_step_inbox') && text.includes('FOR UPDATE'))
      return { rows: options.inbox === null ? [] : [options.inbox ?? { source_type: 'hrm_request', source_id: S, orphaned: false, event: stepEvent(2) }] };
    if (text.includes('FROM hrm_schema.procedure_links l') && text.includes('FOR UPDATE'))
      return { rows: options.link === null ? [] : [options.link ?? { id: L }] };
    if (text.includes('UPDATE hrm_schema.procedure_links') && text.includes('current_step_seq<'))
      return options.linkUpdated === false
        ? { rows: [] }
        : { rows: [{ id: L, request_kind: 'leave', request_id: R, revision: 1 }] };
    return { rows: [] };
  });
  return { calls, query };
}

jest.mock('./hrm-transaction.js', () => ({
  hrmTransaction: async (pool: { __db: unknown }, run: (db: unknown) => unknown) => run(pool.__db),
}));

function poolOf(db: ReturnType<typeof fakeDb>) {
  return { query: db.query, __db: { query: db.query } } as unknown as Pool;
}

describe('FIX-E-02 - ghi tiến độ Procedure vào đơn HRM', () => {
  beforeEach(() => {
    // Mỗi test dùng lược đồ "đã migrate".
    process.env.INTERNAL_SERVICE_TOKEN = 'token';
    process.env.PROCEDURE_API_URL = 'http://pe/api/procedure';
  });

  describe('receiveHrmProcedureStep', () => {
    it('ghi hộp thư theo khóa instance+sequence rồi cập nhật link và đơn, không đổi trạng thái nghiệp vụ', async () => {
      const db = fakeDb({});
      await receiveHrmProcedureStep(poolOf(db), T, stepEvent(2));

      const insert = db.calls.find((call) => call.text.includes('INSERT INTO hrm_schema.procedure_step_inbox'));
      expect(insert?.text).toContain('ON CONFLICT(tenant_id,instance_id,sequence) DO NOTHING');
      expect(insert?.params.slice(0, 3)).toEqual([T, I, 2]);

      const linkUpdate = db.calls.find((call) => call.text.includes('current_step_seq<'));
      expect(linkUpdate?.params).toEqual([T, L, 'Trưởng phòng duyệt', 'Trưởng phòng A, Phó phòng B', 2]);
      const requestUpdate = db.calls.find((call) => call.text.includes('UPDATE hrm_schema.leave_requests'));
      expect(requestUpdate?.text).toContain("workflow_status='RUNNING'");
      expect(requestUpdate?.text).toContain('current_step_name=$3');
      // Không động tới cột status của đơn.
      expect(requestUpdate?.text).not.toMatch(/\bstatus\s*=/);
      const settled = db.calls.find((call) => call.text.includes('UPDATE hrm_schema.procedure_step_inbox SET status'));
      expect(settled?.params[3]).toBe('APPLIED');
    });

    it('sự kiện cũ hơn tiến độ đã ghi bị bỏ qua (SKIPPED), không ghi đè đơn', async () => {
      const db = fakeDb({ linkUpdated: false });
      await receiveHrmProcedureStep(poolOf(db), T, stepEvent(1));
      expect(db.calls.some((call) => call.text.includes('UPDATE hrm_schema.leave_requests'))).toBe(false);
      const settled = db.calls.find((call) => call.text.includes('UPDATE hrm_schema.procedure_step_inbox SET status'));
      expect(settled?.params[3]).toBe('SKIPPED');
    });

    it('nhận lại cùng sự kiện (đã APPLIED) là no-op', async () => {
      const db = fakeDb({ inbox: null });
      await receiveHrmProcedureStep(poolOf(db), T, stepEvent(2));
      expect(db.calls.some((call) => call.text.includes('current_step_seq<'))).toBe(false);
    });

    it('chưa có liên kết (phản hồi tạo instance chưa về): giữ PENDING, không ghi đơn', async () => {
      const db = fakeDb({ link: null });
      await receiveHrmProcedureStep(poolOf(db), T, stepEvent(2));
      expect(db.calls.some((call) => call.text.includes('current_step_seq<'))).toBe(false);
      expect(db.calls.some((call) => call.text.includes("SET status=$4"))).toBe(false);
      expect(db.calls.some((call) => call.text.includes("last_error='Chờ xác nhận khởi tạo Procedure'"))).toBe(true);
    });

    it('hồ sơ đã kết thúc: bước chỉ là lịch sử, bỏ qua', async () => {
      const db = fakeDb({
        inbox: { source_type: 'hrm_request', source_id: S, orphaned: false, event: stepEvent(3, { status: 'completed' }) },
      });
      await receiveHrmProcedureStep(poolOf(db), T, stepEvent(3, { status: 'completed' }));
      expect(db.calls.some((call) => call.text.includes('current_step_seq<'))).toBe(false);
    });

    it('bỏ qua nguồn khác hrm_request, tenant lệch hoặc loại sự kiện khác; payload sai thì lỗi', async () => {
      const db = fakeDb({});
      await receiveHrmProcedureStep(poolOf(db), T, stepEvent(2, { sourceType: 'maintenance_occurrence' }));
      await receiveHrmProcedureStep(poolOf(db), '99999999-9999-4999-8999-999999999999', stepEvent(2));
      await receiveHrmProcedureStep(poolOf(db), T, { ...stepEvent(2), type: 'procedure.instance.completed' } as never);
      expect(db.calls).toHaveLength(0);
      await expect(receiveHrmProcedureStep(poolOf(db), T, stepEvent(0))).rejects.toThrow('không hợp lệ');
    });

    it('migration 0029 chưa chạy: từ chối nhận (consumer thử lại), ghi tiến độ là no-op', async () => {
      // Cô lập module để không dùng cache dương của các test khác.
      const db = fakeDb({ ready: false });
      let result: unknown;
      await jest.isolateModulesAsync(async () => {
        const fresh = await import('./hrm-procedure-progress');
        await expect(fresh.receiveHrmProcedureStep(poolOf(db), T, stepEvent(2))).rejects.toThrow('0029');
        result = await fresh.writeProcedureStepProgress(db, T, L, { stepName: 'x', sequence: 5 });
      });
      expect(result).toBe(false);
    });
  });

  it('writeProcedureStepProgress cắt tên bước 100 ký tự và bỏ chuỗi rỗng', async () => {
    const db = fakeDb({});
    await writeProcedureStepProgress(db, T, L, { stepName: 'x'.repeat(150), assigneeName: '  ', sequence: 3 });
    const update = db.calls.find((call) => call.text.includes('current_step_seq<'));
    expect((update?.params[2] as string).length).toBe(100);
    expect(update?.params[3]).toBeNull();
  });

  describe('applyHrmProcedureStep', () => {
    it('lỗi tạm đánh dấu FAILED để tick sau thử lại (không ném ra ngoài)', async () => {
      const db = fakeDb({});
      db.query.mockImplementationOnce(async () => {
        throw new Error('db sập');
      });
      await expect(applyHrmProcedureStep(poolOf(db), T, I, 2)).resolves.toBeUndefined();
      const failed = db.calls.find((call) => call.text.includes("SET status='FAILED'"));
      expect(failed?.params[3]).toBe('db sập');
    });
  });

  describe('API nội bộ Procedure cho tiến độ', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('fetchProcedureProgress gọi GET internal/instances/:id/progress bằng service token; 404 -> null', async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce(json(200, { instanceId: I, steps: [], activity: [] })).mockResolvedValueOnce(json(404));
      global.fetch = fetchMock as unknown as typeof fetch;
      expect(await fetchProcedureProgress(T, I)).toMatchObject({ instanceId: I });
      expect(fetchMock.mock.calls[0][0]).toBe(`http://pe/api/procedure/v1/internal/instances/${I}/progress`);
      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'x-service-token': 'token', 'x-tenant-id': T });
      expect(await fetchProcedureProgress(T, I)).toBeNull();
    });

    it('fetchProcedureStatuses gửi tối đa 100 mã bằng POST; PE lỗi -> PROCEDURE_UNAVAILABLE', async () => {
      const fetchMock = jest.fn().mockResolvedValueOnce(json(200, [{ instanceId: I, sequence: 2 }])).mockResolvedValueOnce(json(503));
      global.fetch = fetchMock as unknown as typeof fetch;
      const ids = Array.from({ length: 150 }, (_, index) => `id-${index}`);
      expect(await fetchProcedureStatuses(T, ids)).toHaveLength(1);
      expect(fetchMock.mock.calls[0][1].method).toBe('POST');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).ids).toHaveLength(100);
      await expect(fetchProcedureStatuses(T, [I])).rejects.toMatchObject({ response: { code: 'PROCEDURE_UNAVAILABLE' } });
      expect(await fetchProcedureStatuses(T, [])).toEqual([]);
    });
  });

  describe('getProcedureProgress (GET v1/procedure-progress/:instanceId)', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('giữ nguyên hình dạng phản hồi cũ và không truy vấn procedure_schema', async () => {
      const sql: string[] = [];
      const pool = {
        query: jest.fn(async (text: string) => {
          sql.push(text);
          return { rows: [{ id: L, sync_status: 'RUNNING', last_error: null }] };
        }),
      } as unknown as Pool;
      global.fetch = jest.fn().mockResolvedValue(
        json(200, {
          instanceId: I,
          instanceCode: 'PRC-1',
          status: 'running',
          currentStepId: 's2',
          currentStepName: 'Duyệt',
          steps: [{ id: 's2', name: 'Duyệt', status: 'in_progress', order: 2, currentRoleStage: 'A', roleTitle: 'Trưởng phòng' }],
          activity: [{ id: 'a1' }],
        }),
      ) as unknown as typeof fetch;
      const progress = await new HrmProcedureBridgeService({} as never).getProcedureProgress(pool, T, I);
      expect(Object.keys(progress ?? {}).sort()).toEqual(
        ['activity', 'canAct', 'completedAt', 'currentAssigneeName', 'currentStepId', 'currentStepName', 'hrmSynced', 'instanceCode', 'instanceId', 'lastError', 'status', 'steps', 'submittedAttributes', 'syncStatus'].sort(),
      );
      expect(progress).toMatchObject({ syncStatus: 'RUNNING', hrmSynced: false, currentStepName: 'Duyệt' });
      expect(Object.keys(progress!.steps[0]).sort()).toEqual(
        ['completedAt', 'currentRoleStage', 'id', 'name', 'order', 'roleTitle', 'slaDueAt', 'slaHours', 'status'].sort(),
      );
      expect(sql.some((text) => text.includes('procedure_schema'))).toBe(false);
    });

    it('instance không có liên kết HRM hoặc PE không có hồ sơ -> null', async () => {
      const none = { query: jest.fn(async () => ({ rows: [] })) } as unknown as Pool;
      expect(await new HrmProcedureBridgeService({} as never).getProcedureProgress(none, T, I)).toBeNull();
      const pool = { query: jest.fn(async () => ({ rows: [{ id: L, sync_status: 'RUNNING' }] })) } as unknown as Pool;
      global.fetch = jest.fn().mockResolvedValue(json(404)) as unknown as typeof fetch;
      expect(await new HrmProcedureBridgeService({} as never).getProcedureProgress(pool, T, I)).toBeNull();
    });
  });

  describe('đối soát (reconcile) qua API, không đọc DB Procedure', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('cập nhật bước hiện tại cho link RUNNING và đưa kết quả cuối vào hộp thư kết quả', async () => {
      const calls: { text: string; params: unknown[] }[] = [];
      const I2 = '88888888-8888-4888-8888-888888888888';
      const query = jest.fn(async (text: string, params: unknown[] = []) => {
        calls.push({ text, params });
        if (text.includes('to_regclass')) return { rows: [{ inbox: 'x', col: 1 }] };
        if (text.includes('l.instance_id IS NOT NULL'))
          return {
            rows: [
              { id: L, instance_id: I, source_type: 'hrm_request', source_id: S, sync_status: 'RUNNING' },
              { id: 'l2', instance_id: I2, source_type: 'hrm_request', source_id: R, sync_status: 'RUNNING' },
            ],
          };
        if (text.includes('current_step_seq<')) return { rows: [{ id: L, request_kind: 'leave', request_id: R, revision: 1 }] };
        if (text.includes('FROM hrm_schema.procedure_result_inbox'))
          return { rows: [{ instance_id: I2, source_type: 'hrm_request', source_id: R, result: 'completed' }] };
        return { rows: [] };
      });
      const pool = { query, __db: { query } } as unknown as Pool;
      global.fetch = jest.fn().mockResolvedValue(
        json(200, [
          { instanceId: I, status: 'running', currentStepName: 'Giám đốc duyệt', currentAssigneeName: 'Giám đốc B', sequence: 4 },
          { instanceId: I2, status: 'completed', completedAt: '2026-10-05T09:00:00.000Z', lastActorId: S, sequence: 9 },
        ]),
      ) as unknown as typeof fetch;

      await processHrmProcedureSync(pool, T);

      const write = calls.find((call) => call.text.includes('current_step_seq<'));
      expect(write?.params).toEqual([T, L, 'Giám đốc duyệt', 'Giám đốc B', 4]);
      const result = calls.find((call) => call.text.includes('INSERT INTO hrm_schema.procedure_result_inbox'));
      expect(result?.params[2]).toBe(I2);
      expect(calls.some((call) => call.text.includes('procedure_schema'))).toBe(false);
    });

    it('Procedure tạm không phục vụ: bỏ qua đối soát, không ném lỗi', async () => {
      const query = jest.fn(async (text: string) => {
        if (text.includes('to_regclass')) return { rows: [{ inbox: 'x', col: 1 }] };
        if (text.includes('l.instance_id IS NOT NULL'))
          return { rows: [{ id: L, instance_id: I, source_type: 'hrm_request', source_id: S }] };
        return { rows: [] };
      });
      global.fetch = jest.fn().mockResolvedValue(json(503)) as unknown as typeof fetch;
      await expect(processHrmProcedureSync({ query, __db: { query } } as unknown as Pool, T)).resolves.toBeUndefined();
    });
  });
});

describe('workflowProgressFilter (lọc "đang chờ ai duyệt" và "bước hiện tại")', () => {
  it('không có bộ lọc thì TRUE và không đụng cột mới', () => {
    expect(workflowProgressFilter('lr', 4, {})).toEqual({ sql: 'TRUE', params: [] });
    expect(workflowProgressFilter('lr', 4, { assignee: '  ', currentStep: '' })).toEqual({ sql: 'TRUE', params: [] });
  });

  it('assignee khớp một phần ILIKE, thoát ký tự đại diện; bước khớp chính xác; số tham số đúng chỗ', () => {
    const filter = workflowProgressFilter('lr', 5, { assignee: '50%_a', currentStep: 'Giám đốc duyệt' });
    expect(filter.sql).toBe(
      "COALESCE(lr.current_assignee_name,'') ILIKE $5 AND lower(COALESCE(lr.current_step_name,'')) = lower($6)",
    );
    expect(filter.params).toEqual(['%50\\%\\_a%', 'Giám đốc duyệt']);
    const onlyStep = workflowProgressFilter('a', 4, { currentStep: 'X' });
    expect(onlyStep.sql).toContain('$4');
    expect(onlyStep.params).toEqual(['X']);
  });
});
