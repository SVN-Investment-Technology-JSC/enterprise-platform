import type { FulfilRequisitionRequest, Material } from '@enterprise-platform/contracts-inventory';
import {
  DocumentIdempotencyConflictError,
  InsufficientAvailableStockError,
} from '../domain/inventory.error.js';
import type { InventoryActor, InventoryApplication } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { ProcedureInstanceReader, ProcedureInstanceState } from './procedure-instance-reader.port.js';
import {
  RequisitionFulfilmentService,
  requisitionInstallKey,
  requisitionStatus,
} from './requisition-fulfilment.service.js';
import type {
  IdempotentDocumentRef,
  NewStockDocumentInput,
  PostOptions,
  StockDocumentStore,
} from './stock-document-store.port.js';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const ORDER = 'PR-20260904-323C38';

const keeper: InventoryActor = {
  tenantId: 'tenant-1',
  userId: 'keeper-1',
  displayName: 'Thủ kho',
  canManage: false,
  canWriteTransactions: true,
};

function setup(options: {
  state?: ProcedureInstanceState | null;
  available?: Record<string, number>;
  serialized?: string[];
} = {}) {
  const stored: IdempotentDocumentRef[] = [];
  const posted: { input: NewStockDocumentInput; options?: PostOptions }[] = [];
  const available = options.available ?? { 'VT-01': 10, 'VT-02': 5, 'SR-01': 3 };
  let sequence = 0;

  const save = (input: NewStockDocumentInput): IdempotentDocumentRef => {
    sequence += 1;
    const ref: IdempotentDocumentRef = {
      id: `doc-${sequence}`,
      code: `PX-${sequence}`,
      status: 'POSTED',
      idempotencyKey: String(input.idempotencyKey),
      requestHash: input.requestHash,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    };
    stored.push(ref);
    return ref;
  };

  const documents = {
    findByIdempotencyPrefixes: jest.fn(async (_tenant: string, prefixes: readonly string[]) =>
      stored.filter((ref) =>
        prefixes.some((prefix) => ref.idempotencyKey === prefix || ref.idempotencyKey.startsWith(`${prefix}:`)),
      ),
    ),
    createAndPost: jest.fn(async (_tenant: string, input: NewStockDocumentInput, _by: string, opts?: PostOptions) => {
      const existing = stored.find((ref) => ref.idempotencyKey === input.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== input.requestHash) {
          throw new DocumentIdempotencyConflictError(String(input.idempotencyKey));
        }
        return { document: { id: existing.id, code: existing.code, status: 'POSTED' }, transactions: [] };
      }
      // Ghi nguyên tử: một dòng thiếu tồn thì không dòng nào được ghi.
      for (const line of input.lines) {
        if ((available[line.materialCode] ?? 0) < line.quantity) {
          throw new InsufficientAvailableStockError(
            line.materialCode,
            line.quantity,
            available[line.materialCode] ?? 0,
            input.warehouseCode,
          );
        }
      }
      for (const line of input.lines) available[line.materialCode] -= line.quantity;
      posted.push({ input, options: opts });
      const ref = save(input);
      return { document: { id: ref.id, code: ref.code, status: 'POSTED' }, transactions: [] };
    }),
  };

  const store = {
    warehouse: { findByCode: jest.fn(async (_t: string, code: string) => (code === 'KHO-01' ? { code } : null)) },
    material: {
      findAnyByCode: jest.fn(async (_t: string, code: string) =>
        code.startsWith('VT-') || code.startsWith('SR-')
          ? ({ code, isSerialized: (options.serialized ?? ['SR-01']).includes(code) } as Material)
          : null,
      ),
    },
    inventory: {
      findByMaterialAndWarehouse: jest.fn(async (_t: string, code: string) => ({
        available: available[code] ?? 0,
      })),
    },
  };

  const installs: { code: string; key: string }[] = [];
  const inventory = {
    installItemForRequisition: jest.fn(
      async (
        _actor: InventoryActor,
        code: string,
        input: { quantity?: number },
        idempotency: { key: string; requestHash: string },
      ) => {
        available[code] -= input.quantity ?? 1;
        installs.push({ code, key: idempotency.key });
        const ref = save({
          docType: 'ISSUE_PROJECT',
          warehouseCode: 'KHO-01',
          sourceType: 'asset',
          sourceId: `unit-${code}`,
          idempotencyKey: idempotency.key,
          requestHash: idempotency.requestHash,
          createdBy: 'keeper-1',
          lines: [],
        });
        return { document: { id: ref.id, code: ref.code, status: 'POSTED' }, transactions: [] };
      },
    ),
  };

  const state: ProcedureInstanceState | null =
    options.state === undefined ? { instanceId: INSTANCE_ID, instanceCode: ORDER, status: 'completed' } : options.state;
  const procedures: ProcedureInstanceReader = { instanceState: jest.fn(async () => state) };

  const service = new RequisitionFulfilmentService(
    documents as unknown as StockDocumentStore,
    store as unknown as InventoryStore,
    inventory as unknown as InventoryApplication,
    procedures,
  );
  return { service, documents, posted, stored, available, installs, inventory, procedures };
}

const request = (patch: Partial<FulfilRequisitionRequest> = {}): FulfilRequisitionRequest => ({
  instanceId: INSTANCE_ID,
  warehouseCode: 'KHO-01',
  lines: [
    { materialCode: 'VT-01', quantity: 2 },
    { materialCode: 'VT-02', quantity: 1 },
  ],
  ...patch,
});

describe('RequisitionFulfilmentService.fulfil (ISS-BE-031)', () => {
  it('tạo MỘT chứng từ xuất nhiều dòng, nguồn hồ sơ Quy trình, khoá theo mã yêu cầu, ghi sổ thẳng', async () => {
    const { service, posted, procedures } = setup();
    const result = await service.fulfil(keeper, ORDER, request());

    expect(procedures.instanceState).toHaveBeenCalledWith('tenant-1', INSTANCE_ID);
    expect(posted).toHaveLength(1);
    expect(posted[0].input).toMatchObject({
      docType: 'ISSUE_PROJECT',
      sourceType: 'procedure_instance',
      sourceId: INSTANCE_ID,
      idempotencyKey: `procedure-requisition:${ORDER}`,
      warehouseCode: 'KHO-01',
    });
    expect(posted[0].input.lines).toHaveLength(2);
    expect(posted[0].options).toEqual({ origin: 'procedure_requisition' });
    expect(result).toMatchObject({ status: 'FULFILLED', mode: 'ISSUE', documentCode: 'PX-1', replayed: false });
  });

  it('gọi lại cùng mã cùng nội dung: trả chứng từ cũ, không ghi thêm, không hỏi lại Quy trình', async () => {
    const { service, posted, available, procedures } = setup();
    await service.fulfil(keeper, ORDER, request());
    const again = await service.fulfil(keeper, ORDER, request({ note: 'ghi chú khác không tính vào nội dung' }));

    expect(again).toMatchObject({ replayed: true, status: 'FULFILLED', documentCode: 'PX-1' });
    expect(posted).toHaveLength(1);
    expect(available['VT-01']).toBe(8);
    expect(procedures.instanceState).toHaveBeenCalledTimes(1);
  });

  it('cùng mã khác nội dung: 409 tiếng Việt', async () => {
    const { service } = setup();
    await service.fulfil(keeper, ORDER, request());
    await expect(
      service.fulfil(keeper, ORDER, request({ lines: [{ materialCode: 'VT-01', quantity: 3 }] })),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      message: expect.stringContaining('đã dùng cho một yêu cầu có nội dung khác'),
    });
  });

  it('một dòng thiếu tồn: 400, không dòng nào được ghi', async () => {
    const { service, posted, available } = setup({ available: { 'VT-01': 10, 'VT-02': 0 } });
    await expect(service.fulfil(keeper, ORDER, request())).rejects.toMatchObject({
      statusCode: 400,
      code: 'INSUFFICIENT_STOCK',
      message: expect.stringContaining('chưa ghi dòng nào'),
    });
    expect(posted).toHaveLength(0);
    expect(available['VT-01']).toBe(10);
  });

  it('thiếu tồn phát hiện lúc ghi sổ (tồn đổi giữa chừng) vẫn là 400, không ghi gì', async () => {
    const { service, documents, posted } = setup();
    documents.createAndPost.mockRejectedValueOnce(new InsufficientAvailableStockError('VT-02', 1, 0, 'KHO-01'));
    await expect(service.fulfil(keeper, ORDER, request())).rejects.toMatchObject({
      statusCode: 400,
      code: 'INSUFFICIENT_STOCK',
    });
    expect(posted).toHaveLength(0);
  });

  it.each([
    ['running', 409, 'PROCEDURE_NOT_APPROVED', 'chưa được duyệt xong'],
    ['cancelled', 409, 'PROCEDURE_CLOSED', 'đã bị huỷ'],
    ['rejected', 409, 'PROCEDURE_CLOSED', 'đã bị từ chối'],
    ['reversed', 409, 'PROCEDURE_CLOSED', 'huỷ hiệu lực'],
  ])('hồ sơ Quy trình %s: %s, không ghi gì', async (status, statusCode, code, message) => {
    const { service, posted } = setup({ state: { instanceId: INSTANCE_ID, instanceCode: ORDER, status } });
    await expect(service.fulfil(keeper, ORDER, request())).rejects.toMatchObject({
      statusCode,
      code,
      message: expect.stringContaining(message),
    });
    expect(posted).toHaveLength(0);
  });

  it('hồ sơ Quy trình không tồn tại: 404; hồ sơ khác mã yêu cầu: 409', async () => {
    const missing = setup({ state: null });
    await expect(missing.service.fulfil(keeper, ORDER, request())).rejects.toMatchObject({
      statusCode: 404,
      code: 'PROCEDURE_INSTANCE_NOT_FOUND',
    });
    const other = setup({ state: { instanceId: INSTANCE_ID, instanceCode: 'PR-KHAC', status: 'completed' } });
    await expect(other.service.fulfil(keeper, ORDER, request())).rejects.toMatchObject({
      statusCode: 409,
      code: 'PROCEDURE_INSTANCE_MISMATCH',
    });
    expect(missing.posted).toHaveLength(0);
    expect(other.posted).toHaveLength(0);
  });

  it('hàng theo serial phải gửi đủ serial (ISS-BE-005); đủ thì serial đi vào dòng chứng từ', async () => {
    const { service, posted } = setup();
    await expect(
      service.fulfil(keeper, ORDER, request({ lines: [{ materialCode: 'SR-01', quantity: 2 }] })),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SERIALS_REQUIRED' });
    expect(posted).toHaveLength(0);

    await service.fulfil(
      keeper,
      ORDER,
      request({ lines: [{ materialCode: 'SR-01', quantity: 2, serials: ['S-1', 'S-2'] }] }),
    );
    expect(posted[0].input.lines[0]).toMatchObject({ materialCode: 'SR-01', serials: ['S-1', 'S-2'] });
  });

  it('không có quyền ghi phát sinh: 403', async () => {
    const { service } = setup();
    await expect(
      service.fulfil({ ...keeper, canWriteTransactions: false }, ORDER, request()),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('kiểm đầu vào: mã yêu cầu, mã hồ sơ, kho, dòng', async () => {
    const { service } = setup();
    await expect(service.fulfil(keeper, 'mã có dấu cách', request())).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.fulfil(keeper, ORDER, request({ instanceId: 'abc' }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.fulfil(keeper, ORDER, request({ lines: [] }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.fulfil(keeper, ORDER, request({ lines: [{ materialCode: 'VT-01', quantity: 0 }] })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.fulfil(keeper, ORDER, request({ warehouseCode: 'KHO-X' }))).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('lắp vào thiết bị: từng dòng qua luồng lắp, cùng tiền tố khoá; gọi lại không lắp thêm', async () => {
    const { service, installs, posted, inventory } = setup();
    const result = await service.fulfil(keeper, ORDER, request({ assetCode: 'TB-01' }));

    expect(posted).toHaveLength(0);
    expect(installs).toEqual([
      { code: 'VT-01', key: `procedure-requisition:${ORDER}:install:1/2` },
      { code: 'VT-02', key: `procedure-requisition:${ORDER}:install:2/2` },
    ]);
    expect(inventory.installItemForRequisition.mock.calls[0][2]).toMatchObject({
      warehouseCode: 'KHO-01',
      parentCode: 'TB-01',
      quantity: 2,
    });
    expect(result).toMatchObject({ mode: 'INSTALL', status: 'FULFILLED', replayed: false });
    expect(result.documents).toHaveLength(2);

    const again = await service.fulfil(keeper, ORDER, request({ assetCode: 'TB-01' }));
    expect(again).toMatchObject({ replayed: true, status: 'FULFILLED' });
    expect(installs).toHaveLength(2);
  });

  it('đã xuất tiêu hao rồi đổi sang lắp thiết bị (hoặc ngược lại): 409, không ghi thêm', async () => {
    const { service, installs } = setup();
    await service.fulfil(keeper, ORDER, request());
    await expect(service.fulfil(keeper, ORDER, request({ assetCode: 'TB-01' }))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(installs).toHaveLength(0);
  });

  it('lắp dở dang (một dòng đã lắp): gọi lại cùng nội dung chỉ lắp nốt dòng còn lại', async () => {
    const { service, installs, inventory } = setup();
    const install = inventory.installItemForRequisition.getMockImplementation();
    if (!install) throw new Error('thiếu mock lắp');
    // Lần đầu: dòng 1 lắp xong, dòng 2 lỗi giữa chừng.
    inventory.installItemForRequisition
      .mockImplementationOnce(install)
      .mockRejectedValueOnce(new Error('mất kết nối'));
    await expect(service.fulfil(keeper, ORDER, request({ assetCode: 'TB-01' }))).rejects.toThrow('mất kết nối');
    expect((await service.status(keeper, [ORDER])).items[0]).toMatchObject({ status: 'PARTIAL' });

    installs.length = 0;
    const result = await service.fulfil(keeper, ORDER, request({ assetCode: 'TB-01' }));
    expect(installs.map((item) => item.key)).toEqual([requisitionInstallKey(ORDER, 1, 2)]);
    expect(result).toMatchObject({ status: 'FULFILLED', replayed: false });
  });
});

describe('RequisitionFulfilmentService.status', () => {
  it('mã đã cấp trả FULFILLED kèm mã chứng từ; mã chưa cấp trả OPEN', async () => {
    const { service } = setup();
    await service.fulfil(keeper, ORDER, request());
    const result = await service.status(keeper, [ORDER, 'PR-CHUA-CAP', ORDER, ' ']);
    expect(result.items).toEqual([
      { orderCode: ORDER, status: 'FULFILLED', documentCode: 'PX-1', documentCodes: ['PX-1'] },
      { orderCode: 'PR-CHUA-CAP', status: 'OPEN', documentCodes: [] },
    ]);
  });

  it('giới hạn số mã mỗi lần hỏi', async () => {
    const { service } = setup();
    const codes = Array.from({ length: 201 }, (_, index) => `PR-${index}`);
    await expect(service.status(keeper, codes)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('requisitionStatus', () => {
  const ref = (key: string, code: string, status: IdempotentDocumentRef['status'] = 'POSTED'): IdempotentDocumentRef => ({
    id: code,
    code,
    status,
    idempotencyKey: key,
  });

  it('lắp thiết bị: đủ số dòng mới là đã cấp, thiếu là cấp dở', () => {
    expect(requisitionStatus(ORDER, [ref(requisitionInstallKey(ORDER, 0, 2), 'PX-1')])).toMatchObject({
      status: 'PARTIAL',
    });
    expect(
      requisitionStatus(ORDER, [
        ref(requisitionInstallKey(ORDER, 0, 2), 'PX-1'),
        ref(requisitionInstallKey(ORDER, 1, 2), 'PX-2'),
      ]),
    ).toEqual({ orderCode: ORDER, status: 'FULFILLED', documentCode: 'PX-1', documentCodes: ['PX-1', 'PX-2'] });
  });

  it('chứng từ chưa ghi sổ không tính là đã cấp', () => {
    expect(requisitionStatus(ORDER, [ref(`procedure-requisition:${ORDER}`, 'PX-1', 'PENDING')])).toMatchObject({
      status: 'OPEN',
    });
  });
});
