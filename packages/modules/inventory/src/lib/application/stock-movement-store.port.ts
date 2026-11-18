import type {
  StockDocumentStatus,
  StockDocumentType,
  StockMovementEntry,
  StockMovementKind,
} from '@enterprise-platform/contracts-inventory';

/** Bộ lọc danh sách gộp, đã kiểm và chuẩn hoá ở tầng application. */
export interface MovementListFilter {
  readonly search?: string;
  readonly kind?: StockMovementKind;
  readonly docType?: StockDocumentType;
  readonly status?: StockDocumentStatus;
  readonly warehouseCode?: string;
  readonly sourceType?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface MovementListResult {
  readonly rows: StockMovementEntry[];
  readonly total: number;
  readonly pendingCount: number;
}

/**
 * Danh sách gộp xuất/nhập kho: chứng từ kho và bút toán cũ chưa có chứng từ.
 * Chỉ đọc; gộp, sắp xếp và phân trang ở SQL để tổng và trang luôn khớp nhau.
 */
export interface StockMovementStore {
  list(tenantId: string, filter: MovementListFilter): Promise<MovementListResult>;
}

export const STOCK_MOVEMENT_STORE = 'STOCK_MOVEMENT_STORE';
