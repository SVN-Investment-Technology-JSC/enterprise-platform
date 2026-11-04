import type { InventoryTransaction, PostedStockDocument } from '@enterprise-platform/contracts-inventory';
import { InventoryApplication, type InventoryActor } from './inventory.application.js';
import type { InventoryStore } from './inventory-store.port.js';
import type { NewStockDocumentInput, PostOptions, StockDocumentStore } from './stock-document-store.port.js';

const actor: InventoryActor = {
  tenantId: 't1',
  userId: 'u1',
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
  createdBy: 'u1',
  createdAt: new Date(0).toISOString(),
  documentId: 'doc',
});

function setup(transactions: InventoryTransaction[] = []) {
  const calls: { input: NewStockDocumentInput; options?: PostOptions }[] = [];
  const documents = {
    createAndPost: jest.fn(
      async (_tenantId: string, input: NewStockDocumentInput, _by: string, options?: PostOptions) => {
        calls.push({ input, options });
        return { document: {}, transactions } as unknown as PostedStockDocument;
      },
    ),
  } as unknown as StockDocumentStore;
  return { app: new InventoryApplication({} as InventoryStore, documents), calls, documents };
}

const line = { warehouseCode: 'A', materialCode: 'M1', quantity: 3 };

describe('InventoryApplication phiếu nhập/xuất nhiều dòng', () => {
  it('phiếu nhập là MỘT chứng từ nhập nhiều dòng, dòng cộng tồn kèm đơn giá', async () => {
    const { app, calls } = setup([ledger('T1', 3), ledger('T2', 4)]);

    const result = await app.recordMovementLines(actor, {
      kind: 'receipt',
      lines: [{ ...line, unitCost: 5 }, { ...line, materialCode: 'M2', quantity: 4, unitCost: 7 }],
    });

    expect(result).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toMatchObject({ docType: 'RECEIPT_OTHER', warehouseCode: 'A', createdBy: 'u1' });
    expect(calls[0].input.lines).toEqual([
      { materialCode: 'M1', quantity: 3, direction: 'IN', unitCost: 5 },
      { materialCode: 'M2', quantity: 4, direction: 'IN', unitCost: 7 },
    ]);
  });

  it('phiếu xuất ghi chiều OUT, giá vốn do kho tính nên không gửi đơn giá', async () => {
    const { app, calls } = setup([ledger('T1', -3)]);

    await app.recordMovementLines(actor, { kind: 'issue', lines: [{ ...line, unitCost: 99 }] });

    expect(calls[0].input.docType).toBe('ISSUE_OTHER');
    expect(calls[0].input.lines[0]).toMatchObject({ direction: 'OUT', unitCost: 0 });
  });

  it('ghi chú các dòng gộp thành ghi chú chứng từ, bỏ trùng', async () => {
    const { app, calls } = setup();

    await app.recordMovementLines(actor, {
      kind: 'receipt',
      lines: [
        { ...line, note: 'Đợt 1' },
        { ...line, materialCode: 'M2', note: 'Đợt 1' },
        { ...line, materialCode: 'M3', note: 'Đợt 2' },
      ],
    });

    expect(calls[0].input.note).toBe('Đợt 1 ; Đợt 2');
  });

  it('đối tác nhập/xuất được chuẩn hoá và chuyển xuống để ghi lên dòng sổ cái', async () => {
    const { app, calls } = setup();

    await app.recordMovementLines(actor, {
      kind: 'receipt',
      counterparty: { type: 'SUPPLIER', name: '  Công ty A  ', documentNumber: ' HD-01 ' },
      lines: [line],
    });

    expect(calls[0].options?.counterparty).toEqual({
      type: 'SUPPLIER',
      name: 'Công ty A',
      address: undefined,
      documentNumber: 'HD-01',
    });
  });

  it.each([
    ['loại không hợp lệ', { type: 'UNKNOWN', name: 'X' }],
    ['loại WAREHOUSE do hệ thống tự gán', { type: 'WAREHOUSE', name: 'X' }],
    ['thiếu tên', { type: 'SUPPLIER', name: '   ' }],
  ])('đối tác %s bị từ chối trước khi ghi sổ', async (_label, counterparty) => {
    const { app, documents } = setup();

    await expect(
      app.recordMovementLines(actor, {
        kind: 'receipt',
        counterparty: counterparty as never,
        lines: [line],
      }),
    ).rejects.toThrow();
    expect(documents.createAndPost).not.toHaveBeenCalled();
  });

  it('một phiếu chỉ được thực hiện trong một kho', async () => {
    const { app, documents } = setup();

    await expect(
      app.recordMovementLines(actor, {
        kind: 'receipt',
        lines: [line, { ...line, warehouseCode: 'B' }],
      }),
    ).rejects.toThrow('Một phiếu chỉ được thực hiện trong một kho.');
    expect(documents.createAndPost).not.toHaveBeenCalled();
  });

  it('phiếu rỗng hoặc dòng có số lượng không dương bị từ chối', async () => {
    const { app, documents } = setup();

    await expect(app.recordMovementLines(actor, { kind: 'issue', lines: [] })).rejects.toThrow(
      'Phiếu phải có ít nhất một dòng.',
    );
    await expect(
      app.recordMovementLines(actor, { kind: 'issue', lines: [{ ...line, quantity: 0 }] }),
    ).rejects.toThrow();
    expect(documents.createAndPost).not.toHaveBeenCalled();
  });

  it('người không có quyền ghi phát sinh tồn kho bị từ chối', async () => {
    const { app, documents } = setup();

    await expect(
      app.recordMovementLines({ ...actor, canWriteTransactions: false }, { kind: 'receipt', lines: [line] }),
    ).rejects.toThrow();
    expect(documents.createAndPost).not.toHaveBeenCalled();
  });
});
