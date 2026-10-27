/**
 * Port sang phân hệ khác cho hợp đồng, đơn bán, giao hàng (GĐ4): Kho (giữ hàng,
 * yêu cầu xuất), kiểm hạn mức công nợ và số còn phải thu của đơn (GĐ5), lệnh
 * gửi lại sang phân hệ khác.
 */

export const CRM_INVENTORY_CLIENT = Symbol('CRM_INVENTORY_CLIENT');
export const CRM_CREDIT_LIMIT_CHECK = Symbol('CRM_CREDIT_LIMIT_CHECK');
export const CRM_ORDER_BALANCE_READER = Symbol('CRM_ORDER_BALANCE_READER');
export const CRM_INTEGRATION_DISPATCHER = Symbol('CRM_INTEGRATION_DISPATCHER');

/** `sourceType` Bán hàng gửi cho Kho (đã chốt ở GĐ4). */
export const CRM_ORDER_SOURCE_TYPE = 'crm_order';
export const CRM_CONTRACT_SOURCE_TYPE = 'crm_contract';
export const CRM_DELIVERY_SOURCE_TYPE = 'crm_delivery';

export interface ReserveStockRequest {
  readonly idempotencyKey: string;
  readonly sourceType: typeof CRM_ORDER_SOURCE_TYPE | typeof CRM_CONTRACT_SOURCE_TYPE;
  readonly sourceId: string;
  /** ISO 8601, sau thời điểm gọi. */
  readonly expiresAt: string;
  readonly notes?: string;
  readonly lines: readonly { readonly materialCode: string; readonly warehouseCode: string; readonly quantity: number }[];
}

export interface ReservedStock {
  readonly reservationId: string;
  readonly reservationCode: string;
  /** Trạng thái phía Kho: PENDING, RESERVED, PARTIALLY_ISSUED, COMPLETED, CANCELLED, EXPIRED. */
  readonly status: string;
  readonly expiresAt: string | null;
}

export interface IssueRequestLine {
  readonly materialCode: string;
  readonly quantity: number;
  readonly reservationId?: string;
}

export interface IssueRequestInput {
  readonly idempotencyKey: string;
  readonly warehouseCode: string;
  readonly sourceType: typeof CRM_DELIVERY_SOURCE_TYPE;
  readonly sourceId: string;
  readonly documentDate?: string;
  readonly note?: string;
  readonly lines: readonly IssueRequestLine[];
}

export interface IssueRequestResult {
  readonly documentId: string;
  readonly documentCode: string;
  readonly status: string;
}

/**
 * Kho qua API nội bộ (không đọc `inventory_schema`). Lỗi hạ tầng ném `CrmError`
 * 503 `INVENTORY_UNAVAILABLE`. Kho từ chối thì ném `CrmError` cùng mã, cùng
 * thông điệp tiếng Việt của Kho; thiếu tồn khi giữ hàng là 409
 * `RESERVATION_INSUFFICIENT_STOCK` kèm `details.shortages`.
 */
export interface InventoryClient {
  /** Giữ nhiều dòng một lần, tất cả hoặc không (Q4). Cùng khoá, cùng nội dung trả lại phần giữ đã tạo. */
  reserve(tenantId: string, request: ReserveStockRequest): Promise<ReservedStock>;
  /** Nhả phần chưa xuất; gọi lại với giữ hàng đã đóng không lỗi. */
  release(tenantId: string, reservationCode: string): Promise<void>;
  /** Tạo chứng từ xuất nháp (ISSUE_SALES) cho một đợt giao. */
  createIssueRequest(tenantId: string, request: IssueRequestInput): Promise<IssueRequestResult>;
}

/**
 * Kiểm hạn mức công nợ khi xác nhận đơn (D5, T5-10). GĐ4 dùng
 * `AllowAllCreditLimitCheck`; GĐ5 thay bằng bản đọc sổ công nợ: vượt hạn mức
 * thì chặn (`BLOCK`) hoặc đưa đi duyệt (`APPROVAL`, đơn sang Chờ duyệt hạn mức).
 */
export type CreditDecision =
  | { readonly outcome: 'ALLOW' }
  | { readonly outcome: 'BLOCK'; readonly message: string }
  | { readonly outcome: 'APPROVAL'; readonly message: string };

export interface CreditLimitCheck {
  evaluate(input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly orderId: string;
    readonly orderAmount: number;
  }): Promise<CreditDecision>;
}

export class AllowAllCreditLimitCheck implements CreditLimitCheck {
  async evaluate(): Promise<CreditDecision> {
    return { outcome: 'ALLOW' };
  }
}

/**
 * Số còn phải thu của một đơn (Q8: đơn tự Hoàn tất khi đã giao đủ và còn phải
 * thu bằng 0). Sổ công nợ có ở GĐ5 (T5-11); trước đó trả `'unknown'` nên đơn
 * không tự Hoàn tất, chỉ đóng tay có lý do.
 */
export interface OrderBalanceReader {
  outstanding(tenantId: string, orderId: string): Promise<number | 'unknown'>;
}

export class UnknownOrderBalanceReader implements OrderBalanceReader {
  async outstanding(): Promise<'unknown'> {
    return 'unknown';
  }
}

/** Gửi các lệnh đã xếp hàng (nhả giữ hàng...) sang phân hệ khác; lỗi để job thử lại. */
export interface IntegrationDispatcher {
  dispatch(tenantId: string): Promise<number>;
}
