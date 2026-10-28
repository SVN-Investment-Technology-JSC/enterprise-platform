import type {
  AdjustmentDirection,
  AdjustmentStatus,
  CrmPage,
  CustomerAgingRow,
  CustomerLedger,
  OrderCreditRequest,
  ReceiptDetail,
  ReceiptMethod,
  ReceiptStatus,
  ReceiptSummary,
  ReceivableAdjustment,
  ReceivableSettings,
} from '@enterprise-platform/contracts-crm';
import type { AllocationInput } from '../domain/receivables.js';
import type { KeysetCursor } from '../domain/pagination.js';
import type { CrmDataScope } from './data-scope.js';

/**
 * Port công nợ phải thu (GĐ5). Sổ công nợ chỉ ghi thêm; hàm ghi khoá dòng liên
 * quan `FOR UPDATE`, so `revision`, ghi `audit_log` trong cùng transaction. Hàm
 * đọc lọc theo người phụ trách khách hàng.
 */

export const CRM_RECEIVABLE_STORE = Symbol('CRM_RECEIVABLE_STORE');
export const CRM_FINANCE_CLIENT = Symbol('CRM_FINANCE_CLIENT');
export const CRM_CREDIT_STORE = Symbol('CRM_CREDIT_STORE');

/** `sourceType` của phiên Quy trình duyệt vượt hạn mức (D5). */
export const CRM_ORDER_CREDIT_SOURCE_TYPE = 'crm_order_credit';

// ---------------------------------------------------------------------------
// Tài chính (phiếu có nguồn, T5-01)
// ---------------------------------------------------------------------------

export interface FinanceReceiptVoucherRequest {
  readonly idempotencyKey: string;
  /** Id lần thu: một lần thu = một phiếu. */
  readonly sourceRef: string;
  /** Mã lần thu hiển thị trên phiếu. */
  readonly sourceCode: string;
  readonly amount: number;
  readonly content: string;
  readonly counterpartyName: string;
  readonly voucherDate: string;
  readonly initiatedBy: string;
  readonly initiatedByName?: string;
  readonly description?: string;
}

export interface FinanceVoucherState {
  readonly voucherId: string;
  readonly voucherCode: string;
  /** Trạng thái phiếu: DRAFT, APPROVED, CANCELLED... */
  readonly status: string;
  /** Trạng thái nguồn: OPEN, RETURNED, POSTED, REVERSED... */
  readonly sourceStatus: string;
}

/**
 * Tài chính qua API nội bộ (`x-service-token`), không đọc `finance_schema`.
 * Không kết nối được, 5xx, 401, 403, 429: `CrmError` 503 `FINANCE_UNAVAILABLE`
 * (thử lại); Tài chính từ chối (409 trùng khoá khác nội dung, 422 dữ liệu sai):
 * `CrmError` 4xx giữ mã và thông điệp của Tài chính (không thử lại).
 */
export interface FinanceClient {
  createReceiptVoucher(tenantId: string, request: FinanceReceiptVoucherRequest): Promise<FinanceVoucherState>;
  /** Trạng thái phiếu của một lần thu; chưa có phiếu thì `null`. */
  voucherState(tenantId: string, sourceRef: string): Promise<FinanceVoucherState | null>;
  /**
   * Huỷ phiếu nháp của một lần thu (T5-15): phiếu còn nháp thì Tài chính huỷ,
   * đã huỷ thì trả lại trạng thái; chưa có phiếu thì `null`. Phiếu không còn
   * nháp thì Tài chính từ chối (409).
   */
  cancelReceiptVoucher(tenantId: string, sourceRef: string, reason: string): Promise<FinanceVoucherState | null>;
}

// ---------------------------------------------------------------------------
// Sổ công nợ, lần thu, điều chỉnh
// ---------------------------------------------------------------------------

export interface AgingFilter {
  readonly q?: string;
  readonly ownerUserId?: string;
  readonly overdue?: boolean;
  readonly today: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface ReceiptFilter {
  readonly customerId?: string;
  readonly status?: ReceiptStatus;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface AdjustmentFilter {
  readonly customerId?: string;
  readonly status?: AdjustmentStatus;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

export interface NewReceiptRecord {
  readonly customerId: string;
  readonly amount: number;
  readonly method: ReceiptMethod;
  readonly receiptDate: string;
  readonly note: string | null;
  readonly allocations: readonly AllocationInput[];
  /** Tên người ghi nhận (hiển thị trên phiếu Tài chính). */
  readonly actorName: string;
}

export interface ReceiptChanges {
  readonly amount: number;
  readonly method: ReceiptMethod;
  readonly receiptDate: string;
  readonly note: string | null;
  readonly allocations: readonly AllocationInput[];
  readonly actorName: string;
}

export interface NewAdjustmentRecord {
  readonly customerId: string;
  readonly orderId: string | null;
  readonly entryId: string | null;
  readonly direction: AdjustmentDirection;
  readonly amount: number;
  readonly reason: string;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
}

export interface ReceivableStore {
  agingReport(tenantId: string, scope: CrmDataScope, filter: AgingFilter): Promise<CrmPage<CustomerAgingRow>>;
  ledger(tenantId: string, scope: CrmDataScope, customerId: string, today: string): Promise<CustomerLedger | undefined>;
  listReceipts(tenantId: string, scope: CrmDataScope, filter: ReceiptFilter): Promise<CrmPage<ReceiptSummary>>;
  getReceipt(tenantId: string, scope: CrmDataScope, id: string): Promise<ReceiptDetail | undefined>;
  /**
   * Ghi lần thu Chờ tạo phiếu cùng phân bổ (khoá khoản nợ `FOR UPDATE`, không
   * cho vượt số còn phân bổ được) và lệnh tạo phiếu sang Tài chính. Trả id.
   */
  createReceipt(tenantId: string, record: NewReceiptRecord, actorId: string): Promise<string>;
  /** Lần thu bị trả lại: thay nội dung, phân bổ, đổi khoá, xếp lại lệnh tạo phiếu (Tài chính mở lại phiếu cũ). */
  resendReceipt(tenantId: string, id: string, revision: number, changes: ReceiptChanges, actorId: string): Promise<void>;
  /** Bỏ lần thu chưa có phiếu ghi sổ (chờ tạo phiếu bị từ chối, bị trả lại). */
  cancelReceipt(tenantId: string, id: string, revision: number, reason: string, actorId: string): Promise<void>;
  /**
   * Phân bổ dòng CREDIT chưa gắn khoản nợ (tiền trả trước) vào khoản nợ của cùng
   * khách (T5-16): khoá dòng `FOR UPDATE`, không vượt số trả trước còn lại và số
   * còn nợ. Trả khách hàng của dòng.
   */
  /** Khách hàng của một dòng sổ (kiểm phạm vi trước khi ghi). */
  entryCustomer(tenantId: string, entryId: string): Promise<string | undefined>;
  applyCredit(
    tenantId: string,
    creditEntryId: string,
    allocations: readonly AllocationInput[],
    actorId: string,
    today: string,
  ): Promise<{ customerId: string }>;
  listAdjustments(tenantId: string, scope: CrmDataScope, filter: AdjustmentFilter): Promise<CrmPage<ReceivableAdjustment>>;
  getAdjustment(tenantId: string, scope: CrmDataScope, id: string): Promise<ReceivableAdjustment | undefined>;
  /** Tạo điều chỉnh Chờ duyệt; trùng `sourceType`/`sourceId` thì trả điều chỉnh đã có (`created = false`). */
  createAdjustment(tenantId: string, record: NewAdjustmentRecord, actorId: string): Promise<{ id: string; created: boolean }>;
  /** Duyệt: ghi dòng ADJUSTMENT (giảm trừ chia vào khoản nợ theo hạn sớm trước). */
  approveAdjustment(tenantId: string, id: string, revision: number, actorId: string, today: string): Promise<void>;
  cancelAdjustment(tenantId: string, id: string, revision: number, reason: string, actorId: string): Promise<void>;
  settings(tenantId: string): Promise<ReceivableSettings>;
  saveSettings(tenantId: string, settings: ReceivableSettings, actorId: string): Promise<void>;
  /** Đợt thanh toán điều kiện nghiệm thu (hoặc giao hàng chưa tự kích hoạt): ghi nhận nợ bằng tay. */
  triggerPaymentTerm(tenantId: string, contractId: string, termId: string, date: string, actorId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Hạn mức công nợ (D5, T5-10)
// ---------------------------------------------------------------------------

export interface CreditSnapshot {
  readonly customerCode: string;
  readonly creditLimit: number | null;
  readonly balance: number;
  /** Giá trị đơn lớn nhất đã được duyệt vượt hạn mức cho đơn này; chưa có thì `null`. */
  readonly approvedAmount: number | null;
}

export interface CreditApprovalRequest {
  readonly tenantId: string;
  readonly orderId: string;
  readonly revision: number;
  readonly actorId: string;
  readonly orderAmount: number;
  readonly message: string;
}

export interface CreditStore {
  snapshot(tenantId: string, customerId: string, orderId: string): Promise<CreditSnapshot>;
  creditLimitMode(tenantId: string): Promise<'APPROVAL' | 'BLOCK'>;
  /**
   * Đơn Nháp → Chờ duyệt hạn mức cùng yêu cầu duyệt (và liên kết Quy trình khi
   * cách duyệt là Quy trình) trong một transaction. Trả id liên kết cần tạo phiên.
   */
  requestApproval(request: CreditApprovalRequest): Promise<{ requestId: string; linkId: string | null }>;
  /** Yêu cầu gần nhất của đơn (mọi trạng thái), kèm mã phiên Quy trình nếu có. */
  latestRequest(tenantId: string, orderId: string): Promise<OrderCreditRequest | undefined>;
  /**
   * Ghi quyết định cho yêu cầu đang chờ: duyệt thì yêu cầu Đã duyệt (đơn vẫn Chờ
   * duyệt hạn mức cho tới khi giữ được hàng); từ chối thì đơn về Nháp.
   */
  decide(
    tenantId: string,
    requestId: string,
    decision: { readonly approve: boolean; readonly actorId: string | null; readonly note: string | null },
  ): Promise<'applied' | 'ignored'>;
  /** Đã duyệt nhưng không giữ được hàng: đơn về Nháp kèm lý do. */
  returnToDraft(tenantId: string, orderId: string, reason: string, actorId: string | null): Promise<void>;
  /** Yêu cầu đã duyệt mà đơn còn Chờ duyệt hạn mức (job thử giữ hàng lại). */
  approvedAwaitingConfirmation(tenantId: string, limit: number): Promise<{ requestId: string; orderId: string }[]>;
  /**
   * Yêu cầu đang chờ mà phiên Quy trình không tạo được nữa (hết số lần thử hoặc
   * Quy trình từ chối dữ liệu): chuyển sang duyệt trực tiếp, đóng liên kết, báo
   * người lập (T5-17). Trả số yêu cầu đã chuyển.
   */
  redirectFailedProcedures(tenantId: string, limit: number): Promise<number>;
}
