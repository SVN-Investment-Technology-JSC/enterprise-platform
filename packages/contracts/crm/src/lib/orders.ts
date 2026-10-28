/**
 * Đơn bán, kế hoạch giao nhiều đợt, chuyển báo giá thành hợp đồng và đơn (GĐ4).
 *
 * Máy trạng thái đơn theo mục 5.4 kế hoạch. Xác nhận đơn giữ hàng ở Kho (tất
 * cả hoặc không, Q4); mỗi đợt giao tạo một yêu cầu xuất nháp ở Kho; Kho ghi sổ
 * thì phát `inventory.stock.issued` và Bán hàng cập nhật số đã giao, serial,
 * giá vốn thực tế.
 */
import type { CrmHistoryEntry, CrmReservationStatus } from './contracts.js';
import type { AppliedDiscountPolicy, PriceSource } from './pricing.js';
import type { QuoteShipping } from './quotes.js';
import type { OrderCreditRequest, OrderReceivableBalance } from './receivables.js';

export const SALES_ORDER_SOURCES = ['QUOTE', 'CONTRACT', 'DIRECT'] as const;
export type SalesOrderSource = (typeof SALES_ORDER_SOURCES)[number];

export const SALES_ORDER_SOURCE_LABELS: Readonly<Record<SalesOrderSource, string>> = {
  QUOTE: 'Từ báo giá',
  CONTRACT: 'Từ hợp đồng',
  DIRECT: 'Trực tiếp',
};

export const SALES_ORDER_STATUSES = [
  'DRAFT',
  'CREDIT_PENDING',
  'CONFIRMED',
  'DELIVERING',
  'PARTIAL',
  'DELIVERED',
  'DONE',
  'CANCELLED',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const SALES_ORDER_STATUS_LABELS: Readonly<Record<SalesOrderStatus, string>> = {
  DRAFT: 'Nháp',
  CREDIT_PENDING: 'Chờ duyệt hạn mức',
  CONFIRMED: 'Đã xác nhận',
  DELIVERING: 'Đang giao',
  PARTIAL: 'Đã giao một phần',
  DELIVERED: 'Đã giao đủ',
  DONE: 'Hoàn tất',
  CANCELLED: 'Huỷ',
};

/**
 * Bảng chuyển trạng thái (mục 5.4). Đang giao, Đã giao một phần, Đã giao đủ do
 * kết quả xuất kho của Kho quyết định; Hoàn tất khi đã giao đủ và còn phải thu
 * bằng 0 (Q8) hoặc đóng tay có lý do.
 */
export const SALES_ORDER_STATUS_TRANSITIONS: Readonly<Record<SalesOrderStatus, readonly SalesOrderStatus[]>> = {
  DRAFT: ['CONFIRMED', 'CREDIT_PENDING', 'CANCELLED'],
  CREDIT_PENDING: ['CONFIRMED', 'DRAFT', 'CANCELLED'],
  CONFIRMED: ['DELIVERING', 'CANCELLED'],
  DELIVERING: ['PARTIAL', 'DELIVERED', 'CANCELLED'],
  PARTIAL: ['DELIVERING', 'DELIVERED', 'CANCELLED'],
  DELIVERED: ['DONE'],
  DONE: [],
  CANCELLED: [],
};

export const DELIVERY_STATUSES = ['PLANNED', 'REQUESTED', 'ISSUED', 'CANCELLED', 'REVERSED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> = {
  PLANNED: 'Kế hoạch',
  REQUESTED: 'Đã yêu cầu xuất',
  ISSUED: 'Đã xuất kho',
  CANCELLED: 'Đã huỷ',
  REVERSED: 'Đã đảo chứng từ',
};

/** Nguồn phần giữ hàng của dòng đơn: giữ riêng cho đơn, hay dùng phần hợp đồng đã giữ. */
export const RESERVATION_SOURCES = ['ORDER', 'CONTRACT'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

/** Số dòng tối đa của một đơn. */
export const SALES_ORDER_LINES_MAX = 200;
/** Số đợt giao tối đa của một đơn. */
export const DELIVERY_PLANS_MAX = 50;
/** Hạn giữ hàng mặc định tính từ lúc xác nhận (Q12), khi chưa cấu hình `reservation.holdDays`. */
export const DEFAULT_RESERVATION_HOLD_DAYS = 7;
/** Đơn có ngày giao dự kiến: giữ tới ngày đó cộng chừng này ngày (Q12). */
export const RESERVATION_AFTER_DELIVERY_DAYS = 2;
/** Đợt giao mặc định khi chuyển báo giá: sau hôm nay chừng này ngày. */
export const DEFAULT_DELIVERY_LEAD_DAYS = 7;

/** Sự kiện outbox (skill `erp-events`). */
export const CRM_DELIVERY_LATE = 'crm.delivery.late';
export const CRM_ORDER_RESERVATION_LOST = 'crm.order.reservation-lost';

export interface CrmDeliveryLatePayload {
  readonly orderId: string;
  readonly orderCode: string;
  readonly deliveryId: string;
  readonly deliveryCode: string;
  readonly plannedDate: string;
  readonly ownerUserId: string;
  readonly actorUserId: null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

/** Kho báo phần giữ hàng đã hết hạn khi đơn hoặc hợp đồng còn mở: báo người phụ trách. */
export interface CrmReservationLostPayload {
  readonly orderId: string | null;
  readonly contractId: string | null;
  readonly code: string;
  readonly reservationCode: string;
  readonly actorUserId: null;
  readonly recipientUserIds: readonly string[];
  readonly summary: string;
  readonly deepLink: string;
}

/** Đường dẫn mở đơn bán trên giao diện (thông báo, dòng thời gian). */
export function salesOrderDeepLink(orderId: string): string {
  return `/modules/crm#orders/${encodeURIComponent(orderId)}`;
}

// ---------------------------------------------------------------------------
// Dữ liệu đơn bán
// ---------------------------------------------------------------------------

export interface SalesOrderLine {
  readonly id: string;
  readonly lineNo: number;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  /** STOCK hoặc SERVICE; dịch vụ không giữ hàng, không xuất kho. */
  readonly materialKind: string;
  readonly category: string | null;
  readonly quantity: number;
  readonly listPrice: number;
  readonly priceSource: PriceSource;
  readonly priceReferenceCode: string | null;
  readonly appliedPolicies: readonly AppliedDiscountPolicy[];
  readonly discountPercent: number;
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
  /** Giá vốn bình quân lúc lập (ước tính). */
  readonly estUnitCost: number | null;
  /** Số còn đang giữ ở Kho (đã trừ phần đã xuất). */
  readonly reservedQuantity: number;
  /** Tổng số đã đưa vào các đợt giao còn hiệu lực. */
  readonly plannedQuantity: number;
  readonly deliveredQuantity: number;
  /** Giá vốn thực tế từ chứng từ xuất đã ghi sổ. */
  readonly actualCost: number;
  readonly serials: readonly string[];
  /** Id giữ hàng ở Kho; yêu cầu xuất gửi kèm để trừ vào phần đã giữ. */
  readonly reservationId: string | null;
  readonly reservationCode: string | null;
  readonly reservationStatus: CrmReservationStatus | null;
  readonly reservationSource: ReservationSource | null;
}

export interface DeliveryLine {
  readonly id: string;
  readonly orderLineId: string;
  readonly lineNo: number;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly materialKind: string;
  readonly plannedQuantity: number;
  readonly deliveredQuantity: number;
  readonly actualCost: number;
  readonly serials: readonly string[];
}

export interface DeliveryPlan {
  readonly id: string;
  readonly code: string;
  readonly seq: number;
  readonly plannedDate: string;
  readonly warehouseCode: string | null;
  readonly address: string | null;
  readonly note: string | null;
  readonly status: DeliveryStatus;
  readonly issueDocumentId: string | null;
  readonly issueDocumentCode: string | null;
  readonly requestedAt: string | null;
  readonly issuedAt: string | null;
  /** Quá ngày dự kiến mà chưa xuất kho (ORD-06). */
  readonly late: boolean;
  readonly lines: readonly DeliveryLine[];
}

export interface SalesOrderTotals {
  readonly grossAmount: number;
  readonly discountAmount: number;
  readonly netAmount: number;
  readonly shippingAmount: number;
  readonly vatAmount: number;
  readonly totalAmount: number;
}

export interface SalesOrderSummary {
  readonly id: string;
  readonly code: string;
  readonly source: SalesOrderSource;
  readonly customerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly contractId: string | null;
  readonly contractCode: string | null;
  readonly quoteId: string | null;
  readonly quoteCode: string | null;
  readonly status: SalesOrderStatus;
  readonly orderDate: string;
  readonly expectedDeliveryDate: string | null;
  readonly totalAmount: number;
  readonly ownerUserId: string;
  /** Có đợt giao quá ngày dự kiến mà chưa xuất kho. */
  readonly late: boolean;
  /** Số còn phải thu của đơn tính từ sổ công nợ (GĐ5); chưa có sổ thì rỗng. */
  readonly outstanding?: number | null;
  readonly updatedAt: string;
}

export interface SalesOrderDetail extends SalesOrderSummary {
  readonly warehouseCode: string | null;
  readonly deliveryAddress: string | null;
  readonly note: string | null;
  readonly priceDate: string | null;
  readonly shipping: Omit<QuoteShipping, 'cost'>;
  readonly totals: SalesOrderTotals;
  readonly revision: number;
  readonly lines: readonly SalesOrderLine[];
  readonly deliveries: readonly DeliveryPlan[];
  readonly reservationExpiresAt: string | null;
  readonly cancelReason: string | null;
  readonly closeReason: string | null;
  readonly history: readonly CrmHistoryEntry[];
  readonly createdAt: string;
  /** Công nợ của đơn theo sổ (T5-11). */
  readonly receivable?: OrderReceivableBalance | null;
  /** Yêu cầu duyệt vượt hạn mức gần nhất (D5). */
  readonly creditRequest?: OrderCreditRequest | null;
}

export interface SalesOrderListQuery {
  readonly q?: string;
  readonly status?: SalesOrderStatus;
  readonly customerId?: string;
  readonly contractId?: string;
  readonly ownerUserId?: string;
  /** `true`: chỉ đơn có đợt giao trễ. */
  readonly late?: boolean | string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface SaveSalesOrderLineRequest {
  readonly materialId: string;
  readonly quantity: number;
  readonly unit?: string | null;
  readonly overrideUnitPrice?: number | null;
  readonly overrideDiscountPercent?: number | null;
}

export interface CreateSalesOrderRequest {
  /** Đơn trực tiếp: khách hàng. Đơn từ hợp đồng: lấy theo hợp đồng. */
  readonly customerId?: string | null;
  readonly contractId?: string | null;
  readonly ownerUserId?: string | null;
  readonly expectedDeliveryDate?: string | null;
  readonly warehouseCode?: string | null;
  readonly deliveryAddress?: string | null;
  readonly note?: string | null;
  readonly priceDate?: string | null;
  readonly shipping?: { readonly amount: number; readonly vatRate?: number | null } | null;
  readonly lines?: readonly SaveSalesOrderLineRequest[];
}

export interface UpdateSalesOrderRequest {
  readonly revision: number;
  readonly expectedDeliveryDate?: string | null;
  readonly warehouseCode?: string | null;
  readonly deliveryAddress?: string | null;
  readonly note?: string | null;
  readonly priceDate?: string | null;
  readonly shipping?: { readonly amount: number; readonly vatRate?: number | null } | null;
  /** Thay toàn bộ dòng (chỉ đơn Nháp, không phải đơn từ báo giá); bỏ trống thì giữ dòng. */
  readonly lines?: readonly SaveSalesOrderLineRequest[];
}

export interface SalesOrderActionRequest {
  readonly revision: number;
  readonly reason?: string | null;
}

export interface SaveDeliveryPlanRequest {
  /** `revision` của đơn. */
  readonly revision: number;
  readonly plannedDate: string;
  /** Mặc định kho của đơn. */
  readonly warehouseCode?: string | null;
  readonly address?: string | null;
  readonly note?: string | null;
  readonly lines: readonly { readonly orderLineId: string; readonly quantity: number }[];
}

/** Kết quả chuyển báo giá: lần gọi sau trả đúng kết quả lần đầu (`created = false`). */
export interface ConvertQuoteResult {
  readonly quoteId: string;
  readonly contractId: string;
  readonly contractCode: string;
  readonly orderId: string;
  readonly orderCode: string;
  readonly deliveryId: string | null;
  readonly created: boolean;
}

/** Cấu hình Bán hàng của GĐ4. */
export interface SalesSettings {
  /** Hạn giữ hàng mặc định (ngày) từ lúc xác nhận đơn (Q12). */
  readonly reservationHoldDays: number;
  /** Báo hợp đồng sắp hết hạn trước số ngày này (CON-06). */
  readonly contractExpiringDays: number;
}

/** Tồn khả dụng theo kho của một mặt hàng (chọn kho giữ hàng, kho xuất). */
export interface CrmMaterialStock {
  readonly materialId: string;
  readonly materialCode: string;
  readonly kind: string | null;
  readonly totalAvailable: number | null;
  readonly byWarehouse: readonly { readonly warehouseCode: string; readonly available: number }[];
}
