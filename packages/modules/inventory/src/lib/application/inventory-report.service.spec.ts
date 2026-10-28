import type { InventoryActor } from './inventory.application.js';
import type { InventoryReportStore } from './inventory-report-store.port.js';
import { InventoryReportService } from './inventory-report.service.js';

const actor: InventoryActor = {
  tenantId: 'tenant',
  userId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Người xem',
  canManage: false,
  canWriteTransactions: false,
};

function fakeStore(): jest.Mocked<InventoryReportStore> {
  const emptyQuantities = { onHand: 0, reserved: 0, blocked: 0, available: 0 };
  // Hàm giả không khai tham số; ép kiểu một lần ở đây để test đọc `mock.calls` theo đúng port.
  return {
    stockByWarehouse: jest.fn(async () => ({ rows: [], total: 0, totals: { ...emptyQuantities, stockValue: 0 } })),
    stockByLot: jest.fn(async () => ({ rows: [], total: 0, totals: emptyQuantities })),
    stockBySerial: jest.fn(async () => ({
      rows: [],
      total: 0,
      totals: { serials: 0, inStock: 0, blocked: 0, available: 0 },
    })),
    movementGroups: jest.fn(async () => [
      {
        docType: 'RECEIPT_PURCHASE' as const,
        isReversal: false,
        ledgerType: 'IMPORT' as const,
        warehouseCode: 'KHO-A',
        warehouseName: 'Kho A',
        quantityIn: 5,
        quantityOut: 0,
        valueIn: 500,
        valueOut: 0,
        entries: 1,
      },
      {
        docType: 'ADJUSTMENT' as const,
        isReversal: false,
        ledgerType: 'ADJUST' as const,
        warehouseCode: 'KHO-A',
        warehouseName: 'Kho A',
        quantityIn: 0,
        quantityOut: 1,
        valueIn: 0,
        valueOut: 100,
        entries: 1,
      },
    ]),
    movementLines: jest.fn(async () => ({
      rows: [
        {
          transactionId: 't1',
          transactionCode: 'TXN-1',
          postedAt: '2026-10-02T03:00:00.000Z',
          ledgerType: 'EXPORT' as const,
          isReversal: true,
          docType: 'RECEIPT_PURCHASE' as const,
          warehouseCode: 'KHO-A',
          warehouseName: 'Kho A',
          materialCode: 'VT',
          materialName: 'Vật tư',
          quantity: -1,
          unitCost: 100,
          value: 100,
          createdBy: actor.userId,
        },
      ],
      total: 1,
    })),
    approvals: jest.fn(async () => ({ rows: [], total: 0 })),
  } as unknown as jest.Mocked<InventoryReportStore>;
}

describe('InventoryReportService', () => {
  it('báo cáo tồn mặc định theo kho, serial mặc định chỉ Trong kho', async () => {
    const store = fakeStore();
    const service = new InventoryReportService(store, () => '2026-10-28');
    const byWarehouse = await service.stock(actor, {});
    expect(byWarehouse).toMatchObject({ groupBy: 'WAREHOUSE', limit: 50, offset: 0 });
    await service.stock(actor, { groupBy: 'SERIAL' });
    expect(store.stockBySerial.mock.calls[0][1]).toMatchObject({ stockState: 'IN_STOCK', today: '2026-10-28' });
    await service.stock(actor, { groupBy: 'SERIAL', stockState: 'ALL' });
    expect(store.stockBySerial.mock.calls[1][1]).toMatchObject({ stockState: null });
  });

  it('kiểm tham số: hạn dùng chỉ cho lô, nhóm vật tư hợp lệ', async () => {
    const service = new InventoryReportService(fakeStore(), () => '2026-10-28');
    await expect(service.stock(actor, { groupBy: 'WAREHOUSE', expiringWithinDays: 30 })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(service.stock(actor, { groupBy: 'LOT', expiringWithinDays: 30 })).resolves.toMatchObject({
      groupBy: 'LOT',
    });
    await expect(
      service.stock(actor, { category: 'NOPE' as unknown as 'TOOL' }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Nhóm vật tư không hợp lệ.' });
    await expect(
      service.stock(actor, { groupBy: 'BAD' as unknown as 'LOT' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('báo cáo nhập xuất gắn nhóm cho bút toán và lọc nhóm trên tổng', async () => {
    const store = fakeStore();
    const service = new InventoryReportService(store, () => '2026-10-28');
    const report = await service.movements(actor, {});
    expect(report).toMatchObject({ fromDate: '2026-10-01', toDate: '2026-10-28', total: 1 });
    expect(report.lines[0]).toMatchObject({ category: 'REVERSAL', transactionCode: 'TXN-1' });
    expect(report.lines[0]).not.toHaveProperty('isReversal');
    expect(report.totals).toMatchObject({ quantityIn: 5, quantityOut: 1, entries: 2 });

    const adjustments = await service.movements(actor, { category: 'ADJUSTMENT' });
    expect(adjustments.totals).toMatchObject({ quantityIn: 0, quantityOut: 1, valueOut: 100 });
    expect(store.movementLines.mock.calls[1][1]).toMatchObject({ category: 'ADJUSTMENT' });
    await expect(service.movements(actor, { category: 'X' as unknown as 'ISSUE' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('lịch sử duyệt chỉ nhận loại chứng từ phải duyệt', async () => {
    const store = fakeStore();
    const service = new InventoryReportService(store, () => '2026-10-28');
    await service.approvals(actor, {});
    expect(store.approvals.mock.calls[0][1].docTypes).toEqual(['RECEIPT_OTHER', 'ISSUE_OTHER', 'ADJUSTMENT']);
    await expect(service.approvals(actor, { docType: 'RECEIPT_PURCHASE' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
