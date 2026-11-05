import type { StockDocument } from '@enterprise-platform/contracts-inventory';
import { stockDocumentPostedEvent } from './inventory-stock-events.js';

const document: StockDocument = {
  id: 'doc-1',
  code: 'PX-1',
  docType: 'ISSUE_SALES',
  status: 'APPROVED',
  warehouseId: 'w-1',
  warehouseCode: 'QA-KHO',
  sourceType: 'crm_delivery',
  sourceId: 'order-1',
  documentDate: '2026-10-27',
  createdBy: 'u-1',
  createdAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
  lines: [
    {
      id: 'l-1',
      lineNo: 1,
      materialId: 'm-1',
      materialCode: 'QA-KHO-MAY',
      materialName: 'Máy',
      quantity: 2,
      direction: 'OUT',
      unitCost: 0,
      serials: ['SN1', 'SN2'],
      reservationId: 'r-1',
    },
    {
      id: 'l-2',
      lineNo: 2,
      materialId: 'm-2',
      materialCode: 'QA-KHO-CAP',
      materialName: 'Cáp',
      quantity: 3,
      direction: 'OUT',
      unitCost: 0,
      lotId: 'lot-1',
      lotNo: 'L01',
    },
  ],
};

describe('sự kiện xuất kho, nhập trả (T1-27)', () => {
  const lineCosts = new Map([
    ['l-1', { unitCost: 5_000_000, costAmount: 10_000_000 }],
    ['l-2', { unitCost: 110_000.1234, costAmount: 330_000.37 }],
  ]);

  it('inventory.stock.issued mang dòng, serial, lô, giá vốn và các trường cũ theo dòng đầu', () => {
    const event = stockDocumentPostedEvent({
      kind: 'ISSUED',
      document,
      postedAt: '2026-10-27T01:00:00.000Z',
      firstTransactionCode: 'TXN-1',
      lineCosts,
      qualityStatus: 'PASSED',
      actorUserId: 'u-2',
    });
    expect(event).toMatchObject({ type: 'inventory.stock.issued', aggregateType: 'inventory-stock-document', aggregateId: 'doc-1' });
    expect(event.payload).toMatchObject({
      transactionCode: 'TXN-1',
      materialCode: 'QA-KHO-MAY',
      quantityIssued: 2,
      warehouseCode: 'QA-KHO',
      referenceType: 'crm_delivery',
      referenceId: 'order-1',
      documentCode: 'PX-1',
      sourceId: 'order-1',
      reversesDocumentId: null,
      totalCostAmount: 10_330_000.37,
      actorUserId: 'u-2',
    });
    expect(event.payload['qualityStatus']).toBeUndefined();
    expect(event.payload['lines']).toEqual([
      expect.objectContaining({ lineId: 'l-1', serials: ['SN1', 'SN2'], lotId: null, reservationId: 'r-1', costAmount: 10_000_000 }),
      expect.objectContaining({ lineId: 'l-2', serials: [], lotNo: 'L01', unitCost: 110_000.1234, sourceLineId: null }),
    ]);
  });

  it('inventory.stock.returned thêm trạng thái chất lượng hàng nhận về', () => {
    const event = stockDocumentPostedEvent({
      kind: 'RETURNED',
      document: { ...document, docType: 'RECEIPT_SALES_RETURN' },
      postedAt: '2026-10-27T01:00:00.000Z',
      firstTransactionCode: 'TXN-1',
      lineCosts,
      qualityStatus: 'PENDING_INSPECTION',
      actorUserId: null,
    });
    expect(event.type).toBe('inventory.stock.returned');
    expect(event.payload).toMatchObject({ qualityStatus: 'PENDING_INSPECTION', actorUserId: null });
  });
});
