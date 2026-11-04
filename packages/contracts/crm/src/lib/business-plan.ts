/**
 * Phương án kinh doanh (PAKD, GĐ D): gắn một phiên bản báo giá, gồm các dòng chi phí và số liệu tính từ báo giá.
 *
 * Doanh thu = thành tiền sau chiết khấu cộng phí vận chuyển thu khách; giá vốn = giá vốn ước tính của hàng cộng
 * chi phí vận chuyển bên bán chịu (đều lấy từ phiên bản báo giá); lợi nhuận = doanh thu trừ giá vốn trừ tổng
 * chi phí của PAKD. Tiền là VND, làm tròn đến đồng theo từng dòng, kiểu xa số 0.
 */

export const BUSINESS_PLAN_COST_KINDS = ['DISCOUNT', 'PRICE_REDUCTION', 'SUBCONTRACT', 'OTHER'] as const;
export type BusinessPlanCostKind = (typeof BUSINESS_PLAN_COST_KINDS)[number];

export const BUSINESS_PLAN_COST_KIND_LABELS: Readonly<Record<BusinessPlanCostKind, string>> = {
  DISCOUNT: 'Chiết khấu',
  PRICE_REDUCTION: 'Giảm giá',
  SUBCONTRACT: 'Thầu phụ',
  OTHER: 'Chi phí khác',
};

export const BUSINESS_PLAN_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type BusinessPlanStatus = (typeof BUSINESS_PLAN_STATUSES)[number];

export const BUSINESS_PLAN_STATUS_LABELS: Readonly<Record<BusinessPlanStatus, string>> = {
  DRAFT: 'Đang soạn',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối duyệt',
};

/** Số dòng chi phí tối đa của một PAKD. */
export const BUSINESS_PLAN_LINES_MAX = 50;
/** Số tiền tối đa của một dòng chi phí (VND). */
export const BUSINESS_PLAN_AMOUNT_MAX = 1e13;

export interface BusinessPlanCostLine {
  readonly id: string;
  readonly lineNo: number;
  readonly kind: BusinessPlanCostKind;
  readonly description: string | null;
  readonly amount: number;
}

/** Số liệu của PAKD; tiền VND, tỷ lệ là phần trăm. */
export interface BusinessPlanFigures {
  /** Tổng tiền hàng theo giá gốc, trước chiết khấu (mẫu số của tỷ lệ chiết khấu). */
  readonly grossAmount: number;
  readonly revenue: number;
  readonly goodsCost: number;
  /** Chiết khấu của báo giá cộng các dòng chiết khấu, giảm giá của PAKD. */
  readonly discountAmount: number;
  /** Tổng các dòng chi phí của PAKD. */
  readonly extraCostTotal: number;
  readonly totalCost: number;
  readonly profit: number;
  /** Tỷ suất lợi nhuận trên doanh thu (%); rỗng khi doanh thu bằng 0. */
  readonly marginPercent: number | null;
  /** Tỷ lệ chiết khấu trên giá gốc (%). */
  readonly discountPercent: number;
}

/** Số liệu khi người xem không có quyền xem giá vốn, lợi nhuận: chỉ còn doanh thu và tiền hàng. */
export interface BusinessPlanVisibleFigures {
  readonly grossAmount: number;
  readonly revenue: number;
  readonly discountAmount: number;
  readonly discountPercent: number;
}

export interface BusinessPlanRound {
  readonly roundNo: number;
  readonly quoteVersionNo: number;
  readonly via: 'STANDALONE' | 'QUOTE';
  readonly submittedAt: string;
  readonly submittedBy: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decision: 'APPROVED' | 'REJECTED' | null;
  readonly reason: string | null;
  /** Số liệu lúc trình; rỗng khi người xem không có quyền xem giá vốn. */
  readonly figures: BusinessPlanFigures | null;
}

/** So lệch với PAKD đã duyệt gần nhất của báo giá (phiên bản trước). */
export interface BusinessPlanDeviation {
  readonly baselinePlanId: string;
  readonly baselineVersionNo: number;
  readonly mode: BusinessPlanDeviationMode;
  readonly thresholdPercent: number;
  /** Mức lệch bất lợi (%): lợi nhuận giảm bao nhiêu phần trăm, hoặc chiết khấu tăng bao nhiêu điểm phần trăm. */
  readonly deviationPercent: number | null;
  readonly exceeded: boolean;
}

export interface BusinessPlanDetail {
  readonly id: string;
  readonly quoteId: string;
  readonly quoteVersionId: string;
  readonly quoteVersionNo: number;
  readonly status: BusinessPlanStatus;
  /** Số lần sửa, gửi lại khi lưu để chống ghi đè đồng thời. */
  readonly version: number;
  readonly note: string | null;
  /** Người xem có quyền xem giá vốn, lợi nhuận; khi `false`, `figures` rỗng và `lines` rỗng. */
  readonly costVisible: boolean;
  readonly figures: BusinessPlanFigures | null;
  readonly visibleFigures: BusinessPlanVisibleFigures;
  readonly lines: readonly BusinessPlanCostLine[];
  readonly currentRoundNo: number | null;
  readonly submittedAt: string | null;
  readonly submittedBy: string | null;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  /** Mọi vòng duyệt của báo giá (qua các phiên bản), cũ trước. */
  readonly rounds: readonly BusinessPlanRound[];
  /** Sửa được: PAKD đang soạn hoặc bị từ chối, và phiên bản báo giá còn Nháp. */
  readonly editable: boolean;
  /** So với PAKD đã duyệt gần nhất của phiên bản trước; rỗng khi chưa có hoặc không có quyền xem giá vốn. */
  readonly deviation: BusinessPlanDeviation | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BusinessPlanCostLineInput {
  readonly kind: BusinessPlanCostKind;
  readonly description?: string | null;
  readonly amount: number;
}

/** Tạo hoặc sửa PAKD: `version` bắt buộc khi sửa, bỏ khi tạo. */
export interface SaveBusinessPlanRequest {
  readonly version?: number;
  readonly note?: string | null;
  readonly lines?: readonly BusinessPlanCostLineInput[];
  /** Khi tạo: chép dòng chi phí từ PAKD của phiên bản này (cùng báo giá). */
  readonly copyFromVersionNo?: number | null;
}

export interface BusinessPlanVersionRequest {
  readonly version: number;
}

export interface BusinessPlanDecisionRequest extends BusinessPlanVersionRequest {
  readonly reason?: string | null;
}

// ---------------------------------------------------------------------------
// Cấu hình so lệch (Cài đặt CRM)
// ---------------------------------------------------------------------------

export const BUSINESS_PLAN_DEVIATION_MODES = ['PROFIT', 'DISCOUNT'] as const;
export type BusinessPlanDeviationMode = (typeof BUSINESS_PLAN_DEVIATION_MODES)[number];

export const BUSINESS_PLAN_DEVIATION_MODE_LABELS: Readonly<Record<BusinessPlanDeviationMode, string>> = {
  PROFIT: 'Theo lợi nhuận',
  DISCOUNT: 'Theo chiết khấu',
};

/**
 * Khi sửa báo giá đã có PAKD đã duyệt (phiên bản mới), so với PAKD đã duyệt gần nhất:
 * `PROFIT`: lợi nhuận giảm quá `thresholdPercent` phần trăm; `DISCOUNT`: tỷ lệ chiết khấu tăng quá
 * `thresholdPercent` điểm phần trăm. Vượt (lớn hơn, không phải bằng) thì buộc trình duyệt lại.
 */
export interface BusinessPlanDeviationSettings {
  readonly mode: BusinessPlanDeviationMode;
  readonly thresholdPercent: number;
}

/** Tenant chưa cấu hình: so theo lợi nhuận, ngưỡng 5% (quyết định P2-D15). */
export const DEFAULT_BUSINESS_PLAN_DEVIATION_SETTINGS: BusinessPlanDeviationSettings = {
  mode: 'PROFIT',
  thresholdPercent: 5,
};

/** Mã lý do cần duyệt của PAKD trong `QuoteApprovalReason`. */
export const BUSINESS_PLAN_APPROVAL_REASON = 'BUSINESS_PLAN';
export const BUSINESS_PLAN_DEVIATION_REASON = 'PLAN_DEVIATION';
