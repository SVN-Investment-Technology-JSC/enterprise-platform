/**
 * Bảo hành, đổi trả (GĐ6).
 *
 * Yêu cầu bảo hành gồm nhiều dòng, mỗi dòng một serial (hoặc một số lượng của
 * dòng đơn không theo serial). Hạn bảo hành tính từ ngày giao thực tế của
 * serial; thời hạn hợp đồng (nếu đơn đi từ hợp đồng có bảo hành) ưu tiên hơn
 * thời hạn của mặt hàng; serial thay thế kế thừa phần hạn còn lại của serial
 * cũ (Q9). Serial hết hạn vẫn tiếp nhận được nhưng là loại có phí.
 *
 * Máy trạng thái theo mục 5.5 kế hoạch. Hàng nhận về kho cách ly qua API nhập
 * trả của Kho; Kho phát `inventory.stock.returned` thì yêu cầu sang Đang kiểm
 * định.
 */

export const WARRANTY_CAUSES = ['TECHNICAL_FAULT', 'WRONG_ITEM', 'SHORTAGE', 'CHANGE_OF_MIND', 'POLICY_RETURN'] as const;
export type WarrantyCause = (typeof WARRANTY_CAUSES)[number];

export const WARRANTY_CAUSE_LABELS: Readonly<Record<WarrantyCause, string>> = {
  TECHNICAL_FAULT: 'Lỗi kỹ thuật',
  WRONG_ITEM: 'Giao sai',
  SHORTAGE: 'Giao thiếu',
  CHANGE_OF_MIND: 'Khách đổi ý',
  POLICY_RETURN: 'Trả theo chính sách',
};

export const WARRANTY_STATUSES = [
  'RECEIVED',
  'AWAITING_GOODS',
  'INSPECTING',
  'RESOLVING',
  'RESOLVED',
  'REJECTED',
  'CLOSED',
] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

export const WARRANTY_STATUS_LABELS: Readonly<Record<WarrantyStatus, string>> = {
  RECEIVED: 'Tiếp nhận',
  AWAITING_GOODS: 'Chờ nhận hàng',
  INSPECTING: 'Đang kiểm định',
  RESOLVING: 'Đang xử lý',
  RESOLVED: 'Đã xử lý',
  REJECTED: 'Từ chối',
  CLOSED: 'Đã đóng',
};

/**
 * Bảng chuyển trạng thái (mục 5.5). Chờ nhận hàng → Đang kiểm định do sự kiện
 * nhập trả của Kho; Đang kiểm định → Đang xử lý khi mọi dòng có kết quả; Đang
 * xử lý → Đã xử lý khi mọi dòng có hướng xử lý và chứng từ; đóng khi mọi chứng
 * từ đã ghi sổ.
 */
export const WARRANTY_STATUS_TRANSITIONS: Readonly<Record<WarrantyStatus, readonly WarrantyStatus[]>> = {
  RECEIVED: ['AWAITING_GOODS', 'REJECTED'],
  AWAITING_GOODS: ['INSPECTING'],
  INSPECTING: ['RESOLVING'],
  RESOLVING: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};

export const WARRANTY_INSPECTION_RESULTS = ['PASSED', 'DEFECTIVE'] as const;
export type WarrantyInspectionResult = (typeof WARRANTY_INSPECTION_RESULTS)[number];

export const WARRANTY_INSPECTION_LABELS: Readonly<Record<WarrantyInspectionResult, string>> = {
  PASSED: 'Đạt',
  DEFECTIVE: 'Lỗi',
};

/** Hướng xử lý hàng nhận về (WAR-05). */
export const WARRANTY_DISPOSITIONS = ['RESTOCK', 'MOVE_TO_DEFECT', 'SCRAP'] as const;
export type WarrantyDisposition = (typeof WARRANTY_DISPOSITIONS)[number];

export const WARRANTY_DISPOSITION_LABELS: Readonly<Record<WarrantyDisposition, string>> = {
  RESTOCK: 'Nhập lại hàng tốt',
  MOVE_TO_DEFECT: 'Chuyển kho lỗi',
  SCRAP: 'Loại bỏ',
};

/** Xử lý cho khách (WAR-06). */
export const WARRANTY_REMEDIES = ['NONE', 'REPLACE', 'REFUND', 'CREDIT'] as const;
export type WarrantyRemedy = (typeof WARRANTY_REMEDIES)[number];

export const WARRANTY_REMEDY_LABELS: Readonly<Record<WarrantyRemedy, string>> = {
  NONE: 'Không',
  REPLACE: 'Đổi hàng (xuất thay thế)',
  REFUND: 'Hoàn tiền',
  CREDIT: 'Giảm trừ công nợ',
};

/** Chứng từ yêu cầu bảo hành sinh ra ở Kho, ở sổ công nợ. */
export const WARRANTY_DOCUMENT_KINDS = [
  'RETURN_RECEIPT',
  'QUALITY',
  'TRANSFER',
  'SCRAP',
  'REPLACEMENT',
  'CREDIT',
  'REFUND',
] as const;
export type WarrantyDocumentKind = (typeof WARRANTY_DOCUMENT_KINDS)[number];

export const WARRANTY_DOCUMENT_KIND_LABELS: Readonly<Record<WarrantyDocumentKind, string>> = {
  RETURN_RECEIPT: 'Nhập trả vào kho cách ly',
  QUALITY: 'Đổi trạng thái chất lượng',
  TRANSFER: 'Điều chuyển kho (kho lỗi hoặc kho bán)',
  SCRAP: 'Xuất khác (loại bỏ)',
  REPLACEMENT: 'Xuất bảo hành (hàng thay thế)',
  CREDIT: 'Điều chỉnh giảm công nợ',
  REFUND: 'Hoàn tiền',
};

/**
 * Trạng thái chứng từ: PENDING chưa gửi được (lỗi tạm, gửi lại bằng "Gửi lại
 * chứng từ"); REQUESTED đã tạo nháp ở Kho, chờ thủ kho ghi sổ;
 * PENDING_APPROVAL chờ người duyệt chứng từ kho; PENDING_RECEIVABLE đã ghi
 * nhận đề nghị điều chỉnh công nợ, sổ công nợ chưa hạch toán; POSTED đã ghi
 * sổ; REVERSED Kho đã đảo chứng từ.
 */
export const WARRANTY_DOCUMENT_STATUSES = [
  'PENDING',
  'REQUESTED',
  'PENDING_APPROVAL',
  'PENDING_RECEIVABLE',
  'POSTED',
  'REVERSED',
] as const;
export type WarrantyDocumentStatus = (typeof WARRANTY_DOCUMENT_STATUSES)[number];

export const WARRANTY_DOCUMENT_STATUS_LABELS: Readonly<Record<WarrantyDocumentStatus, string>> = {
  PENDING: 'Chưa gửi được',
  REQUESTED: 'Chờ thủ kho ghi sổ',
  PENDING_APPROVAL: 'Chờ duyệt',
  PENDING_RECEIVABLE: 'Chờ sổ công nợ',
  POSTED: 'Đã ghi sổ',
  REVERSED: 'Đã đảo',
};

/** Hạn bảo hành lấy từ đâu. */
export const WARRANTY_SOURCES = ['CONTRACT', 'MATERIAL', 'INHERITED', 'NONE'] as const;
export type WarrantySource = (typeof WARRANTY_SOURCES)[number];

export const WARRANTY_SOURCE_LABELS: Readonly<Record<WarrantySource, string>> = {
  CONTRACT: 'Theo hợp đồng',
  MATERIAL: 'Theo mặt hàng',
  INHERITED: 'Kế thừa serial được thay',
  NONE: 'Không có bảo hành',
};

/** Kho cách ly, kho lỗi mặc định khi chưa cấu hình (`crm_schema.settings`). */
export const DEFAULT_WARRANTY_QUARANTINE_WAREHOUSE = 'QA-KHO-CL';
export const DEFAULT_WARRANTY_DEFECT_WAREHOUSE = 'QA-KHO-LOI';
/** Kho nhận hàng Đạt nhập lại khi không biết kho xuất ban đầu của serial, dòng (T6-11). */
export const DEFAULT_WARRANTY_RESTOCK_WAREHOUSE = 'QA-KHO-HN';
/** Số dòng tối đa của một yêu cầu bảo hành. */
export const WARRANTY_LINES_MAX = 50;

/** Đường dẫn mở yêu cầu bảo hành trên giao diện. */
export function warrantyCaseDeepLink(caseId: string): string {
  return `/modules/crm#warranty/${encodeURIComponent(caseId)}`;
}

// ---------------------------------------------------------------------------
// Tra cứu hạn bảo hành
// ---------------------------------------------------------------------------

export interface WarrantyCoverage {
  /** Ngày giao thực tế của serial (YYYY-MM-DD), rỗng khi không biết. */
  readonly deliveredOn: string | null;
  readonly months: number | null;
  readonly source: WarrantySource;
  /** Ngày cuối còn bảo hành (tính cả ngày này). */
  readonly warrantyUntil: string | null;
  /** Số ngày còn lại tính từ hôm nay; 0 khi hôm nay là ngày cuối hoặc đã hết hạn. */
  readonly remainingDays: number;
  readonly expired: boolean;
}

/** Một serial (hoặc dòng đơn không theo serial) đã giao cho khách. */
export interface WarrantyLookupItem {
  /** Rỗng với dòng đơn không theo serial. */
  readonly serial: string | null;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly orderLineId: string | null;
  readonly contractId: string | null;
  readonly contractCode: string | null;
  readonly deliveryCode: string | null;
  readonly warehouseCode: string | null;
  readonly coverage: WarrantyCoverage;
  /** Serial này là hàng thay thế của yêu cầu bảo hành nào (Q9). */
  readonly replacementOf: { readonly caseId: string; readonly caseCode: string; readonly serial: string | null } | null;
  /** Yêu cầu bảo hành đang mở của serial, nếu có. */
  readonly openCaseId: string | null;
}

export interface WarrantyLookupQuery {
  readonly serial?: string;
  readonly orderId?: string;
  readonly customerId?: string;
}

// ---------------------------------------------------------------------------
// Yêu cầu bảo hành
// ---------------------------------------------------------------------------

export interface WarrantyDocument {
  readonly id: string;
  readonly lineId: string | null;
  readonly kind: WarrantyDocumentKind;
  readonly status: WarrantyDocumentStatus;
  readonly documentId: string | null;
  readonly documentCode: string | null;
  readonly amount: number | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly postedAt: string | null;
}

export interface WarrantyCaseLine {
  readonly id: string;
  readonly lineNo: number;
  readonly serial: string | null;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly orderLineId: string | null;
  readonly coverage: WarrantyCoverage;
  readonly chargeable: boolean;
  /** Đã nhận về kho cách ly. */
  readonly receivedAt: string | null;
  /** Lô riêng của lần trả ở Kho (hàng không theo serial), để đổi chất lượng theo lô. */
  readonly receivedLotId: string | null;
  readonly receivedLotNo: string | null;
  /** Kho đã xuất giao serial cũ; mặc định xuất hàng thay thế từ kho này. */
  readonly deliveryWarehouseCode: string | null;
  readonly inspectionResult: WarrantyInspectionResult | null;
  readonly inspectionNote: string | null;
  readonly inspectedAt: string | null;
  readonly inspectedBy: string | null;
  readonly disposition: WarrantyDisposition | null;
  readonly remedy: WarrantyRemedy | null;
  readonly resolutionNote: string | null;
  readonly resolvedAt: string | null;
  /** Kho xuất hàng thay thế. */
  readonly replacementWarehouseCode: string | null;
  /** Serial thủ kho đã xuất thay thế (Q9: kế thừa hạn còn lại). */
  readonly replacementSerials: readonly string[];
  /** Hạn bảo hành của hàng thay thế: bằng hạn còn lại của serial cũ. */
  readonly replacementWarrantyUntil: string | null;
  readonly creditAmount: number | null;
}

export interface WarrantyCaseSummary {
  readonly id: string;
  readonly code: string;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly cause: WarrantyCause;
  readonly status: WarrantyStatus;
  readonly chargeable: boolean;
  readonly lineCount: number;
  readonly serials: readonly string[];
  readonly ownerUserId: string;
  readonly assigneeUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WarrantyHistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly action: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
}

export interface WarrantyCaseDetail extends WarrantyCaseSummary {
  readonly description: string | null;
  readonly contractId: string | null;
  readonly quarantineWarehouseCode: string | null;
  readonly rejectReason: string | null;
  readonly revision: number;
  readonly lines: readonly WarrantyCaseLine[];
  readonly documents: readonly WarrantyDocument[];
  readonly history: readonly WarrantyHistoryEntry[];
}

export interface WarrantyCaseListQuery {
  readonly q?: string;
  readonly status?: WarrantyStatus;
  readonly customerId?: string;
  readonly serial?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Một dòng tiếp nhận: một serial, hoặc một số lượng của dòng đơn không theo serial. */
export interface CreateWarrantyLineRequest {
  readonly serial?: string | null;
  readonly orderLineId?: string | null;
  readonly quantity?: number | null;
}

export interface CreateWarrantyCaseRequest {
  /** Bắt buộc (WAR-02). */
  readonly cause?: WarrantyCause | null;
  readonly description?: string | null;
  readonly assigneeUserId?: string | null;
  readonly lines?: readonly CreateWarrantyLineRequest[];
}

export interface WarrantyActionRequest {
  readonly revision?: number;
  readonly reason?: string | null;
}

export interface InspectWarrantyLineRequest {
  readonly revision?: number;
  readonly result?: WarrantyInspectionResult | null;
  readonly note?: string | null;
}

export interface ResolveWarrantyLineRequest {
  readonly revision?: number;
  readonly disposition?: WarrantyDisposition | null;
  readonly remedy?: WarrantyRemedy | null;
  /** Kho xuất hàng thay thế; bỏ trống thì dùng kho đã giao serial cũ. */
  readonly replacementWarehouseCode?: string | null;
  readonly note?: string | null;
}

export interface WarrantySettings {
  readonly quarantineWarehouseCode: string;
  readonly defectWarehouseCode: string;
  /** Kho nhận lại hàng Đạt khi không biết kho xuất ban đầu (T6-11). */
  readonly restockWarehouseCode: string;
}

/** Lịch sử một serial: bước kho (từ Kho) và các yêu cầu bảo hành có serial đó. */
export interface WarrantySerialMovement {
  readonly movementType: string;
  readonly documentCode: string | null;
  readonly docType: string | null;
  readonly fromWarehouseCode: string | null;
  readonly toWarehouseCode: string | null;
  readonly qualityStatus: string | null;
  readonly sourceType: string | null;
  readonly reason: string | null;
  readonly occurredAt: string;
}

export interface WarrantySerialHistory {
  readonly serial: string;
  readonly lookup: WarrantyLookupItem | null;
  /** Rỗng khi Kho không trả lời (`inventoryAvailable = false`). */
  readonly movements: readonly WarrantySerialMovement[];
  readonly inventoryAvailable: boolean;
  readonly cases: readonly {
    readonly caseId: string;
    readonly caseCode: string;
    readonly status: WarrantyStatus;
    /** ORIGINAL: serial được đem bảo hành; REPLACEMENT: serial được xuất thay thế. */
    readonly role: 'ORIGINAL' | 'REPLACEMENT';
    readonly at: string;
  }[];
}
