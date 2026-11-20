import {
  isPendingStockMovement,
  type InventoryTransaction,
  type PostedStockDocument,
} from '@enterprise-platform/contracts-inventory';
import { InsufficientAvailableStockError } from '../domain/inventory.error.js';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { NewStockDocumentInput, StockDocumentStore } from './stock-document-store.port.js';

/** Danh mục giả: mã bắt đầu bằng `SR` theo dõi serial, mã khác là hàng thường. */
const catalog = {
  material: {
    findAnyByCode: jest.fn(async (_tenantId: string, code: string) =>
      ({ code, kind: 'STOCK', isSerialized: code.startsWith('SR') }),
    ),
  },
} as unknown as InventoryStore;

const actor: InventoryActor = {
  tenantId: 'tenant',
  userId: 'user',
  displayName: 'Thủ kho',
  canManage: false,
  canWriteTransactions: true,
};

const ledger = (code: string, quantity: number): InventoryTransaction => ({
  id: `id-${code}`,
  transactionCode: code,
  warehouseId: 'w',
  materialId: 'm',
  type: quantity > 0 ? 'IMPORT' : 'EXPORT',
  quantity,
  unitCost: 0,
  workflowStatus: 'APPROVED',
  createdBy: 'user',
  createdAt: new Date(0).toISOString(),
  documentId: 'doc',
});

function setup(result: () => Promise<PostedStockDocument>) {
  const calls: NewStockDocumentInput[] = [];
  const documents = {
    createAndPost: jest.fn(async (_tenantId: string, input: NewStockDocumentInput) => {
      calls.push(input);
      return result();
    }),
  } as unknown as StockDocumentStore;
  const app = new InventoryApplication(catalog, documents);
  return { app, calls };
}

const posted = (...transactions: InventoryTransaction[]) => async () =>
  ({ document: { status: 'POSTED' } as PostedStockDocument['document'], transactions }) as PostedStockDocument;

const pending = async () =>
  ({
    document: { id: 'doc-1', code: 'PN-1', status: 'PENDING' } as PostedStockDocument['document'],
    transactions: [],
  }) as PostedStockDocument;

describe('API cũ nhập, xuất, điều chuyển ghi qua chứng từ kho (T1-06)', () => {
  it('nhập kho: chứng từ nhập theo đơn mua một dòng, trả đúng bút toán như cũ', async () => {
    const { app, calls } = setup(posted(ledger('TXN-1', 5)));
    const result = await app.receiveStock(actor, {
      warehouseCode: 'KHO',
      materialCode: 'VT',
      quantity: 5,
      unitCost: 1000,
      referenceType: 'asset',
      referenceId: '6f1c1d36-8a43-4a51-9d6e-0d0b8d1f4a10',
      note: 'Tồn đầu kỳ',
    });
    expect(isPendingStockMovement(result)).toBe(false);
    expect((result as InventoryTransaction).transactionCode).toBe('TXN-1');
    expect(calls[0]).toMatchObject({
      docType: 'RECEIPT_PURCHASE',
      warehouseCode: 'KHO',
      sourceType: 'asset',
      sourceId: '6f1c1d36-8a43-4a51-9d6e-0d0b8d1f4a10',
      note: 'Tồn đầu kỳ',
      lines: [{ materialCode: 'VT', quantity: 5, direction: 'IN', unitCost: 1000 }],
    });
  });

  it('xuất kho thiếu tồn khả dụng vẫn trả 400 INSUFFICIENT_STOCK như cũ', async () => {
    const { app } = setup(async () => {
      throw new InsufficientAvailableStockError('VT', 10, 3, 'KHO');
    });
    await expect(
      app.issueStock(actor, {
        warehouseCode: 'KHO',
        materialCode: 'VT',
        quantity: 10,
        referenceType: 'project',
        referenceId: '6f1c1d36-8a43-4a51-9d6e-0d0b8d1f4a10',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INSUFFICIENT_STOCK',
      message: 'Kho KHO chỉ còn 3 VT, không đủ cho 10.',
    });
  });

  it('điều chuyển: một chứng từ TRANSFER, trả hai vế out và in', async () => {
    const { app, calls } = setup(posted(ledger('TXN-OUT', -2), ledger('TXN-IN', 2)));
    const moved = await app.transferStock(actor, {
      fromWarehouseCode: 'A',
      toWarehouseCode: 'B',
      materialCode: 'VT',
      quantity: 2,
    });
    expect([moved.out.transactionCode, moved.in.transactionCode]).toEqual(['TXN-OUT', 'TXN-IN']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      docType: 'TRANSFER',
      warehouseCode: 'A',
      targetWarehouseCode: 'B',
      lines: [{ direction: 'OUT', quantity: 2 }],
    });
  });

  it('nhập mua, xuất dự án không nguồn: chứng từ Chờ duyệt, không bút toán (ISS-BE-006)', async () => {
    const { app, calls } = setup(pending);
    const receipt = await app.receiveStock(actor, { warehouseCode: 'KHO', materialCode: 'VT', quantity: 5 });
    expect(receipt).toEqual({
      document: expect.objectContaining({ code: 'PN-1', status: 'PENDING' }),
      transactions: [],
      pendingApproval: true,
    });
    const issue = await app.issueStock(actor, { warehouseCode: 'KHO', materialCode: 'VT', quantity: 1 });
    expect(isPendingStockMovement(issue)).toBe(true);
    expect(calls.map((call) => [call.docType, call.sourceId])).toEqual([
      ['RECEIPT_PURCHASE', undefined],
      ['ISSUE_PROJECT', undefined],
    ]);
  });

  it('nguồn miễn duyệt chỉ do bên gọi trong tiến trình khai, không lấy từ thân request', async () => {
    const options: unknown[] = [];
    const documents = {
      createAndPost: jest.fn(async (_t: string, _input: NewStockDocumentInput, _by: string, opts: unknown) => {
        options.push(opts);
        return posted(ledger('TXN-1', 5))();
      }),
    } as unknown as StockDocumentStore;
    const app = new InventoryApplication(catalog, documents);
    const body = { warehouseCode: 'KHO', materialCode: 'VT', quantity: 5, origin: 'opening_balance' };
    await app.receiveStock(actor, body);
    await app.receiveStock(actor, { ...body, referenceType: 'OPENING_BALANCE' }, { origin: 'opening_balance' });
    expect(options).toEqual([
      expect.objectContaining({ origin: undefined }),
      expect.objectContaining({ origin: 'opening_balance' }),
    ]);
  });

  it('hàng serial: nhập, xuất, chuyển thiếu serial hoặc số lượng lẻ thì 400 trước khi tạo chứng từ (ISS-BE-005)', async () => {
    const { app, calls } = setup(posted(ledger('TXN-1', 1), ledger('TXN-2', 1)));
    const source = { referenceType: 'purchase_order', referenceId: '6f1c1d36-8a43-4a51-9d6e-0d0b8d1f4a10' };
    await expect(
      app.receiveStock(actor, { ...source, warehouseCode: 'KHO', materialCode: 'SR-1', quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SERIALS_REQUIRED' });
    await expect(
      app.issueStock(actor, { ...source, warehouseCode: 'KHO', materialCode: 'SR-1', quantity: 2, serials: ['A'] }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      app.transferStock(actor, { fromWarehouseCode: 'A', toWarehouseCode: 'B', materialCode: 'SR-1', quantity: 1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SERIALS_REQUIRED' });
    await expect(
      app.receiveStock(actor, { ...source, warehouseCode: 'KHO', materialCode: 'SR-1', quantity: 1.5 }),
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('phải có số lượng nguyên') });
    expect(calls).toHaveLength(0);

    await app.issueStock(actor, { ...source, warehouseCode: 'KHO', materialCode: 'SR-1', quantity: 1, serials: [' SN-1 '] });
    await app.transferStock(actor, {
      fromWarehouseCode: 'A',
      toWarehouseCode: 'B',
      materialCode: 'SR-1',
      quantity: 1,
      serials: ['SN-2'],
    });
    expect(calls.map((call) => call.lines)).toEqual([
      [{ materialCode: 'SR-1', quantity: 1, direction: 'OUT', unitCost: 0, serials: ['SN-1'] }],
      [{ materialCode: 'SR-1', quantity: 1, direction: 'OUT', unitCost: 0, serials: ['SN-2'] }],
    ]);
    await expect(
      app.issueStock(actor, {
        ...source,
        warehouseCode: 'KHO',
        materialCode: 'SR-1',
        quantity: 1,
        serials: ['SN-1'],
        lots: [{ lotNo: 'L1', quantity: 1 }],
      }),
    ).rejects.toThrow('Dòng 1: một dòng chỉ ghi lô hoặc serial, không ghi cả hai.');
  });

  it('giữ kiểm tra cũ: cùng kho, số lượng không dương, thiếu quyền', async () => {
    const { app, calls } = setup(posted());
    await expect(
      app.transferStock(actor, { fromWarehouseCode: 'A', toWarehouseCode: 'A', materialCode: 'VT', quantity: 1 }),
    ).rejects.toThrow('Kho nguồn và kho đích phải khác nhau.');
    await expect(
      app.receiveStock(actor, { warehouseCode: 'A', materialCode: 'VT', quantity: 0 }),
    ).rejects.toThrow('Số lượng phải là số dương.');
    await expect(
      app.issueStock({ ...actor, canWriteTransactions: false }, { warehouseCode: 'A', materialCode: 'VT', quantity: 1 }),
    ).rejects.toThrow('Bạn không có quyền ghi phát sinh tồn kho.');
    expect(calls).toHaveLength(0);
  });
});
