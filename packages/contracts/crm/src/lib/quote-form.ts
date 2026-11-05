/**
 * Báo giá theo mẫu (GĐI): mẫu báo giá, loại báo giá, mã báo giá theo mẫu cấu hình, chiết khấu và thuế tổng đơn,
 * phí trên hợp đồng.
 *
 * Mẫu báo giá quyết định chiết khấu và thuế tính theo dòng (`LINE`, như engine giá phase 1) hay theo tổng đơn
 * (`ORDER`): đã chốt tạm theo đề xuất Q-P2-8, để không tính trùng chiết khấu và VAT.
 */

export const QUOTE_ADJUSTMENT_MODES = ['LINE', 'ORDER'] as const;
export type QuoteAdjustmentMode = (typeof QUOTE_ADJUSTMENT_MODES)[number];

export const QUOTE_ADJUSTMENT_MODE_LABELS: Readonly<Record<QuoteAdjustmentMode, string>> = {
  LINE: 'Theo dòng',
  ORDER: 'Theo tổng đơn',
};

/** Số khoản phí tối đa trên một phiên bản. */
export const QUOTE_FEES_MAX = 20;

export interface QuoteTemplate {
  readonly id: string;
  readonly name: string;
  readonly discountMode: QuoteAdjustmentMode;
  readonly taxMode: QuoteAdjustmentMode;
  readonly description: string | null;
  readonly active: boolean;
  readonly isDefault: boolean;
  readonly sortOrder: number;
}

export interface QuoteType {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly isDefault: boolean;
  readonly sortOrder: number;
}

export interface SaveQuoteTemplateRequest {
  readonly name: string;
  readonly discountMode: QuoteAdjustmentMode;
  readonly taxMode: QuoteAdjustmentMode;
  readonly description?: string | null;
  readonly active?: boolean;
  readonly isDefault?: boolean;
  readonly sortOrder?: number;
}

export interface SaveQuoteTypeRequest {
  readonly name: string;
  readonly description?: string | null;
  readonly active?: boolean;
  readonly isDefault?: boolean;
  readonly sortOrder?: number;
}

/** Chiết khấu hoặc thuế tổng đơn: nhập phần trăm hoặc số tiền, không nhập cả hai. */
export interface QuoteOrderAmountInput {
  readonly percent?: number | null;
  readonly amount?: number | null;
}

/** Giá trị đã tính: nhập số tiền thì `percent` là phần trăm tính ngược, nhập phần trăm thì `amount` là số tiền. */
export interface QuoteOrderAmount {
  readonly percent: number;
  readonly amount: number;
  /** Kiểu người dùng đã nhập; rỗng khi không nhập. */
  readonly inputKind: 'PERCENT' | 'AMOUNT' | null;
}

export interface QuoteFee {
  readonly feeType: string;
  readonly amount: number;
}

/** Các trường theo mẫu của một phiên bản báo giá. */
export interface QuoteFormData {
  readonly quoteName: string | null;
  readonly quoteDate: string | null;
  readonly templateId: string | null;
  readonly templateName: string | null;
  readonly quoteTypeId: string | null;
  readonly quoteTypeName: string | null;
  readonly discountMode: QuoteAdjustmentMode;
  readonly taxMode: QuoteAdjustmentMode;
  readonly orderDiscount: QuoteOrderAmount;
  readonly orderTax: QuoteOrderAmount;
  readonly fees: readonly QuoteFee[];
  readonly feesAmount: number;
  /** Giá trị trường tuỳ biến theo id định nghĩa (P2I-06); báo giá cũ chưa nhập thì rỗng `{}`. */
  readonly customFields: QuoteCustomFields;
}

/** Mẫu mã báo giá, lưu ở Cài đặt: ví dụ `{yyyymmdd}/BG//{seq}` cho ra `20261102/BG//383`. */
export interface QuoteCodeSettings {
  /** Rỗng: dùng mã mặc định `BG<yy><5 chữ số>`. */
  readonly pattern: string | null;
  /** Mã sẽ sinh nếu sinh ngay (chỉ xem trước, chưa chiếm số). */
  readonly example: string;
}

export interface SaveQuoteCodeSettingsRequest {
  readonly pattern?: string | null;
}

export interface GeneratedQuoteCode {
  readonly code: string;
}

export const QUOTE_CODE_PATTERN_HELP =
  'Mẫu mã dùng {yyyymmdd}, {yyyy}, {yy}, {mm}, {dd} và đúng một {seq} (hoặc {seq:N} đệm số 0 đủ N chữ số); ' +
  'phần còn lại là chữ không dấu, số, / . _ -.';

// ---------------------------------------------------------------------------
// Trường tuỳ biến (P2I-06)
// ---------------------------------------------------------------------------

/** Đối tượng có trường tuỳ biến; đợt này chỉ báo giá, mở rộng bằng cách thêm giá trị (kèm migration nới ràng buộc). */
export const CUSTOM_FIELD_ENTITY_TYPES = ['quote'] as const;
export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];

export const CUSTOM_FIELD_TYPES = ['SELECT', 'TEXT', 'NUMBER', 'DATE'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Readonly<Record<CustomFieldType, string>> = {
  SELECT: 'Danh sách chọn',
  TEXT: 'Văn bản',
  NUMBER: 'Số',
  DATE: 'Ngày',
};

/** Số trường tuỳ biến tối đa cho một loại đối tượng, và số lựa chọn tối đa của một trường danh sách. */
export const CUSTOM_FIELDS_MAX = 50;
export const CUSTOM_FIELD_OPTIONS_MAX = 100;

export interface CustomFieldDefinition {
  readonly id: string;
  readonly entityType: CustomFieldEntityType;
  readonly name: string;
  readonly fieldType: CustomFieldType;
  /** Lựa chọn khi `fieldType = 'SELECT'`; các kiểu khác rỗng. */
  readonly options: readonly string[];
  readonly required: boolean;
  readonly sortOrder: number;
  readonly active: boolean;
}

export interface SaveCustomFieldRequest {
  readonly entityType?: CustomFieldEntityType;
  readonly name: string;
  readonly fieldType: CustomFieldType;
  readonly options?: readonly string[];
  readonly required?: boolean;
  readonly sortOrder?: number;
  /** `false` là tắt trường: không nhập được nữa, giá trị đã lưu giữ nguyên. */
  readonly active?: boolean;
}

/** Giá trị trường: danh sách chọn, văn bản, ngày là chuỗi (ngày dạng `yyyy-mm-dd`); số là số. */
export type CustomFieldValue = string | number;
export type QuoteCustomFields = Readonly<Record<string, CustomFieldValue>>;

// ---------------------------------------------------------------------------
// Người theo dõi và đối tượng liên quan (P2I-07)
// ---------------------------------------------------------------------------

export interface QuoteFollower {
  readonly userId: string;
  readonly addedAt: string;
  readonly addedBy: string | null;
}

export interface AddQuoteFollowerRequest {
  readonly userId: string;
}

export const QUOTE_LINK_TARGET_TYPES = ['CUSTOMER', 'OPPORTUNITY', 'CONTRACT', 'SALES_ORDER', 'QUOTE'] as const;
export type QuoteLinkTargetType = (typeof QUOTE_LINK_TARGET_TYPES)[number];

export const QUOTE_LINK_TARGET_LABELS: Readonly<Record<QuoteLinkTargetType, string>> = {
  CUSTOMER: 'Khách hàng',
  OPPORTUNITY: 'Dự án bán hàng',
  CONTRACT: 'Hợp đồng',
  SALES_ORDER: 'Đơn bán',
  QUOTE: 'Báo giá',
};

/** Số đối tượng liên quan tối đa của một báo giá. */
export const QUOTE_LINKS_MAX = 100;

export interface QuoteLink {
  readonly id: string;
  readonly targetType: QuoteLinkTargetType;
  readonly targetId: string;
  /** Mã hoặc tên để hiển thị. */
  readonly targetLabel: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface AddQuoteLinkRequest {
  readonly targetType: QuoteLinkTargetType;
  readonly targetId: string;
}
