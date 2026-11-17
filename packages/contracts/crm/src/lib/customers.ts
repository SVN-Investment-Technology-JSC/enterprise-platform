/**
 * Khách hàng, người liên hệ, nhóm khách và cấu hình mã (GĐ2). Kiểu request,
 * response dùng chung giữa giao diện và API.
 */

/** Trang kết quả phân trang keyset: `nextCursor` rỗng khi đã hết. */
export interface CrmPage<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
  /** Khi gọi kèm `page` (phân trang theo số trang): trang đang xem và tổng số dòng khớp bộ lọc. */
  readonly page?: number;
  readonly total?: number;
}

/** Số dòng tối đa một trang danh sách. */
export const CRM_PAGE_LIMIT_MAX = 100;
export const CRM_PAGE_LIMIT_DEFAULT = 30;
/** Số dòng một trang của mọi danh sách trên giao diện CRM. */
export const CRM_LIST_PAGE_SIZE = 15;
/** Độ dài tối đa chuỗi tìm kiếm; dài hơn trả 400. */
export const CRM_SEARCH_MAX_LENGTH = 100;

/**
 * Phân loại khách hàng là danh mục tenant tự cấu hình (`crm_schema.customer_kinds`), giá trị là mã phân loại.
 * Ba mã dưới đây là phân loại hệ thống: luôn có, không xoá, không đổi mã (đổi tên được).
 */
export const SYSTEM_CUSTOMER_KINDS = ['LEAD_CUSTOMER', 'CUSTOMER', 'INACTIVE'] as const;
export type CustomerKind = string;
/** Phân loại của khách mới khi không chọn, và của khách tạo từ lead. */
export const DEFAULT_CUSTOMER_KIND: CustomerKind = 'LEAD_CUSTOMER';

export interface CustomerKindOption {
  readonly code: CustomerKind;
  readonly name: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly sortOrder: number;
  /** Số khách đang thuộc phân loại. */
  readonly customerCount: number;
}

export interface SaveCustomerKindRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sortOrder?: number | null;
}

export interface CustomerGroup {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  /** Số khách đang thuộc nhóm. */
  readonly customerCount: number;
}

export interface SaveCustomerGroupRequest {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null;
}

/** Dòng trên danh sách khách hàng. */
export interface CustomerSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly taxCode: string | null;
  readonly province: string | null;
  readonly region: string | null;
  readonly kind: CustomerKind;
  /** Tên phân loại để hiển thị. */
  readonly kindName: string;
  readonly groupId: string | null;
  readonly groupName: string | null;
  /**
   * Bảng giá áp cho khách (D3-38), chọn ở hồ sơ khách; không phụ thuộc nhóm khách. Rỗng, hết hiệu lực hoặc đã tắt thì
   * tính theo bảng giá chuẩn.
   */
  readonly priceListId: string | null;
  readonly priceListCode: string | null;
  readonly priceListName: string | null;
  readonly ownerUserId: string;
  readonly primaryContactName: string | null;
  readonly updatedAt: string;
}

export interface CustomerContact {
  readonly id: string;
  readonly customerId: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly note: string | null;
  readonly isPrimary: boolean;
}

export interface CustomerDetail extends CustomerSummary {
  readonly address: string | null;
  readonly industry: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly creditLimit: number | null;
  readonly paymentTermDays: number | null;
  readonly note: string | null;
  /** Chân dung khách hàng: ghi chú tự do (P2F-03); `null` là chưa ghi. */
  readonly profileNote: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly contacts: readonly CustomerContact[];
}

/** Trường nhập của khách hàng; dùng cho cả tạo và sửa. */
export interface CustomerFields {
  readonly name: string;
  readonly taxCode?: string | null;
  readonly address?: string | null;
  readonly province?: string | null;
  readonly region?: string | null;
  readonly industry?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly groupId?: string | null;
  /** Bảng giá áp cho khách (D3-38); `null` là theo bảng giá chuẩn. Bỏ trống khi sửa thì giữ nguyên. */
  readonly priceListId?: string | null;
  readonly kind?: CustomerKind;
  readonly creditLimit?: number | null;
  readonly paymentTermDays?: number | null;
  readonly note?: string | null;
  /** Rỗng thì là người tạo. */
  readonly ownerUserId?: string | null;
}

export interface CreateCustomerRequest extends CustomerFields {
  /** Rỗng thì sinh theo cấu hình `customer.code`. */
  readonly code?: string | null;
  /** Đã xem cảnh báo trùng MST và vẫn muốn lưu. */
  readonly confirmDuplicateTaxCode?: boolean;
}

export interface UpdateCustomerRequest extends CustomerFields {
  readonly code: string;
  /** `version` đang xem; khác bản trong DB thì 409. */
  readonly version: number;
  readonly confirmDuplicateTaxCode?: boolean;
}

/** Lưu khối "Chân dung khách hàng" (P2F-03). Chuỗi rỗng hoặc `null` là xoá. */
export interface SaveCustomerProfileRequest {
  readonly profileNote: string | null;
  /** `version` đang xem; khác bản trong DB thì 409. */
  readonly version: number;
}

/** Độ dài tối đa của chân dung khách hàng. */
export const CUSTOMER_PROFILE_NOTE_MAX = 4000;

export interface CustomerListQuery {
  readonly q?: string;
  readonly groupId?: string;
  readonly kind?: CustomerKind;
  readonly ownerUserId?: string;
  readonly cursor?: string;
  /** Trang cần xem (từ 1), thay cho `cursor`: trả kèm `page` và `total` để chọn trang bất kỳ. */
  readonly page?: number;
  readonly limit?: number;
}

/** Khách đã có cùng MST, trả kèm cảnh báo trùng. */
export interface TaxCodeMatch {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/** Mã lỗi khi MST trùng và chưa xác nhận; thân lỗi có `matches`. */
export const CRM_DUPLICATE_TAX_CODE = 'DUPLICATE_TAX_CODE';

export interface SaveContactRequest {
  readonly fullName: string;
  readonly title?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly note?: string | null;
  readonly isPrimary?: boolean;
}

/** Cấu hình của phân hệ mà giao diện đọc và quản trị bán hàng sửa. */
export interface CrmSettings {
  readonly customerCode: { readonly prefix: string; readonly length: number };
  /** Nhắc hoạt động trước hạn bao nhiêu phút. */
  readonly activityReminderMinutes: number;
}

export const CUSTOMER_CODE_PREFIX_MAX = 10;
export const CUSTOMER_CODE_LENGTH_MIN = 3;
export const CUSTOMER_CODE_LENGTH_MAX = 12;
export const ACTIVITY_REMINDER_MINUTES_MAX = 7 * 24 * 60;

/** Người trong tổ chức, để chọn người phụ trách, người được giao. */
export interface CrmPerson {
  readonly userId: string;
  readonly displayName: string;
}
