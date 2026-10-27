import type {
  AppliedDiscountPolicy,
  ConvertQuoteResult,
  CrmPage,
  PriceSource,
  ReservationSource,
  SalesOrderDetail,
  SalesOrderSource,
  SalesOrderStatus,
  SalesOrderSummary,
  SalesOrderTotals,
} from '@enterprise-platform/contracts-crm';
import type { PlanLineInput } from '../domain/delivery-plan.js';
import type { KeysetCursor } from '../domain/pagination.js';
import type { CrmDataScope } from './data-scope.js';

/**
 * Port lưu trữ đơn bán và kế hoạch giao (GĐ4). Hàm đọc lọc theo người phụ
 * trách đơn; hàm ghi khoá dòng đơn, so lại `revision` và trạng thái service đã
 * đọc (lệch thì 409). Mọi chuyển trạng thái ghi `audit_log` trong cùng
 * transaction.
 */

export const CRM_SALES_ORDER_STORE = Symbol('CRM_SALES_ORDER_STORE');
export const CRM_QUOTE_CONVERSION_STORE = Symbol('CRM_QUOTE_CONVERSION_STORE');

export interface SalesOrderFilter {
  readonly q?: string;
  readonly status?: SalesOrderStatus;
  readonly customerId?: string;
  readonly contractId?: string;
  readonly ownerUserId?: string;
  /** Chỉ đơn có đợt giao trễ so với `today`. */
  readonly late?: boolean;
  readonly today: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

/** Dòng đơn đã tính giá, sẵn sàng ghi. */
export interface OrderLineRecord {
  readonly id: string;
  readonly lineNo: number;
  readonly materialId: string;
  readonly materialCode: string;
  readonly materialName: string;
  readonly unit: string;
  readonly materialKind: string;
  readonly category: string | null;
  readonly quantity: number;
  readonly listPrice: number;
  readonly priceSource: PriceSource;
  readonly priceReferenceId: string | null;
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
  readonly estUnitCost: number | null;
}

export interface OrderHeaderRecord {
  readonly expectedDeliveryDate: string | null;
  readonly warehouseCode: string | null;
  readonly deliveryAddress: string | null;
  readonly note: string | null;
  readonly priceDate: string | null;
  readonly shipping: { readonly amount: number; readonly vatRate: number };
  readonly totals: SalesOrderTotals;
}

export interface NewOrderRecord extends OrderHeaderRecord {
  readonly source: SalesOrderSource;
  readonly customerId: string;
  readonly contractId: string | null;
  readonly quoteId: string | null;
  readonly opportunityId: string | null;
  readonly ownerUserId: string;
  readonly orderDate: string;
  readonly lines: readonly OrderLineRecord[];
}

export interface DeliveryRecord {
  readonly plannedDate: string;
  readonly warehouseCode: string | null;
  readonly address: string | null;
  readonly note: string | null;
  readonly lines: readonly PlanLineInput[];
}

/** Phần giữ hàng ghi vào dòng đơn khi xác nhận. */
export interface OrderLineReservation {
  readonly lineId: string;
  readonly reservationId: string;
  readonly reservationCode: string;
  readonly source: ReservationSource;
  readonly quantity: number;
}

export interface OrderConfirmation {
  readonly expiresAt: string | null;
  readonly lines: readonly OrderLineReservation[];
}

export interface OrderTransition {
  readonly from: SalesOrderStatus;
  readonly to: SalesOrderStatus;
  /** Tên thao tác ghi nhật ký: `credit-check`, `close`… */
  readonly action: string;
  readonly reason: string | null;
}

export interface SalesOrderStore {
  listOrders(tenantId: string, scope: CrmDataScope, filter: SalesOrderFilter): Promise<CrmPage<SalesOrderSummary>>;
  getOrder(tenantId: string, scope: CrmDataScope, id: string, today: string): Promise<SalesOrderDetail | undefined>;
  /** Tạo đơn Nháp cùng dòng và nhật ký. Trả id. */
  createOrder(tenantId: string, record: NewOrderRecord, actorId: string): Promise<string>;
  /** Sửa đầu đơn Nháp; `lines` rỗng (`undefined`) giữ dòng (và giữ đợt giao). */
  updateDraft(
    tenantId: string,
    id: string,
    revision: number,
    header: OrderHeaderRecord,
    lines: readonly OrderLineRecord[] | undefined,
    actorId: string,
  ): Promise<void>;
  /** Nháp (hoặc Chờ duyệt hạn mức) → Đã xác nhận, ghi phần giữ hàng từng dòng. */
  confirm(tenantId: string, id: string, revision: number, from: SalesOrderStatus, confirmation: OrderConfirmation, actorId: string): Promise<void>;
  /** Chuyển không kèm tác động phụ: sang Chờ duyệt hạn mức, đóng tay sang Hoàn tất. */
  transition(tenantId: string, id: string, revision: number, transition: OrderTransition, actorId: string): Promise<void>;
  /** Huỷ: đợt chưa xuất chuyển Đã huỷ, xếp lệnh nhả phần giữ riêng của đơn (không đụng phần đã xuất). */
  cancel(tenantId: string, id: string, revision: number, from: SalesOrderStatus, reason: string, actorId: string): Promise<void>;
  reserveAttempt(tenantId: string, id: string): Promise<number>;
  bumpReserveAttempt(tenantId: string, id: string): Promise<void>;
  /** Số lượng phần giữ của hợp đồng các đơn khác (chưa huỷ) đang dùng, theo mặt hàng. */
  contractReservationUsage(tenantId: string, contractId: string, excludeOrderId: string): Promise<ReadonlyMap<string, number>>;
  /** Tạo (`deliveryId` rỗng) hoặc sửa đợt Kế hoạch. Trả id đợt. */
  saveDelivery(
    tenantId: string,
    orderId: string,
    revision: number,
    deliveryId: string | null,
    record: DeliveryRecord,
    actorId: string,
  ): Promise<string>;
  cancelDelivery(tenantId: string, orderId: string, revision: number, deliveryId: string, actorId: string): Promise<void>;
  /**
   * Đợt Kế hoạch → Đã yêu cầu xuất (có chứng từ Kho), hoặc Đã xuất ngay khi đợt
   * chỉ có dịch vụ (`document` rỗng); đơn sang Đang giao.
   */
  markDeliveryRequested(
    tenantId: string,
    orderId: string,
    revision: number,
    deliveryId: string,
    document: { readonly documentId: string; readonly documentCode: string } | null,
    actorId: string,
  ): Promise<void>;
  /** Job: báo giao trễ một lần cho mỗi đợt quá ngày dự kiến. Trả số đợt đã báo. */
  notifyLateDeliveries(tenantId: string, today: string, limit: number): Promise<number>;
}

/** Chuyển báo giá khách chấp nhận thành hợp đồng, đơn, kế hoạch giao mặc định (T4-06). */
export interface QuoteConversionStore {
  /**
   * Khoá báo giá; đã chuyển thì trả kết quả lần đầu (`created = false`); chưa
   * Khách chấp nhận thì 409. Tạo cả ba trong một transaction.
   */
  convert(
    tenantId: string,
    quoteId: string,
    options: { readonly today: string; readonly plannedDate: string },
    actorId: string,
  ): Promise<ConvertQuoteResult>;
}
