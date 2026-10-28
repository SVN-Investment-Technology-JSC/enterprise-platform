import type {
  MaterialCategory,
  QualityStatus,
  SerialReportTotals,
  SerialStockState,
  StockApprovalReportRow,
  StockDocumentStatus,
  StockDocumentType,
  StockMovementCategory,
  StockMovementLine,
  StockReportLotRow,
  StockReportSerialRow,
  StockReportTotals,
  StockReportWarehouseRow,
} from '@enterprise-platform/contracts-inventory';
import type { MovementGroup, MovementKey } from '../domain/inventory-report.js';

/** Bộ lọc báo cáo tồn đã kiểm ở service. */
export interface StockReportFilter {
  readonly search?: string;
  readonly materialCode?: string;
  readonly category?: MaterialCategory;
  readonly warehouseCode?: string;
  /** Chỉ báo cáo theo lô: hạn dùng trước hoặc bằng `today` + số ngày này. */
  readonly expiringWithinDays?: number;
  readonly qualityStatus?: QualityStatus;
  /** Chỉ báo cáo serial; null là mọi trạng thái. */
  readonly stockState?: SerialStockState | null;
  readonly includeZero: boolean;
  /** Hôm nay theo giờ Việt Nam (YYYY-MM-DD). */
  readonly today: string;
}

export interface ReportPaging {
  readonly limit: number;
  readonly offset: number;
}

export interface ReportPage<TRow, TTotals> {
  readonly rows: readonly TRow[];
  readonly total: number;
  readonly totals: TTotals;
}

export interface StockMovementFilter {
  readonly fromDate: string;
  readonly toDate: string;
  readonly warehouseCode?: string;
  readonly docType?: StockDocumentType;
  readonly category?: StockMovementCategory;
  readonly search?: string;
}

/** Bút toán chi tiết trước khi service gắn nhóm nghiệp vụ. */
export type StockMovementLineRecord = Omit<StockMovementLine, 'category'> & MovementKey;

export interface StockApprovalFilter {
  readonly fromDate: string;
  readonly toDate: string;
  readonly warehouseCode?: string;
  readonly docTypes: readonly StockDocumentType[];
  readonly status?: StockDocumentStatus;
}

/** Truy vấn chỉ đọc cho báo cáo kho (T7-06, T7-07). */
export interface InventoryReportStore {
  stockByWarehouse(
    tenantId: string,
    filter: StockReportFilter,
    paging: ReportPaging,
  ): Promise<ReportPage<StockReportWarehouseRow, StockReportTotals>>;
  stockByLot(
    tenantId: string,
    filter: StockReportFilter,
    paging: ReportPaging,
  ): Promise<ReportPage<StockReportLotRow, StockReportTotals>>;
  stockBySerial(
    tenantId: string,
    filter: StockReportFilter,
    paging: ReportPaging,
  ): Promise<ReportPage<StockReportSerialRow, SerialReportTotals>>;
  movementGroups(tenantId: string, filter: StockMovementFilter): Promise<MovementGroup[]>;
  movementLines(
    tenantId: string,
    filter: StockMovementFilter,
    paging: ReportPaging,
  ): Promise<{ rows: StockMovementLineRecord[]; total: number }>;
  approvals(
    tenantId: string,
    filter: StockApprovalFilter,
    paging: ReportPaging,
  ): Promise<{ rows: StockApprovalReportRow[]; total: number }>;
}

export const INVENTORY_REPORT_STORE = 'INVENTORY_REPORT_STORE';
