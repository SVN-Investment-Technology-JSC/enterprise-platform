/**
 * Báo giá theo phiên bản, duyệt báo giá, cách duyệt và danh mục mặt hàng (GĐ3b).
 *
 * Mỗi báo giá có nhiều phiên bản; chỉ phiên bản hiện tại ở Nháp mới sửa được.
 * Sửa phiên bản Đã duyệt, Đã gửi khách, Từ chối duyệt thì phiên bản đó chuyển
 * Đã thay thế và sinh phiên bản mới ở Nháp (mục 5.2 kế hoạch).
 */
import type { AppliedDiscountPolicy, PriceSource } from './pricing.js';

export const QUOTE_STATUSES = [
  'DRAFT',
  'PENDING',
  'REJECTED',
  'APPROVED',
  'SENT',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'SUPERSEDED',
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Readonly<Record<QuoteStatus, string>> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  REJECTED: 'Từ chối duyệt',
  APPROVED: 'Đã duyệt',
  SENT: 'Đã gửi khách',
  ACCEPTED: 'Khách chấp nhận',
  DECLINED: 'Khách từ chối',
  EXPIRED: 'Hết hạn',
  SUPERSEDED: 'Đã thay thế',
};

/**
 * Bảng chuyển trạng thái của một phiên bản (mục 5.2 kế hoạch). Server kiểm bằng
 * chính bảng này; giao diện dùng để ẩn hiện nút.
 */
export const QUOTE_STATUS_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  DRAFT: ['PENDING', 'APPROVED'],
  PENDING: ['APPROVED', 'REJECTED'],
  REJECTED: ['SUPERSEDED'],
  APPROVED: ['SENT', 'SUPERSEDED', 'EXPIRED'],
  SENT: ['ACCEPTED', 'DECLINED', 'SUPERSEDED', 'EXPIRED'],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [],
  SUPERSEDED: [],
};

/** Phiên bản ở các trạng thái này sửa được bằng cách sinh phiên bản mới. */
export const QUOTE_REVISABLE_STATUSES: readonly QuoteStatus[] = ['APPROVED', 'SENT', 'REJECTED'];

/** Số ngày hiệu lực mặc định của báo giá mới. */
export const QUOTE_DEFAULT_VALIDITY_DAYS = 30;
/** Số dòng tối đa của một phiên bản. */
export const QUOTE_LINES_MAX = 200;

/** Sự kiện outbox của báo giá (skill `erp-events`). */
export const CRM_QUOTE_APPROVAL_REQUESTED = 'crm.quote.approval-requested';
export const CRM_QUOTE_APPROVAL_DECIDED = 'crm.quote.approval-decided';
export const CRM_QUOTE_EXPIRED = 'crm.quote.expired';

export interface CrmQuoteApprovalRequestedPayload {
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly versionNo: number;
  readonly customerName: string;
  readonly totalAmount: number;
  readonly reasons: readonly string[];
  readonly requesterUserId: string;
  readonly actorUserId: string;
  /** Người được báo: cấp trên của người gửi khi duyệt trực tiếp; rỗng khi Quy trình tự giao bước. */
  readonly recipientUserIds: readonly string[];
  readonly mode: ApprovalMode;
  readonly summary: string;
  readonly deepLink: string;
}

export interface CrmQuoteApprovalDecidedPayload {
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly versionNo: number;
  readonly status: 'APPROVED' | 'REJECTED';
  readonly reason: string | null;
  /** Rỗng khi Quy trình duyệt mà không cho biết người duyệt. */
  readonly actorUserId: string | null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

export interface CrmQuoteExpiredPayload {
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly versionNo: number;
  readonly validUntil: string;
  readonly actorUserId: null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

/** Đường dẫn mở báo giá trên giao diện (thông báo, dòng thời gian). */
export function quoteDeepLink(quoteId: string): string {
  return `/modules/crm#quotes/${encodeURIComponent(quoteId)}`;
}

// ---------------------------------------------------------------------------
// Dữ liệu báo giá
// ---------------------------------------------------------------------------

export interface QuoteLine {
  readonly id: string;
  readonly lineNo: number;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  /** Loại mặt hàng ở Kho: STOCK hoặc SERVICE. Dịch vụ không có tồn. */
  readonly materialKind: string;
  readonly category: string | null;
  readonly quantity: number;
  readonly listPrice: number;
  readonly priceSource: PriceSource;
  readonly priceReferenceCode: string | null;
  readonly appliedPolicies: readonly AppliedDiscountPolicy[];
  readonly policyPercent: number;
  readonly discountPercent: number;
  readonly cappedAt: number | null;
  readonly overridden: boolean;
  readonly overrideUnitPrice: number | null;
  readonly overrideDiscountPercent: number | null;
  readonly unitPrice: number;
  readonly grossAmount: number;
  readonly discountAmount: number;
  readonly vatRate: number;
  readonly lineAmount: number;
  readonly vatAmount: number;
  readonly lineTotal: number;
  /** Giá vốn bình quân của Kho lúc tính (ước tính); rỗng khi Kho chưa có. */
  readonly estUnitCost: number | null;
  readonly estCost: number;
  /** Biên lợi nhuận (%) của dòng; rỗng khi thành tiền bằng 0. */
  readonly margin: number | null;
  /** Tồn khả dụng hiện tại ở Kho (đọc lúc xem); rỗng với dịch vụ hoặc khi Kho không trả lời. */
  readonly availableStock: number | null;
}

export interface QuoteShipping {
  /** Phí thu của khách, trước VAT. */
  readonly amount: number;
  readonly vatRate: number;
  /** Chi phí vận chuyển bên bán chịu, trừ vào lợi nhuận. */
  readonly cost: number;
}

export interface QuoteTotals {
  readonly grossAmount: number;
  readonly discountAmount: number;
  readonly netAmount: number;
  readonly shippingAmount: number;
  readonly vatAmount: number;
  readonly totalAmount: number;
  /** Giá vốn ước tính của hàng cộng chi phí vận chuyển bên bán chịu. */
  readonly estCost: number;
  readonly profit: number;
  readonly marginPercent: number | null;
  /** Chiết khấu bình quân trên giá gốc (%). */
  readonly discountPercent: number;
}

export interface QuoteApprovalReason {
  readonly code: string;
  readonly message: string;
}

export interface QuoteVersionSummary {
  readonly versionNo: number;
  readonly status: QuoteStatus;
  readonly totalAmount: number;
  readonly createdAt: string;
}

export interface QuoteVersion {
  readonly id: string;
  readonly versionNo: number;
  readonly status: QuoteStatus;
  readonly revision: number;
  readonly validUntil: string | null;
  readonly priceDate: string | null;
  readonly pricedOn: string | null;
  readonly note: string | null;
  readonly shipping: QuoteShipping;
  readonly totals: QuoteTotals;
  readonly requiresApproval: boolean;
  readonly approvalReasons: readonly QuoteApprovalReason[];
  readonly submittedAt: string | null;
  readonly submittedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectedBy: string | null;
  readonly decisionReason: string | null;
  readonly sentAt: string | null;
  readonly respondedAt: string | null;
  readonly supersededAt: string | null;
  readonly createdAt: string;
  readonly lines: readonly QuoteLine[];
}

export interface QuoteSummary {
  readonly id: string;
  readonly code: string;
  readonly opportunityId: string | null;
  readonly opportunityName: string | null;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly ownerUserId: string;
  readonly status: QuoteStatus;
  readonly currentVersion: number;
  readonly validUntil: string | null;
  readonly totalAmount: number;
  readonly updatedAt: string;
}

export type ProcedureLinkStatus = 'START_PENDING' | 'RUNNING' | 'FAILED' | 'APPLIED' | 'CLOSED';

/** Phiên duyệt qua Quy trình của phiên bản đang xem. */
export interface QuoteProcedureLink {
  readonly id: string;
  readonly status: ProcedureLinkStatus;
  readonly instanceId: string | null;
  readonly instanceCode: string | null;
  readonly result: string | null;
  readonly lastError: string | null;
  readonly attempts: number;
}

/** Một dòng lịch sử (nhật ký chuyển trạng thái). */
export interface QuoteHistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly action: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly versionNo: number | null;
}

export interface QuoteDetail extends QuoteSummary {
  readonly acceptedVersion: number | null;
  readonly convertedAt: string | null;
  readonly createdAt: string;
  readonly versions: readonly QuoteVersionSummary[];
  /** Phiên bản đang xem (mặc định phiên bản hiện tại). */
  readonly version: QuoteVersion;
  readonly procedure: QuoteProcedureLink | null;
  readonly history: readonly QuoteHistoryEntry[];
  /**
   * Phiên bản hiện tại đang Nháp: lý do sẽ cần duyệt nếu người đang xem gửi
   * duyệt ngay (rỗng là duyệt thẳng). Phiên bản khác: rỗng (null).
   */
  readonly approvalCheck: readonly QuoteApprovalReason[] | null;
}

export interface QuoteListQuery {
  readonly q?: string;
  readonly status?: QuoteStatus;
  readonly customerId?: string;
  readonly opportunityId?: string;
  readonly ownerUserId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface CreateQuoteRequest {
  /** Lập từ cơ hội: khách và người phụ trách lấy theo cơ hội. */
  readonly opportunityId?: string | null;
  /** Lập thẳng cho khách (không qua cơ hội). */
  readonly customerId?: string | null;
  readonly validUntil?: string | null;
  readonly note?: string | null;
  readonly ownerUserId?: string | null;
}

export interface UpdateQuoteVersionRequest {
  readonly revision: number;
  readonly validUntil?: string | null;
  readonly priceDate?: string | null;
  readonly note?: string | null;
  readonly shipping?: { readonly amount: number; readonly vatRate?: number | null; readonly cost?: number | null } | null;
}

export interface SaveQuoteLineRequest {
  readonly revision: number;
  readonly materialId: string;
  readonly quantity: number;
  /** Đơn vị bán; mặc định đơn vị trong danh mục Kho. */
  readonly unit?: string | null;
  readonly overrideUnitPrice?: number | null;
  readonly overrideDiscountPercent?: number | null;
}

export interface QuoteRevisionRequest {
  readonly revision: number;
}

export interface QuoteDecisionRequest {
  readonly revision: number;
  readonly reason?: string | null;
}

/** Một dòng khác nhau giữa hai phiên bản, khớp theo mặt hàng và đơn vị. */
export interface QuoteLineDifference {
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly change: 'ADDED' | 'REMOVED' | 'CHANGED';
  /** Trường đã đổi (quantity, unitPrice, discountPercent, vatRate, lineTotal...). */
  readonly fields: readonly string[];
  readonly from: Pick<QuoteLine, 'quantity' | 'unitPrice' | 'discountPercent' | 'vatRate' | 'lineAmount' | 'lineTotal'> | null;
  readonly to: Pick<QuoteLine, 'quantity' | 'unitPrice' | 'discountPercent' | 'vatRate' | 'lineAmount' | 'lineTotal'> | null;
}

export interface QuoteComparison {
  readonly quoteId: string;
  readonly from: QuoteVersion;
  readonly to: QuoteVersion;
  readonly lines: readonly QuoteLineDifference[];
  /** Chênh lệch tổng (bản sau trừ bản trước). */
  readonly totalsDelta: Pick<QuoteTotals, 'netAmount' | 'vatAmount' | 'totalAmount' | 'profit'>;
}

// ---------------------------------------------------------------------------
// Danh mục mặt hàng (đọc từ Kho)
// ---------------------------------------------------------------------------

export interface CatalogMaterialStock {
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly available: number;
}

export interface CrmCatalogMaterial {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unit: string | null;
  readonly kind: string | null;
  readonly category: string | null;
  /** Giá vốn bình quân hiện tại (ước tính); rỗng với dịch vụ. */
  readonly avgCost: number | null;
  /** Tồn khả dụng gộp các kho; rỗng với dịch vụ. */
  readonly totalAvailable: number | null;
  readonly availableByWarehouse: readonly CatalogMaterialStock[] | null;
}

// ---------------------------------------------------------------------------
// Cách duyệt và ngưỡng duyệt
// ---------------------------------------------------------------------------

export const APPROVAL_KINDS = ['QUOTE', 'ORDER_CREDIT'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_LABELS: Readonly<Record<ApprovalKind, string>> = {
  QUOTE: 'Báo giá vượt ngưỡng',
  ORDER_CREDIT: 'Đơn bán vượt hạn mức công nợ',
};

export const APPROVAL_MODES = ['DIRECT', 'PROCEDURE'] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const APPROVAL_MODE_LABELS: Readonly<Record<ApprovalMode, string>> = {
  DIRECT: 'Duyệt trực tiếp trong CRM',
  PROCEDURE: 'Duyệt qua Quy trình',
};

export interface ApprovalBinding {
  readonly kind: ApprovalKind;
  readonly mode: ApprovalMode;
  readonly procedureDefinitionId: string | null;
  readonly procedureDefinitionName: string | null;
  readonly updatedAt: string | null;
}

export interface SaveApprovalBindingRequest {
  readonly mode: ApprovalMode;
  readonly procedureDefinitionId?: string | null;
}

/** Quy trình đã công bố để chọn khi gắn. */
export interface ProcedureDefinitionOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Ngưỡng duyệt báo giá (PRC-05). Hạn mức chiết khấu (%) theo vai trò người
 * lập: quản lý (`crm.read.all`), trưởng nhóm (`crm.quote.approve`), nhân viên
 * (còn lại); rỗng là không giới hạn.
 */
export interface QuoteApprovalSettings {
  readonly roleLimits: {
    readonly staff: number | null;
    readonly teamLead: number | null;
    readonly manager: number | null;
  };
  readonly minMarginPercent: number;
}

export const DEFAULT_QUOTE_APPROVAL_SETTINGS: QuoteApprovalSettings = {
  roleLimits: { staff: 5, teamLead: 15, manager: null },
  minMarginPercent: 10,
};
