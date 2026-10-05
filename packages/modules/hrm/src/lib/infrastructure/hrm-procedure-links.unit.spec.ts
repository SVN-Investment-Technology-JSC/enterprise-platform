import type { PoolClient } from 'pg';
import {
  prepareHrmProcedureLink,
  saveHrmProcedureBinding,
} from './hrm-procedure-links';

const T = '11111111-1111-4111-8111-111111111111';
const E = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const json = (status: number, body: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

/** DB giả: trả theo từ khóa câu SQL; ghi lại mọi câu để kiểm tra không đụng procedure_schema. */
function fakeDb(rows: { bindings: unknown[] }) {
  const sql: string[] = [];
  const db = {
    query: jest.fn(async (text: string) => {
      sql.push(text);
      if (text.includes('pg_advisory_xact_lock'))
        return { rows: [], rowCount: 0 };
      if (/FROM hrm_schema\.leave_requests/.test(text))
        return {
          rows: [{ id: R, employee_id: E, revision: 1, status: 'PENDING' }],
          rowCount: 1,
        };
      if (text.includes('INSERT INTO hrm_schema.procedure_links'))
        return {
          rows: [
            {
              id: 'l1',
              tenant_id: T,
              request_kind: 'leave',
              request_id: R,
              revision: 1,
              instance_id: null,
              sync_status: 'START_PENDING',
            },
          ],
          rowCount: 1,
        };
      if (text.includes('FROM hrm_schema.procedure_links'))
        return { rows: [], rowCount: 0 };
      if (text.includes('FROM hrm_schema.request_procedure_bindings'))
        return { rows: rows.bindings, rowCount: rows.bindings.length };
      return { rows: [], rowCount: 0 };
    }),
  };
  return { db: db as unknown as PoolClient, sql };
}

const submission = {
  tenantId: T,
  kind: 'leave' as const,
  requestId: R,
  revision: 1,
  employeeId: E,
  initiatedBy: E,
  title: 'Đơn nghỉ',
};
const procedureBinding = {
  id: 'b1',
  sub_type_code: null,
  mode: 'PROCEDURE',
  procedure_definition_id: D,
  configuration_status: 'ACTIVE',
};

describe('gắn quy trình HRM không đọc DB Procedure', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'token';
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('chưa có binding thì mặc định DIRECT, không lỗi 409', async () => {
    const { db } = fakeDb({ bindings: [] });
    await expect(prepareHrmProcedureLink(db, submission)).resolves.toBeNull();
  });

  it('binding PROCEDURE: lấy bản chụp qua API, không truy vấn procedure_schema', async () => {
    const definition = { id: D, steps: [{ id: 's' }] };
    global.fetch = jest.fn().mockResolvedValue(json(200, definition));
    const { db, sql } = fakeDb({ bindings: [procedureBinding] });
    const link = await prepareHrmProcedureLink(db, submission);
    expect(link?.id).toBe('l1');
    expect(sql.some((s) => s.includes('procedure_schema'))).toBe(false);
    const insert = (db.query as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO hrm_schema.procedure_links'),
    );
    expect(JSON.parse(insert[1][13])).toEqual(definition);
  });

  it('FIX-E-05: thuộc tính gửi sang PE theo ánh xạ của binding (mặc định OVERWRITE khi chưa cấu hình)', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(200, { id: D, steps: [] }));
    const { db } = fakeDb({ bindings: [procedureBinding] });
    await prepareHrmProcedureLink(db, {
      ...submission,
      attributes: { so_ngay_nghi: 1, custom: 'giữ' },
      fieldRow: { reason: 'Lý do', duration: '5', leave_type_id: 'lt' },
    });
    const insert = (db.query as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO hrm_schema.procedure_links'),
    );
    expect(JSON.parse(insert[1][8])).toMatchObject({
      so_ngay_nghi: 5,
      duration: 5,
      custom: 'giữ',
      ly_do: 'Lý do',
    });
  });

  it('FIX-E-05: ánh xạ riêng của binding (PREFILL không đè giá trị người nhập, OVERWRITE đè)', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(200, { id: D, steps: [] }));
    const { db } = fakeDb({ bindings: [procedureBinding] });
    const base = db.query as jest.Mock;
    const impl = base.getMockImplementation() as (t: string) => Promise<unknown>;
    base.mockImplementation(async (text: string) => {
      if (text.includes('to_regclass')) return { rows: [{ ready: true }] };
      if (text.includes('request_procedure_field_mappings'))
        return {
          rows: [
            { hrm_field: 'form.duration', attribute_code: 'so_ngay', scope: 'any', step_id: '', transform: 'none', mode: 'PREFILL' },
            { hrm_field: 'form.reason', attribute_code: 'ly_do_don', scope: 'any', step_id: '', transform: 'none', mode: 'OVERWRITE' },
          ],
        };
      return impl(text);
    });
    await prepareHrmProcedureLink(db, {
      ...submission,
      attributes: { so_ngay: 9, ly_do_don: 'giả' },
      fieldRow: { reason: 'Thật', duration: '5' },
    });
    const insert = base.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO hrm_schema.procedure_links'),
    );
    const attributes = JSON.parse(insert[1][8]);
    expect(attributes).toEqual({ so_ngay: 9, ly_do_don: 'Thật' });
  });

  it('binding PROCEDURE khi Procedure tắt: 409 PROCEDURE_UNAVAILABLE, không tạo liên kết', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(403));
    const { db } = fakeDb({ bindings: [procedureBinding] });
    await expect(
      prepareHrmProcedureLink(db, submission),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'PROCEDURE_UNAVAILABLE' },
    });
    const inserted = (db.query as jest.Mock).mock.calls.some((c) =>
      String(c[0]).includes('INSERT INTO hrm_schema.procedure_links'),
    );
    expect(inserted).toBe(false);
  });

  it('lưu binding PROCEDURE bị từ chối khi Procedure không khả dụng và không ghi bảng binding', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    const { db, sql } = fakeDb({ bindings: [] });
    await expect(
      saveHrmProcedureBinding(db, {
        tenantId: T,
        kind: 'LEAVE',
        mode: 'PROCEDURE',
        definitionId: D,
        actorId: E,
      }),
    ).rejects.toMatchObject({ response: { code: 'PROCEDURE_UNAVAILABLE' } });
    expect(sql.some((s) => s.includes('INSERT INTO'))).toBe(false);
    expect(sql.some((s) => s.includes('procedure_schema'))).toBe(false);
  });
});
