/**
 * Hợp đồng bán hàng, giá khung và đợt thanh toán (GĐ4).
 *
 * Ba loại: mua bán (một lần giao theo dòng có số lượng), khung và nguyên tắc
 * (giá khung cho nhiều đơn). Máy trạng thái theo mục 5.3 kế hoạch. Xác nhận
 * hợp đồng giữ hàng ở Kho cho dòng hàng tồn kho có số lượng (tất cả hoặc không).
 */

export const CONTRACT_TYPES = ['SALE', 'FRAMEWORK', 'PRINCIPLE'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_TYPE_LABELS: Readonly<Record<ContractType, string>> = {
  SALE: 'Hợp đồng mua bán',
  FRAMEWORK: 'Hợp đồng khung',
  PRINCIPLE: 'Hợp đồng nguyên tắc',
};

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'LIQUIDATED', 'CANCELLED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Readonly<Record<ContractStatus, string>> = {
  DRAFT: 'Nháp',
  ACTIVE: 'Hiệu lực',
  COMPLETED: 'Hoàn thành',
  EXPIRED: 'Hết hạn',
  LIQUIDATED: 'Đã thanh lý',
  CANCELLED: 'Đã huỷ',
};

/** Bảng chuyển trạng thái (mục 5.3). Server kiểm bằng chính bảng này; giao diện dùng để ẩn hiện nút. */
export const CONTRACT_STATUS_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'EXPIRED', 'CANCELLED'],
  COMPLETED: ['LIQUIDATED'],
  EXPIRED: ['LIQUIDATED'],
  LIQUIDATED: [],
  CANCELLED: [],
};

export const PAYMENT_TERM_CONDITIONS = ['DATE', 'SIGN', 'DELIVERY', 'ACCEPTANCE'] as const;
export type PaymentTermCondition = (typeof PAYMENT_TERM_CONDITIONS)[number];

export const PAYMENT_TERM_CONDITION_LABELS: Readonly<Record<PaymentTermCondition, string>> = {
  DATE: 'Theo ngày',
  SIGN: 'Khi ký hợp đồng',
  DELIVERY: 'Khi giao hàng',
  ACCEPTANCE: 'Khi nghiệm thu',
};

/** Trạng thái đợt thanh toán. GĐ4 chỉ lưu "Chưa đến hạn"; sinh khoản phải thu theo đợt ở GĐ5 (T5-05). */
export const PAYMENT_TERM_STATUSES = ['PENDING', 'DUE', 'INVOICED', 'PAID', 'CANCELLED'] as const;
export type PaymentTermStatus = (typeof PAYMENT_TERM_STATUSES)[number];

export const PAYMENT_TERM_STATUS_LABELS: Readonly<Record<PaymentTermStatus, string>> = {
  PENDING: 'Chưa đến hạn',
  DUE: 'Đến hạn',
  INVOICED: 'Đã ghi nợ',
  PAID: 'Đã thu',
  CANCELLED: 'Đã huỷ',
};

/** Số đợt thanh toán tối đa của một hợp đồng. */
export const PAYMENT_TERMS_MAX = 24;
/** Số dòng tối đa của một hợp đồng. */
export const CONTRACT_LINES_MAX = 200;
/** Cảnh báo hợp đồng sắp hết hạn trước số ngày này nếu chưa cấu hình (CON-06). */
export const DEFAULT_CONTRACT_EXPIRING_DAYS = 30;

/** Trạng thái phần giữ hàng của hợp đồng hoặc dòng đơn (bản ghi phía Bán hàng). */
export const RESERVATION_STATUSES = ['HELD', 'RELEASED', 'EXPIRED'] as const;
export type CrmReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_STATUS_LABELS: Readonly<Record<CrmReservationStatus, string>> = {
  HELD: 'Đang giữ',
  RELEASED: 'Đã nhả',
  EXPIRED: 'Hết hạn giữ',
};

/** Sự kiện outbox (skill `erp-events`). Nguồn lịch của notification-worker phát `crm.contract.expiring`. */
export const CRM_CONTRACT_EXPIRING = 'crm.contract.expiring';
export const CRM_CONTRACT_RESERVATION_LOST = 'crm.contract.reservation-lost';
/**
 * Job nhả phần giữ hàng còn lại của hợp đồng đã hết hạn hoặc đã huỷ (T4-18),
 * báo người phụ trách. Payload cùng hình dạng `CrmReservationLostPayload`.
 */
export const CRM_CONTRACT_RESERVATION_RELEASED = 'crm.contract.reservation-released';

export interface CrmContractExpiringPayload {
  readonly contractId: string;
  readonly contractCode: string;
  readonly endDate: string;
  readonly ownerUserId: string;
  readonly daysLeft: number;
  readonly summary: string;
  readonly deepLink: string;
}

/** Đường dẫn mở hợp đồng trên giao diện (thông báo, dòng thời gian). */
export function contractDeepLink(contractId: string): string {
  return `/modules/crm#contracts/${encodeURIComponent(contractId)}`;
}

// ---------------------------------------------------------------------------
// Dữ liệu hợp đồng
// ---------------------------------------------------------------------------

/** Một dòng hợp đồng: giá khung (trước VAT) của mặt hàng; số lượng có với hợp đồng mua bán. */
export interface ContractLine {
  readonly id: string;
  readonly lineNo: number;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  /** STOCK hoặc SERVICE; dịch vụ không giữ hàng. */
  readonly materialKind: string;
  /** Rỗng với hợp đồng khung, nguyên tắc (chỉ chốt giá). */
  readonly quantity: number | null;
  /** Giá khung trước VAT; engine giá dùng làm đơn giá gốc nguồn "Hợp đồng". */
  readonly unitPrice: number;
  readonly vatRate: number;
  /** Chiết khấu đã áp ở báo giá gốc (chỉ để tham khảo). */
  readonly discountPercent: number;
  /** Số lượng × đơn giá, làm tròn đến đồng; rỗng khi không có số lượng. */
  readonly lineAmount: number | null;
  readonly note: string | null;
}

export interface PaymentTerm {
  readonly id: string;
  readonly seq: number;
  readonly name: string;
  /** Có khi đợt nhập theo phần trăm; rỗng khi nhập số tiền. */
  readonly percent: number | null;
  /** Số tiền của đợt (tính từ phần trăm nếu nhập phần trăm). */
  readonly amount: number;
  readonly condition: PaymentTermCondition;
  /** Bắt buộc với điều kiện "Theo ngày". */
  readonly dueDate: string | null;
  /** Số ngày phải thu sau khi điều kiện xảy ra (ký, giao, nghiệm thu). */
  readonly dueDays: number | null;
  readonly status: PaymentTermStatus;
  readonly note: string | null;
}

export interface ContractReservation {
  readonly reservationId: string;
  readonly reservationCode: string;
  readonly status: CrmReservationStatus;
  readonly expiresAt: string | null;
}

/** Một dòng nhật ký chuyển trạng thái (hợp đồng, đơn bán). */
export interface CrmHistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly action: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly actorId: string | null;
  readonly reason: string | null;
}

export interface ContractSummary {
  readonly id: string;
  readonly code: string;
  readonly type: ContractType;
  readonly title: string;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly status: ContractStatus;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly value: number;
  readonly ownerUserId: string;
  readonly quoteId: string | null;
  readonly quoteCode: string | null;
  readonly updatedAt: string;
}

/** Đơn bán gắn hợp đồng, hiện trong chi tiết hợp đồng. */
export interface ContractOrderRef {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly totalAmount: number;
  readonly orderDate: string;
}

export interface ContractDetail extends ContractSummary {
  readonly signedDate: string | null;
  readonly warrantyMonths: number | null;
  /** Kho giữ hàng khi xác nhận. */
  readonly warehouseCode: string | null;
  readonly note: string | null;
  /** Tăng mỗi lần lưu; gửi lại khi sửa để không ghi đè người khác. */
  readonly revision: number;
  readonly lines: readonly ContractLine[];
  readonly paymentTerms: readonly PaymentTerm[];
  readonly reservation: ContractReservation | null;
  readonly orders: readonly ContractOrderRef[];
  readonly history: readonly CrmHistoryEntry[];
  readonly createdAt: string;
}

export interface ContractListQuery {
  readonly q?: string;
  readonly status?: ContractStatus;
  readonly type?: ContractType;
  readonly customerId?: string;
  readonly ownerUserId?: string;
  /** Chỉ hợp đồng Hiệu lực hết hạn trong số ngày này. */
  readonly expiringWithinDays?: number;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SaveContractLineRequest {
  readonly materialId: string;
  /** Bắt buộc với hợp đồng mua bán. */
  readonly quantity?: number | null;
  /** Mặc định đơn vị trong danh mục Kho. */
  readonly unit?: string | null;
  readonly unitPrice: number;
  /** Mặc định 10%. */
  readonly vatRate?: number | null;
  readonly note?: string | null;
}

export interface SaveContractRequest {
  /** Bắt buộc khi sửa. */
  readonly revision?: number;
  readonly type: ContractType;
  readonly customerId: string;
  readonly title: string;
  readonly signedDate?: string | null;
  readonly validFrom: string;
  readonly validTo?: string | null;
  /** Giá trị hợp đồng; bỏ trống thì cộng thành tiền gồm VAT của các dòng có số lượng. */
  readonly value?: number | null;
  readonly warrantyMonths?: number | null;
  readonly warehouseCode?: string | null;
  readonly ownerUserId?: string | null;
  readonly note?: string | null;
  /** Thay toàn bộ dòng; bỏ trống khi sửa thì giữ dòng đang có. */
  readonly lines?: readonly SaveContractLineRequest[];
}

export interface SavePaymentTermRequest {
  readonly name: string;
  /** Nhập phần trăm hoặc số tiền, không cả hai. */
  readonly percent?: number | null;
  readonly amount?: number | null;
  readonly condition: PaymentTermCondition;
  readonly dueDate?: string | null;
  readonly dueDays?: number | null;
  readonly note?: string | null;
}

export interface SavePaymentTermsRequest {
  readonly revision: number;
  readonly terms: readonly SavePaymentTermRequest[];
}

export interface ContractActionRequest {
  readonly revision: number;
  readonly reason?: string | null;
}

/** Một dòng thiếu tồn khi giữ hàng (Q4: giữ tất cả hoặc không), trả kèm lỗi 409. */
export interface CrmStockShortage {
  readonly lineNo: number | null;
  readonly materialCode: string;
  readonly warehouseCode: string;
  readonly requested: number;
  readonly available: number;
}
