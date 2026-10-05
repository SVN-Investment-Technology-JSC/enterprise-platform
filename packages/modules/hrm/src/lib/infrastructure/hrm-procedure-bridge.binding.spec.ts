import { HrmProcedureBridgeService } from './hrm-procedure-bridge.service';
import { fetchPublishedProcedureDefinition } from './hrm-procedure-api';

jest.mock('./hrm-context.service.js', () => ({ HrmContextService: class {} }));
jest.mock('./hrm-procedure-api', () => ({
  ...jest.requireActual('./hrm-procedure-api'),
  fetchPublishedProcedureDefinition: jest.fn(),
}));

type Row = Record<string, unknown>;

/** Pool giả: trả các binding đang hiệu lực khớp (sub_type_code null hoặc = $3). */
function fakePool(bindings: Row[]) {
  return {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      // Bảng ánh xạ chưa migrate: dùng ánh xạ mặc định.
      if (sql.includes('to_regclass')) return { rows: [{ ready: false }] };
      if (sql.includes('sub_type_code IS NOT NULL'))
        return {
          rows: bindings.filter(
            (b) => b.sub_type_code != null && b.mode === 'PROCEDURE',
          ),
        };
      return {
        rows: bindings.filter(
          (b) => b.sub_type_code == null || b.sub_type_code === params[2],
        ),
      };
    }),
  } as never;
}

const definition = {
  id: 'd1',
  code: 'LEAVE',
  name: 'Nghỉ phép',
  attributes: [{ id: 'a', code: 'x', name: 'X', type: 'text' }],
  steps: [],
};

describe('getBindingDefinitionWithAttributes', () => {
  const service = new HrmProcedureBridgeService({} as never);
  beforeEach(() => {
    (fetchPublishedProcedureDefinition as jest.Mock).mockResolvedValue(
      definition,
    );
  });

  it('ưu tiên binding mã loại con rồi mới tới mặc định', async () => {
    const pool = fakePool([
      { sub_type_code: null, mode: 'DIRECT' },
      {
        sub_type_code: 'ANNUAL',
        mode: 'PROCEDURE',
        procedure_definition_id: 'd1',
      },
    ]);
    const withSub = await service.getBindingDefinitionWithAttributes(
      pool,
      't',
      'leave' as never,
      'ANNUAL',
    );
    expect(withSub?.definitionId).toBe('d1');
    const other = await service.getBindingDefinitionWithAttributes(
      pool,
      't',
      'leave' as never,
      'SICK',
    );
    expect(other).toBeNull();
  });

  it('gắn ánh xạ trường HRM vào từng thuộc tính (mặc định OVERWRITE: ẩn khỏi form động)', async () => {
    (fetchPublishedProcedureDefinition as jest.Mock).mockResolvedValue({
      ...definition,
      attributes: [
        { id: 'a', code: 'so_ngay_nghi', name: 'Số ngày', type: 'number' },
        { id: 'b', code: 'khac', name: 'Khác', type: 'text' },
      ],
    });
    const pool = fakePool([
      {
        id: 'b1',
        sub_type_code: null,
        mode: 'PROCEDURE',
        procedure_definition_id: 'd1',
      },
    ]);
    const result = await service.getBindingDefinitionWithAttributes(
      pool,
      't',
      'leave' as never,
    );
    expect(result?.attributes[0].mapping).toMatchObject({
      hrmField: 'form.duration',
      mode: 'OVERWRITE',
      group: 'form',
    });
    expect(result?.attributes[1].mapping).toBeNull();
  });

  it('báo SUBTYPE_REQUIRED khi chỉ có binding loại con mà chưa chọn loại con', async () => {
    const pool = fakePool([
      {
        sub_type_code: 'ANNUAL',
        mode: 'PROCEDURE',
        procedure_definition_id: 'd1',
      },
    ]);
    const result = await service.getBindingDefinitionWithAttributes(
      pool,
      't',
      'leave' as never,
    );
    expect(result).toMatchObject({
      code: 'SUBTYPE_REQUIRED',
      attributes: [],
    });
  });

  it('không có binding nào thì DIRECT (null)', async () => {
    const result = await service.getBindingDefinitionWithAttributes(
      fakePool([]),
      't',
      'leave' as never,
    );
    expect(result).toBeNull();
  });
});
