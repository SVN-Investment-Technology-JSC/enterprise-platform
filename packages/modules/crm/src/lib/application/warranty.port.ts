import type {
  CrmPage,
  WarrantyCaseDetail,
  WarrantyCaseSummary,
  WarrantyCause,
  WarrantyCoverage,
  WarrantyDisposition,
  WarrantyDocumentKind,
  WarrantyDocumentStatus,
  WarrantyInspectionResult,
  WarrantyRemedy,
  WarrantySettings,
  WarrantyStatus,
} from '@enterprise-platform/contracts-crm';
import type { KeysetCursor } from '../domain/pagination.js';
import type { CrmDataScope } from './data-scope.js';

/**
 * Port của bảo hành, đổi trả (GĐ6): lưu trữ yêu cầu, Kho (tra serial, nhập
 * trả, đổi chất lượng, điều chuyển, xuất khác, xuất bảo hành) và sổ công nợ
 * (giảm trừ, hoàn tiền).
 */

export const CRM_WARRANTY_STORE = Symbol('CRM_WARRANTY_STORE');
export const CRM_WARRANTY_INVENTORY = Symbol('CRM_WARRANTY_INVENTORY');
export const CRM_WARRANTY_CREDIT = Symbol('CRM_WARRANTY_CREDIT');

/** `sourceType` Bán hàng gửi cho Kho với chứng từ của yêu cầu bảo hành. */
export const CRM_WARRANTY_SOURCE_TYPE = 'crm_warranty';

/** Thực thể ghi vào `audit_log`. */
export const WARRANTY_AUDIT_ENTITY = 'warranty_case';

// ---------------------------------------------------------------------------
// Lưu trữ
// ---------------------------------------------------------------------------

/**
 * Một serial (hoặc dòng đơn không theo serial) đã giao, đọc từ đợt giao đã
 * xuất kho của Bán hàng, hoặc từ dòng bảo hành đã xuất thay thế (Q9).
 */
export interface DeliveredItemRecord {
  readonly serial: string | null;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  /** Số đã giao (serial: 1). */
  readonly quantity: number;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  /** Người phụ trách đơn, hoặc của khách khi không có đơn. */
  readonly ownerUserId: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly orderLineId: string | null;
  readonly orderLineQuantity: number | null;
  readonly orderLineTotal: number | null;
  readonly contractId: string | null;
  readonly contractCode: string | null;
  /** Thời hạn bảo hành của hợp đồng (null: không ghi). */
  readonly contractWarrantyMonths: number | null;
  readonly deliveryCode: string | null;
  readonly warehouseCode: string | null;
  /** Thời điểm Kho ghi sổ xuất (ISO). */
  readonly deliveredAt: string | null;
  /** Serial là hàng thay thế của dòng bảo hành nào; hạn kế thừa đi kèm (Q9). */
  readonly replacementOf: {
    readonly caseId: string;
    readonly caseCode: string;
    readonly serial: string | null;
    readonly warrantyUntil: string | null;
  } | null;
}

export interface WarrantyCaseFilter {
  readonly q?: string;
  readonly status?: WarrantyStatus;
  readonly customerId?: string;
  readonly serial?: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface NewWarrantyLineRecord {
  readonly serial: string | null;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly orderId: string | null;
  readonly orderLineId: string | null;
  readonly deliveryWarehouseCode: string | null;
  readonly coverage: WarrantyCoverage;
}

export interface NewWarrantyCaseRecord {
  readonly customerId: string;
  readonly orderId: string | null;
  readonly contractId: string | null;
  readonly cause: WarrantyCause;
  readonly description: string | null;
  readonly ownerUserId: string;
  readonly assigneeUserId: string | null;
  readonly lines: readonly NewWarrantyLineRecord[];
}

/** Một chứng từ ghi lại (theo khoá chống lặp). */
export interface WarrantyDocumentRecord {
  readonly lineId: string | null;
  readonly kind: WarrantyDocumentKind;
  readonly idempotencyKey: string;
  readonly status: WarrantyDocumentStatus;
  readonly documentId?: string | null;
  readonly documentCode?: string | null;
  readonly amount?: number | null;
  readonly lastError?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface WarrantyResolutionRecord {
  readonly disposition: WarrantyDisposition;
  readonly remedy: WarrantyRemedy;
  readonly note: string | null;
  readonly replacementWarehouseCode: string | null;
  readonly creditAmount: number | null;
}

export interface WarrantyStore {
  /** Serial đã giao (đợt giao đã xuất, hàng thay thế), trong phạm vi dữ liệu theo người phụ trách đơn. Mới nhất trước. */
  serialDeliveries(tenantId: string, scope: CrmDataScope, serial: string): Promise<DeliveredItemRecord[]>;
  /** Mọi serial, dòng không theo serial đã giao của một đơn hoặc một khách (tối đa `limit`). */
  deliveredItems(
    tenantId: string,
    scope: CrmDataScope,
    filter: { readonly orderId?: string; readonly customerId?: string },
    limit: number,
  ): Promise<DeliveredItemRecord[]>;
  /**
   * Serial Kho báo đã xuất cho đợt giao `deliveryId` mà đợt giao chưa ghi serial
   * (dữ liệu cũ): dòng đơn cùng mặt hàng của đợt đó.
   */
  deliveryItem(
    tenantId: string,
    scope: CrmDataScope,
    deliveryId: string,
    materialId: string,
    serial: string,
  ): Promise<DeliveredItemRecord | undefined>;
  /** Số lượng và giá trị dòng đơn (gồm VAT) để tính số tiền hoàn, giảm trừ. */
  orderLineValue(tenantId: string, orderLineId: string): Promise<{ quantity: number; lineTotal: number } | undefined>;
  /** Dòng đơn đã giao (không theo serial) theo id dòng đơn. */
  orderLineDelivery(tenantId: string, scope: CrmDataScope, orderLineId: string): Promise<DeliveredItemRecord | undefined>;
  /** Yêu cầu đang mở (chưa đóng, chưa từ chối) có serial này, theo serial viết hoa. */
  openCasesBySerial(tenantId: string, serials: readonly string[]): Promise<ReadonlyMap<string, string>>;
  listCases(tenantId: string, scope: CrmDataScope, filter: WarrantyCaseFilter): Promise<CrmPage<WarrantyCaseSummary>>;
  getCase(tenantId: string, scope: CrmDataScope, id: string): Promise<WarrantyCaseDetail | undefined>;
  /** Tạo yêu cầu Tiếp nhận cùng dòng và nhật ký; serial đang có yêu cầu mở thì 409. Trả id. */
  createCase(tenantId: string, record: NewWarrantyCaseRecord, actorId: string): Promise<string>;
  /** Tiếp nhận → Từ chối (có lý do). */
  reject(tenantId: string, id: string, revision: number, reason: string, actorId: string): Promise<void>;
  /**
   * Tiếp nhận → Chờ nhận hàng, chụp kho cách ly. Đã Chờ nhận hàng (gửi lại sau
   * lỗi) thì giữ nguyên, trả kho đã chụp. Trạng thái khác thì 409.
   */
  requestGoods(tenantId: string, id: string, revision: number, warehouseCode: string, actorId: string): Promise<string>;
  /** Ghi (hoặc cập nhật theo khoá chống lặp) một chứng từ. */
  saveDocument(tenantId: string, caseId: string, record: WarrantyDocumentRecord): Promise<void>;
  /** Ghi kết quả kiểm định một dòng; mọi dòng có kết quả thì sang Đang xử lý. */
  inspectLine(
    tenantId: string,
    caseId: string,
    revision: number,
    lineId: string,
    result: WarrantyInspectionResult,
    note: string | null,
    actorId: string,
  ): Promise<void>;
  /** Chốt hướng xử lý của một dòng (Đang xử lý). Đã chốt khác hướng thì 409. */
  saveResolution(
    tenantId: string,
    caseId: string,
    revision: number,
    lineId: string,
    resolution: WarrantyResolutionRecord,
    actorId: string,
  ): Promise<void>;
  /** Đang xử lý → Đã xử lý khi mọi dòng có hướng xử lý và chứng từ đã sinh. Trả true khi vừa chuyển. */
  completeResolution(tenantId: string, caseId: string, actorId: string): Promise<boolean>;
  /** Đóng (kiểm `assertClosable` trên bản đã khoá). */
  close(tenantId: string, caseId: string, revision: number, actorId: string): Promise<void>;
  /** Yêu cầu có serial (gốc hoặc thay thế), để hiện lịch sử serial. */
  serialCases(tenantId: string, scope: CrmDataScope, serial: string): Promise<
    { caseId: string; caseCode: string; status: WarrantyStatus; role: 'ORIGINAL' | 'REPLACEMENT'; at: string }[]
  >;
  settings(tenantId: string): Promise<WarrantySettings>;
  saveSettings(tenantId: string, settings: WarrantySettings, actorId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Kho
// ---------------------------------------------------------------------------

export interface InventorySerialInfo {
  readonly serial: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly warehouseCode: string | null;
  readonly stockState: string | null;
  readonly qualityStatus: string | null;
  readonly lastIssue: {
    readonly documentCode: string | null;
    readonly docType: string | null;
    readonly warehouseCode: string | null;
    readonly sourceType: string | null;
    readonly sourceId: string | null;
    readonly issuedAt: string | null;
  } | null;
  readonly movements: readonly {
    readonly movementType: string;
    readonly documentCode: string | null;
    readonly docType: string | null;
    readonly fromWarehouseCode: string | null;
    readonly toWarehouseCode: string | null;
    readonly qualityStatus: string | null;
    readonly sourceType: string | null;
    readonly reason: string | null;
    readonly occurredAt: string;
  }[];
}

export interface WarrantyStockLine {
  readonly materialCode: string;
  readonly quantity: number;
  readonly serials?: readonly string[];
  readonly lotNo?: string;
  readonly note?: string;
}

export interface ReturnReceiptRequest {
  readonly idempotencyKey: string;
  readonly warehouseCode: string;
  readonly sourceType: typeof CRM_WARRANTY_SOURCE_TYPE;
  readonly sourceId: string;
  readonly note?: string;
  readonly lines: readonly WarrantyStockLine[];
}

export interface WarrantyStockDocument {
  readonly documentId: string;
  readonly documentCode: string;
  /** Trạng thái chứng từ ở Kho: DRAFT, PENDING, POSTED... */
  readonly status: string;
}

export interface WarrantyStockDocumentRequest {
  readonly docType: 'TRANSFER' | 'ISSUE_OTHER';
  readonly idempotencyKey: string;
  readonly warehouseCode: string;
  readonly targetWarehouseCode?: string;
  readonly sourceType: typeof CRM_WARRANTY_SOURCE_TYPE;
  readonly sourceId: string;
  readonly note?: string;
  readonly lines: readonly WarrantyStockLine[];
}

export interface WarrantyIssueRequest {
  readonly idempotencyKey: string;
  readonly warehouseCode: string;
  readonly sourceType: typeof CRM_WARRANTY_SOURCE_TYPE;
  readonly sourceId: string;
  readonly note?: string;
  readonly lines: readonly { readonly materialCode: string; readonly quantity: number; readonly note?: string }[];
}

export interface QualityChange {
  readonly qualityStatus: 'PASSED' | 'DEFECTIVE';
  readonly reason: string;
  readonly materialCode?: string;
  /** Người ghi kết quả ở Bán hàng, ghi vào lịch sử chất lượng của Kho. */
  readonly actorUserId: string;
}

/**
 * Kho qua API nội bộ (không đọc `inventory_schema`). Lỗi hạ tầng ném `CrmError`
 * 503 `INVENTORY_UNAVAILABLE`; Kho từ chối thì `CrmError` cùng mã, thông điệp
 * tiếng Việt của Kho.
 */
export interface WarrantyInventory {
  /** `GET v1/internal/serials/:serial`; không có thì `null`. */
  serial(tenantId: string, serial: string): Promise<InventorySerialInfo | null>;
  /** `POST v1/internal/return-receipts`: nhập trả và ghi sổ ngay vào kho cách ly, Chờ kiểm định. */
  receiveReturn(tenantId: string, request: ReturnReceiptRequest): Promise<WarrantyStockDocument>;
  /** `POST v1/internal/serials/:serial/quality`; đã ở trạng thái đích thì coi như xong. */
  changeSerialQuality(tenantId: string, serial: string, change: QualityChange): Promise<void>;
  /** `POST v1/internal/lots/:id/quality`; đã ở trạng thái đích thì coi như xong. */
  changeLotQuality(tenantId: string, lotId: string, change: QualityChange): Promise<void>;
  /** `POST v1/internal/stock-documents`: điều chuyển (ghi sổ ngay) hoặc xuất khác (chờ duyệt). */
  createStockDocument(tenantId: string, request: WarrantyStockDocumentRequest): Promise<WarrantyStockDocument>;
  /** `POST v1/internal/issue-requests` loại xuất bảo hành: nháp, thủ kho chọn serial rồi ghi sổ. */
  createWarrantyIssue(tenantId: string, request: WarrantyIssueRequest): Promise<WarrantyStockDocument>;
}

// ---------------------------------------------------------------------------
// Sổ công nợ
// ---------------------------------------------------------------------------

export interface WarrantyCreditRequest {
  readonly tenantId: string;
  readonly kind: 'CREDIT' | 'REFUND';
  readonly customerId: string;
  readonly orderId: string | null;
  readonly amount: number;
  readonly reason: string;
  readonly sourceType: typeof CRM_WARRANTY_SOURCE_TYPE;
  /** Id dòng bảo hành; cùng với `idempotencyKey` để sổ công nợ chống lặp. */
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
}

export interface WarrantyCreditResult {
  /** POSTED: sổ công nợ đã hạch toán; PENDING_RECEIVABLE: mới ghi nhận đề nghị. */
  readonly status: 'POSTED' | 'PENDING_RECEIVABLE';
  readonly documentId: string | null;
  readonly documentCode: string | null;
}

/**
 * Điều chỉnh công nợ, hoàn tiền cho dòng trả hàng (T6-06, TC-WAR-11). Hiện
 * thực bằng sổ công nợ của GĐ5 (`ReceivableAdjustmentService`); khi chưa có thì
 * `PendingReceivableCredit` chỉ ghi nhận đề nghị (PENDING_RECEIVABLE), yêu cầu
 * chưa đóng được cho tới khi gửi lại thành công.
 */
export interface WarrantyCreditPort {
  requestCredit(request: WarrantyCreditRequest): Promise<WarrantyCreditResult>;
}

/** Bản tạm khi sổ công nợ chưa nối: không hạch toán, chứng từ ở trạng thái Chờ sổ công nợ. */
export class PendingReceivableCredit implements WarrantyCreditPort {
  async requestCredit(): Promise<WarrantyCreditResult> {
    return { status: 'PENDING_RECEIVABLE', documentId: null, documentCode: null };
  }
}
