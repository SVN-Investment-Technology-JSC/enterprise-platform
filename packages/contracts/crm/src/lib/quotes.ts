/**
 * Báo giá theo phiên bản, duyệt báo giá, cách duyệt và danh mục mặt hàng (GĐ3b).
 *
 * Mỗi báo giá có nhiều phiên bản; chỉ phiên bản hiện tại ở Nháp mới sửa được.
 * Sửa phiên bản Đã duyệt, Đã gửi khách, Từ chối duyệt thì phiên bản đó chuyển
 * Đã thay thế và sinh phiên bản mới ở Nháp (mục 5.2 kế hoạch).
 */
import type { BusinessPlanDetail } from './business-plan.js';
import type { AppliedDiscountPolicy, PriceSource } from './pricing.js';
import type { QuotePromotionSnapshot } from './promotions.js';
import type { CustomFieldValue, QuoteFee, QuoteFormData, QuoteOrderAmountInput } from './quote-form.js';

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
/** Báo người theo dõi báo giá khi gửi duyệt hoặc đổi trạng thái (P2I-07). Sự kiện thêm, không thay sự kiện cũ. */
export const CRM_QUOTE_STATUS_CHANGED = 'crm.quote.status-changed';

export interface CrmQuoteStatusChangedPayload {
  readonly quoteId: string;
  readonly quoteCode: string;
  readonly versionNo: number;
  readonly fromStatus: QuoteStatus;
  readonly toStatus: QuoteStatus;
  /** Rỗng khi hệ thống tự đổi (hết hạn). */
  readonly actorUserId: string | null;
  /** Người theo dõi báo giá, trừ người thao tác. */
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

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
  /** Trường theo mẫu: tên, ngày, mẫu, loại, chiết khấu và thuế tổng đơn, phí trên hợp đồng (GĐI). */
  readonly form: QuoteFormData;
  /** Khuyến mãi đã chụp trên phiên bản (P2I-11); thông tin kèm theo, không đổi tổng. */
  readonly promotions: readonly QuotePromotionSnapshot[];
  /**
   * `true` khi người xem không có quyền xem giá vốn, lợi nhuận (`crm.quote.cost.read`): các trường giá vốn,
   * lợi nhuận, biên trả về 0 hoặc rỗng, không phải số thật.
   */
  readonly costHidden?: boolean;
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
  readonly quoteName: string | null;
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
  /** PAKD của phiên bản đang xem; rỗng khi chưa lập. Người duyệt thấy doanh thu, giá vốn, lợi nhuận qua đây. */
  readonly businessPlan?: BusinessPlanDetail | null;
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
  /** Mã nhập tay hoặc đã sinh bằng `POST /v1/quotes/code/generate`; rỗng thì hệ thống sinh. Trùng mã: 409. */
  readonly code?: string | null;
  /** Rỗng: `Báo giá <mã>`. */
  readonly quoteName?: string | null;
  readonly quoteDate?: string | null;
  /** Rỗng: mẫu mặc định. */
  readonly templateId?: string | null;
  /** Rỗng: loại mặc định. */
  readonly quoteTypeId?: string | null;
  /** Giá trị trường tuỳ biến theo id định nghĩa; kiểm kiểu và lựa chọn, chưa ép bắt buộc (báo giá chưa có dòng). */
  readonly customFields?: Readonly<Record<string, CustomFieldValue | null>>;
}

export interface UpdateQuoteVersionRequest {
  readonly revision: number;
  readonly validUntil?: string | null;
  readonly priceDate?: string | null;
  readonly note?: string | null;
  readonly shipping?: { readonly amount: number; readonly vatRate?: number | null; readonly cost?: number | null } | null;
  /** Đổi mã khi còn Nháp; trùng mã: 409. */
  readonly code?: string;
  readonly quoteName?: string | null;
  readonly quoteDate?: string | null;
  /** Đổi mẫu thì chế độ chiết khấu và thuế theo mẫu mới. Báo giá đã có mẫu không được bỏ mẫu. */
  readonly templateId?: string | null;
  readonly quoteTypeId?: string | null;
  /** Chỉ nhập được khi mẫu chiết khấu theo tổng đơn; `null` là xoá. */
  readonly orderDiscount?: QuoteOrderAmountInput | null;
  /** Chỉ nhập được khi mẫu thuế theo tổng đơn; `null` là xoá. */
  readonly orderTax?: QuoteOrderAmountInput | null;
  /** Thay toàn bộ danh sách khoản phí. */
  readonly fees?: readonly QuoteFee[];
  /**
   * Giá trị trường tuỳ biến theo id định nghĩa; chỉ gửi trường cần đổi (`null` là xoá). Khi lưu, trường bắt buộc còn
   * thiếu thì 400 nêu tên trường.
   */
  readonly customFields?: Readonly<Record<string, CustomFieldValue | null>>;
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

/** Một mặt hàng trong lô thêm dòng; `revision` chung nằm ở `AddQuoteLinesRequest`. */
export type QuoteLineInput = Omit<SaveQuoteLineRequest, 'revision'>;

/** Thêm nhiều dòng vào báo giá Nháp một lần: tất cả hoặc không dòng nào. */
export interface AddQuoteLinesRequest {
  readonly revision: number;
  readonly lines: readonly QuoteLineInput[];
}

/** Lỗi của một dòng trong lô; `line` đánh số từ 1 theo thứ tự gửi lên. */
export interface QuoteLineError {
  readonly line: number;
  readonly materialId: string | null;
  readonly code: string;
  readonly message: string;
}

/** Mã lỗi 400 khi lô có dòng lỗi; `details.errors` là danh sách `QuoteLineError`. */
export const QUOTE_LINES_INVALID_CODE = 'LINES_INVALID';

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

export const APPROVAL_KINDS = ['QUOTE', 'ORDER_CREDIT', 'TENDER_PLAN'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_LABELS: Readonly<Record<ApprovalKind, string>> = {
  QUOTE: 'Báo giá vượt ngưỡng',
  ORDER_CREDIT: 'Đơn bán vượt hạn mức công nợ',
  TENDER_PLAN: 'Phương án chào thầu',
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
