/**
 * Bảng giá, chính sách chiết khấu và kết quả tính giá (GĐ3a). Kiểu request,
 * response dùng chung giữa giao diện và API.
 *
 * Quy tắc tính (Q3 trong `docs/crm/plan_crm.md`): giá lấy theo thứ tự giá hợp
 * đồng, bảng giá nhóm khách, bảng giá chuẩn; chiết khấu cộng phần trăm trên giá
 * gốc rồi cắt theo trần tổng; tiền làm tròn đến đồng theo từng dòng, kiểu xa số
 * 0; VAT tính trên thành tiền sau chiết khấu của từng dòng; phí vận chuyển là
 * một dòng dịch vụ có thuế suất riêng.
 */

export const PRICING_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PricingStatus = (typeof PRICING_STATUSES)[number];

export const PRICING_STATUS_LABELS: Readonly<Record<PricingStatus, string>> = {
  ACTIVE: 'Đang áp dụng',
  INACTIVE: 'Ngừng áp dụng',
};

/** Trần tổng chiết khấu mặc định (phần trăm trên giá gốc). */
export const DEFAULT_DISCOUNT_CAP_PERCENT = 10;
/** Thuế suất mặc định của dòng giá và của phí vận chuyển. */
export const DEFAULT_VAT_RATE = 10;
/** Số dòng giá tối đa một lần dán. */
export const PRICE_LIST_ITEMS_BULK_MAX = 500;
/** Số dòng tối đa một lần thử tính giá. */
export const QUOTE_PREVIEW_LINES_MAX = 200;
/** Số tiêu chí tối đa của một chính sách. */
export const DISCOUNT_POLICY_RULES_MAX = 100;

// ---------------------------------------------------------------------------
// Bảng giá
// ---------------------------------------------------------------------------

export interface PriceListGroupRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface PriceListSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isStandard: boolean;
  readonly currency: 'VND';
  /** `YYYY-MM-DD`, tính trọn ngày theo giờ Việt Nam. */
  readonly validFrom: string;
  /** Rỗng là không hết hạn. */
  readonly validTo: string | null;
  readonly status: PricingStatus;
  readonly note: string | null;
  readonly itemCount: number;
  /** Nhóm khách áp bảng giá; bảng chuẩn luôn rỗng. */
  readonly customerGroups: readonly PriceListGroupRef[];
  readonly updatedAt: string;
}

export interface PriceListItem {
  readonly id: string;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly price: number;
  readonly vatRate: number;
}

export interface PriceListDetail extends PriceListSummary {
  readonly items: readonly PriceListItem[];
}

export interface SavePriceListRequest {
  readonly code: string;
  readonly name: string;
  readonly isStandard?: boolean;
  readonly validFrom: string;
  readonly validTo?: string | null;
  readonly status?: PricingStatus;
  readonly note?: string | null;
  /** Bỏ trống thì giữ nguyên nhóm đang gán (khi sửa). */
  readonly customerGroupIds?: readonly string[];
}

export interface AssignPriceListGroupsRequest {
  readonly customerGroupIds: readonly string[];
}

/**
 * Một dòng giá. Danh mục Kho chưa có API nội bộ (T1-24) nên mã, tên, đơn vị
 * lấy theo người nhập; khi có API thì server ghi đè mã, tên theo danh mục.
 */
export interface SavePriceListItemRequest {
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly price: number;
  readonly vatRate?: number;
}

export interface BulkPriceListItemsRequest {
  /** Thêm mới, hoặc cập nhật dòng cùng mặt hàng và đơn vị. */
  readonly items: readonly SavePriceListItemRequest[];
}

// ---------------------------------------------------------------------------
// Chính sách chiết khấu
// ---------------------------------------------------------------------------

export const DISCOUNT_STACKING = ['STACK', 'MAX'] as const;
export type DiscountStacking = (typeof DISCOUNT_STACKING)[number];

export const DISCOUNT_STACKING_LABELS: Readonly<Record<DiscountStacking, string>> = {
  STACK: 'Cộng dồn',
  MAX: 'Lấy mức cao nhất',
};

export const DISCOUNT_CRITERIA = [
  'QUANTITY',
  'PERIOD',
  'CUSTOMER',
  'CUSTOMER_GROUP',
  'MATERIAL',
  'MATERIAL_CATEGORY',
] as const;
export type DiscountCriterion = (typeof DISCOUNT_CRITERIA)[number];

export const DISCOUNT_CRITERION_LABELS: Readonly<Record<DiscountCriterion, string>> = {
  QUANTITY: 'Bậc số lượng',
  PERIOD: 'Thời gian',
  CUSTOMER: 'Khách hàng',
  CUSTOMER_GROUP: 'Nhóm khách hàng',
  MATERIAL: 'Mặt hàng',
  MATERIAL_CATEGORY: 'Nhóm hàng',
};

/**
 * Một tiêu chí. Tiêu chí chia bốn chiều: số lượng; thời gian; khách hàng hoặc
 * nhóm khách; mặt hàng hoặc nhóm hàng. Các chiều kết hợp AND, các dòng trong
 * cùng một chiều kết hợp OR. Bậc số lượng là các dòng QUANTITY của cùng chính
 * sách, mỗi bậc có phần trăm riêng và không được chồng nhau; số lượng tính
 * theo từng dòng báo giá.
 */
export interface DiscountPolicyRule {
  readonly criterion: DiscountCriterion;
  /** QUANTITY: số lượng tối thiểu (gồm cả mốc). */
  readonly minQty?: number | null;
  /** QUANTITY: số lượng tối đa (gồm cả mốc); rỗng là không giới hạn. */
  readonly maxQty?: number | null;
  /** CUSTOMER, CUSTOMER_GROUP, MATERIAL: id đối tượng. */
  readonly refId?: string | null;
  /** Mã hoặc tên để hiển thị; với MATERIAL_CATEGORY là loại hàng cần khớp. */
  readonly refText?: string | null;
  /** PERIOD: từ ngày, đến ngày (`YYYY-MM-DD`). */
  readonly fromDate?: string | null;
  readonly toDate?: string | null;
  /** QUANTITY: phần trăm chiết khấu của bậc. */
  readonly percent?: number | null;
}

export interface DiscountPolicy {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Số nhỏ là ưu tiên cao. */
  readonly priority: number;
  readonly stacking: DiscountStacking;
  readonly exclusive: boolean;
  /** Phần trăm khi chính sách không có bậc số lượng. */
  readonly percent: number | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly status: PricingStatus;
  readonly appliesToAllCustomers: boolean;
  readonly note: string | null;
  readonly rules: readonly DiscountPolicyRule[];
  readonly updatedAt: string;
}

export interface SaveDiscountPolicyRequest {
  readonly code: string;
  readonly name: string;
  readonly priority?: number;
  readonly stacking?: DiscountStacking;
  readonly exclusive?: boolean;
  readonly percent?: number | null;
  readonly validFrom: string;
  readonly validTo?: string | null;
  readonly status?: PricingStatus;
  readonly appliesToAllCustomers?: boolean;
  readonly note?: string | null;
  readonly rules?: readonly DiscountPolicyRule[];
}

export interface PricingSettings {
  /** Trần tổng chiết khấu theo chính sách, phần trăm trên giá gốc. */
  readonly discountCapPercent: number;
}

// ---------------------------------------------------------------------------
// Tính giá
// ---------------------------------------------------------------------------

export const PRICE_SOURCES = ['CONTRACT', 'GROUP_LIST', 'STANDARD_LIST', 'MANUAL'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export const PRICE_SOURCE_LABELS: Readonly<Record<PriceSource, string>> = {
  CONTRACT: 'Hợp đồng',
  GROUP_LIST: 'Bảng giá nhóm',
  STANDARD_LIST: 'Bảng giá chuẩn',
  MANUAL: 'Nhập tay',
};

export interface QuotePreviewLine {
  readonly materialId: string;
  readonly materialCode?: string | null;
  readonly materialName?: string | null;
  /** Loại hàng cho tiêu chí "Nhóm hàng"; danh mục Kho có thì server lấy theo danh mục. */
  readonly category?: string | null;
  readonly quantity: number;
  readonly unit: string;
  /** Ghi đè đơn giá sau chiết khấu; dòng được đánh dấu `overridden`. */
  readonly overrideUnitPrice?: number | null;
  /** Ghi đè phần trăm chiết khấu (thay cho chính sách); dòng được đánh dấu `overridden`. */
  readonly overrideDiscountPercent?: number | null;
}

export interface QuotePreviewRequest {
  /** Khách hàng (phải nằm trong phạm vi dữ liệu); nhóm lấy theo hồ sơ khách. */
  readonly customerId?: string | null;
  /** Dùng khi chưa chọn khách, để thử chính sách của một nhóm. */
  readonly customerGroupId?: string | null;
  /** Ngày tính giá `YYYY-MM-DD`; mặc định hôm nay theo giờ Việt Nam. */
  readonly date?: string | null;
  readonly lines: readonly QuotePreviewLine[];
  readonly shipping?: { readonly amount: number; readonly vatRate?: number | null } | null;
}

export interface AppliedDiscountPolicy {
  readonly policyId: string;
  readonly code: string;
  readonly name: string;
  readonly stacking: DiscountStacking;
  readonly exclusive: boolean;
  readonly percent: number;
}

export interface PricedLine {
  /** Vị trí dòng trong request, từ 0. */
  readonly index: number;
  readonly materialId: string;
  readonly materialCode: string | null;
  readonly materialName: string | null;
  readonly category: string | null;
  readonly unit: string;
  readonly quantity: number;
  /** Đơn giá gốc trước chiết khấu. */
  readonly listPrice: number;
  readonly priceSource: PriceSource;
  /** Bảng giá hoặc hợp đồng cho đơn giá gốc. */
  readonly priceReferenceId: string | null;
  readonly priceReferenceCode: string | null;
  /** Chính sách đã áp (sau khi xét độc quyền, lấy cao nhất). */
  readonly appliedPolicies: readonly AppliedDiscountPolicy[];
  /** Phần trăm chính sách đề xuất, đã cắt trần. */
  readonly policyPercent: number;
  /** Phần trăm chiết khấu thực tế của dòng (bằng `policyPercent` khi không ghi đè). */
  readonly discountPercent: number;
  /** Trần tổng khi tổng chính sách vượt trần ("chạm trần"); không vượt thì rỗng. */
  readonly cappedAt: number | null;
  readonly overridden: boolean;
  /** Đơn giá sau chiết khấu, 2 chữ số thập phân (chỉ để hiển thị). */
  readonly unitPriceAfterDiscount: number;
  /** Đơn giá gốc × số lượng, làm tròn đến đồng. */
  readonly grossAmount: number;
  readonly discountAmount: number;
  /** Thành tiền sau chiết khấu, trước VAT, làm tròn đến đồng. */
  readonly lineAmount: number;
  readonly vatRate: number;
  readonly vatAmount: number;
  readonly lineTotal: number;
}

export interface PricedShipping {
  readonly amount: number;
  readonly vatRate: number;
  readonly vatAmount: number;
  readonly total: number;
}

export interface PricingTotals {
  readonly grossAmount: number;
  readonly discountAmount: number;
  /** Cộng thành tiền sau chiết khấu của các dòng hàng. */
  readonly netAmount: number;
  readonly shippingAmount: number;
  /** VAT các dòng hàng cộng VAT phí vận chuyển. */
  readonly vatAmount: number;
  readonly totalAmount: number;
}

export interface PricingResult {
  readonly date: string;
  readonly customerId: string | null;
  readonly customerGroupId: string | null;
  readonly discountCapPercent: number;
  readonly lines: readonly PricedLine[];
  readonly shipping: PricedShipping | null;
  readonly totals: PricingTotals;
}
