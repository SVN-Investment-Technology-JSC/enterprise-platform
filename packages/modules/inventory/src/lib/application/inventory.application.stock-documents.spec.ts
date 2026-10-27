import type { InventoryTransaction, PostedStockDocument } from '@enterprise-platform/contracts-inventory';
import { InsufficientAvailableStockError } from '../domain/inventory.error.js';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { NewStockDocumentInput, StockDocumentStore } from './stock-document-store.port.js';

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
  const app = new InventoryApplication({} as InventoryStore, documents);
  return { app, calls };
}

const posted = (...transactions: InventoryTransaction[]) => async () =>
  ({ document: {} as PostedStockDocument['document'], transactions }) as PostedStockDocument;

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
    expect(result.transactionCode).toBe('TXN-1');
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
      app.issueStock(actor, { warehouseCode: 'KHO', materialCode: 'VT', quantity: 10 }),
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
