import {
  INVENTORY_STOCK_ISSUED_EVENT,
  INVENTORY_STOCK_RETURNED_EVENT,
  type InventoryStockEventLine,
  type InventoryStockIssuedPayload,
  type InventoryStockReturnedPayload,
  type QualityStatus,
  type StockDocument,
} from '@enterprise-platform/contracts-inventory';
import type { InventoryNotificationEvent } from './inventory-notification-events.js';

const AGGREGATE_TYPE = 'inventory-stock-document';
const round2 = (value: number): number => Math.round(value * 100) / 100;

export interface StockDocumentPostedEventInput {
  readonly kind: 'ISSUED' | 'RETURNED';
  /** Chứng từ như lúc khoá để ghi sổ (dòng, serial, lô đã chốt). */
  readonly document: StockDocument;
  readonly postedAt: string;
  readonly firstTransactionCode: string;
  /** Giá vốn từng dòng vừa tính khi ghi sổ, theo id dòng. */
  readonly lineCosts: ReadonlyMap<string, { readonly unitCost: number; readonly costAmount: number }>;
  readonly qualityStatus: QualityStatus;
  readonly actorUserId: string | null;
}

/**
 * `inventory.stock.issued` cho chứng từ xuất, `inventory.stock.returned` cho nhập
 * trả hàng bán (T1-27). Ghi bằng `writeInventoryOutbox` như sự kiện giữ hàng, trong
 * transaction ghi sổ.
 */
export function stockDocumentPostedEvent(input: StockDocumentPostedEventInput): InventoryNotificationEvent {
  const { document } = input;
  const lines: InventoryStockEventLine[] = document.lines.map((line) => {
    const cost = input.lineCosts.get(line.id) ?? { unitCost: line.unitCost, costAmount: line.costAmount ?? 0 };
    return {
      lineId: line.id,
      lineNo: line.lineNo,
      materialId: line.materialId,
      materialCode: line.materialCode,
      direction: line.direction,
      quantity: line.quantity,
      unitCost: cost.unitCost,
      costAmount: cost.costAmount,
      lotId: line.lotId ?? null,
      lotNo: line.lotNo ?? null,
      serials: line.serials ?? [],
      reservationId: line.reservationId ?? null,
      sourceLineId: line.sourceLineId ?? null,
    };
  });
  const issued: InventoryStockIssuedPayload = {
    transactionCode: input.firstTransactionCode,
    materialCode: lines[0]?.materialCode ?? '',
    quantityIssued: lines[0]?.quantity ?? 0,
    warehouseCode: document.warehouseCode,
    referenceType: document.sourceType,
    referenceId: document.sourceId,
    documentId: document.id,
    documentCode: document.code,
    docType: document.docType,
    sourceType: document.sourceType ?? null,
    sourceId: document.sourceId ?? null,
    warehouseId: document.warehouseId,
    reversesDocumentId: document.reversesDocumentId ?? null,
    postedAt: input.postedAt,
    lines,
    totalCostAmount: round2(lines.reduce((sum, line) => sum + line.costAmount, 0)),
    actorUserId: input.actorUserId,
  };
  if (input.kind === 'RETURNED') {
    const payload: InventoryStockReturnedPayload = { ...issued, qualityStatus: input.qualityStatus };
    return {
      type: INVENTORY_STOCK_RETURNED_EVENT,
      aggregateType: AGGREGATE_TYPE,
      aggregateId: document.id,
      payload: { ...payload },
    };
  }
  return {
    type: INVENTORY_STOCK_ISSUED_EVENT,
    aggregateType: AGGREGATE_TYPE,
    aggregateId: document.id,
    payload: { ...issued },
  };
}
