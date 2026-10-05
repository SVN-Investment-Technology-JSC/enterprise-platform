import type { Pool } from 'pg';
import type { ProcedureDefinition } from '@enterprise-platform/contracts-procedure-engine';
import {
  procedureStartProgress,
  startHrmProcedure,
} from './hrm-procedure-bridge.service';
import { procedureStartStepWarnings } from './hrm-procedure-api';
import { saveHrmProcedureBinding } from './hrm-procedure-links';

jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('./hrm-transaction.js', () => ({
  hrmTransaction: async (_pool: unknown, run: (db: unknown) => unknown) =>
    run({
      query: async (text: string) =>
        text.includes('FOR UPDATE')
          ? { rows: [{ lease_token: 'lease', instance_id: null }] }
          : { rows: [] },
    }),
}));
jest.mock('node:crypto', () => ({
  ...jest.requireActual('node:crypto'),
  randomUUID: () => 'lease',
}));

const T = '11111111-1111-4111-8111-111111111111';
const L = '22222222-2222-4222-8222-222222222222';
const I = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const json = (status: number, body: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const definition = {
  id: D,
  steps: [
    { id: 's1', key: 'S', name: 'Nộp đơn', order: 1, assignments: [{ role: 'S' }], attributes: [] },
    { id: 's2', key: 'A', name: 'Duyệt', order: 2, assignments: [{ role: 'A' }] },
  ],
} as unknown as ProcedureDefinition;

function fakePool(finalStatus: string) {
  const claimed = {
    id: L,
    tenant_id: T,
    request_kind: 'leave',
    request_id: 'r',
    revision: 1,
    definition_id: D,
    definition_snapshot: definition,
    title: 'Đơn nghỉ',
    source_type: 'hrm_request',
    source_id: 'r',
    start_idempotency_key: 'k1',
    initiated_by: 'u1',
    attributes: {},
  };
  const updates: unknown[][] = [];
  const pool = {
    query: jest.fn(async (text: string, params: unknown[] = []) => {
      if (text.includes('RETURNING *')) return { rows: [claimed] };
      if (text.startsWith('UPDATE')) updates.push(params);
      if (text.includes('SELECT * FROM hrm_schema.procedure_links'))
        return { rows: [{ ...claimed, sync_status: finalStatus, instance_id: null }] };
      return { rows: [] };
    }),
  };
  return { pool: pool as unknown as Pool, updates };
}

describe('FIX-E-01 phía HRM', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'token';
    process.env.PROCEDURE_API_URL = 'http://pe/api/procedure';
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('gửi cờ autoCompleteInitiatorStep và trả bước hiện tại, người xử lý, cảnh báo', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      json(201, {
        id: I,
        code: 'PR-1',
        currentStepName: 'Trưởng phòng duyệt',
        currentAssigneeName: 'Trưởng phòng A',
        warnings: ['cảnh báo'],
      }),
    );
    global.fetch = fetchMock;
    const { pool } = fakePool('RUNNING');
    const link = await startHrmProcedure(pool, L, T);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.autoCompleteInitiatorStep).toBe(true);
    expect(body.sourceType).toBe('hrm_request');
    expect(link).toMatchObject({
      currentStepName: 'Trưởng phòng duyệt',
      currentAssigneeName: 'Trưởng phòng A',
      warnings: ['cảnh báo'],
    });
  });

  it('PE báo thiếu thuộc tính bắt buộc: link FAILED và trả lastError nêu trường', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(json(400, { message: 'Cần nhập “Số ngày nghỉ” trước khi hoàn tất bước “Nộp đơn”.' }));
    const { pool, updates } = fakePool('FAILED');
    const link = await startHrmProcedure(pool, L, T);
    expect(updates[0][3]).toBe('FAILED');
    expect(link.lastError).toContain('Số ngày nghỉ');
    expect(link.currentStepName).toBeUndefined();
  });

  it('procedureStartProgress bỏ trường rỗng', () => {
    expect(procedureStartProgress({})).toEqual({});
    expect(procedureStartProgress({ currentStepName: 'A', warnings: [] })).toEqual({ currentStepName: 'A' });
  });

  it('cảnh báo cấu hình khi bước đầu không phải bước S', () => {
    expect(procedureStartStepWarnings(definition)).toEqual([]);
    const withR = {
      ...definition,
      steps: [{ ...definition.steps[0], assignments: [{ role: 'S' }, { role: 'R' }] }, definition.steps[1]],
    } as unknown as ProcedureDefinition;
    expect(procedureStartStepWarnings(withR)[0]).toContain('đơn sẽ dừng chờ người nộp');
    const noS = {
      ...definition,
      steps: [{ ...definition.steps[0], assignments: [{ role: 'A' }] }, definition.steps[1]],
    } as unknown as ProcedureDefinition;
    expect(procedureStartStepWarnings(noS)[0]).toContain('không có vai S');
  });

  it('lưu binding PROCEDURE trả cảnh báo (không chặn) khi bước đầu không phải bước S', async () => {
    const bad = {
      ...definition,
      steps: [{ ...definition.steps[0], assignments: [{ role: 'A' }] }, definition.steps[1]],
    };
    global.fetch = jest.fn().mockResolvedValue(json(200, bad));
    const db = {
      query: jest.fn(async (text: string) =>
        text.includes('INSERT INTO hrm_schema.request_procedure_bindings')
          ? { rows: [{ id: 'b1', mode: 'PROCEDURE' }] }
          : { rows: [] },
      ),
    };
    const saved = (await saveHrmProcedureBinding(db as never, {
      tenantId: T,
      kind: 'LEAVE',
      mode: 'PROCEDURE',
      definitionId: D,
      actorId: L,
    })) as { id: string; warnings?: string[] };
    expect(saved.id).toBe('b1');
    expect(saved.warnings?.[0]).toContain('không có vai S');
  });
});
