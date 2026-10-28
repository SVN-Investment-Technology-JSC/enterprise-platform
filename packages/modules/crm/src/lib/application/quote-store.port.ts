import type {
  ApprovalBinding,
  ApprovalKind,
  CrmPage,
  CrmQuoteApprovalRequestedPayload,
  ProcedureDefinitionOption,
  QuoteApprovalReason,
  QuoteApprovalSettings,
  QuoteDetail,
  QuoteLine,
  QuoteShipping,
  QuoteStatus,
  QuoteSummary,
  QuoteTotals,
  QuoteVersion,
} from '@enterprise-platform/contracts-crm';
import type { KeysetCursor } from '../domain/pagination.js';
import type { QuoteEditPlan } from '../domain/quote.js';
import type { CrmDataScope } from './data-scope.js';

/**
 * Port của báo giá (GĐ3b): lưu trữ, cấu hình duyệt, client Quy trình và việc
 * tạo phiên duyệt sau khi gửi.
 *
 * Hàm đọc nhận `scope` và lọc theo người phụ trách báo giá; ngoài phạm vi đọc
 * ra `undefined` như không có. Hàm ghi khoá dòng báo giá rồi so lại phiên bản,
 * trạng thái và `revision` service đã đọc: lệch thì 409, không ghi đè.
 */

export const CRM_QUOTE_STORE = Symbol('CRM_QUOTE_STORE');
export const CRM_QUOTE_SETTINGS_STORE = Symbol('CRM_QUOTE_SETTINGS_STORE');
export const CRM_PROCEDURE_CLIENT = Symbol('CRM_PROCEDURE_CLIENT');
export const CRM_APPROVAL_LINKS = Symbol('CRM_APPROVAL_LINKS');

export interface QuoteFilter {
  readonly q?: string;
  readonly status?: QuoteStatus;
  readonly customerId?: string;
  readonly opportunityId?: string;
  readonly ownerUserId?: string;
  readonly cursor?: KeysetCursor;
  readonly limit: number;
}

/** Phần đầu báo giá cần để sửa và tính giá. */
export interface QuoteHead {
  readonly id: string;
  readonly code: string;
  readonly opportunityId: string | null;
  readonly customerId: string;
  readonly customerName: string;
  readonly customerGroupId: string | null;
  readonly ownerUserId: string;
  readonly status: QuoteStatus;
  readonly currentVersion: number;
}

export interface EditableQuote {
  readonly head: QuoteHead;
  readonly version: QuoteVersion;
}

export interface NewQuoteRecord {
  readonly opportunityId: string | null;
  readonly customerId: string;
  readonly ownerUserId: string;
  readonly validUntil: string | null;
  readonly note: string | null;
}

/** Dòng đã tính giá, giá vốn, sẵn sàng ghi. */
export type QuoteLineRecord = Omit<QuoteLine, 'availableStock'> & { readonly priceReferenceId: string | null };

export interface QuoteVersionWrite {
  readonly validUntil: string | null;
  readonly priceDate: string | null;
  readonly pricedOn: string | null;
  readonly note: string | null;
  readonly shipping: QuoteShipping;
  readonly totals: QuoteTotals;
  readonly lines: readonly QuoteLineRecord[];
}

/** Phiên bản service đã đọc; store so lại trong transaction. */
export interface QuoteVersionRef {
  readonly versionId: string;
  readonly versionNo: number;
  readonly status: QuoteStatus;
  readonly revision: number;
}

export interface QuoteSubmission {
  readonly outcome: 'APPROVED' | 'PENDING';
  readonly reasons: readonly QuoteApprovalReason[];
  /** Có khi duyệt qua Quy trình: tạo liên kết chờ worker tạo phiên. */
  readonly procedure: { readonly definitionId: string; readonly title: string } | null;
  /** Sự kiện báo cần duyệt (khi `PENDING`). */
  readonly approvalRequested: Omit<CrmQuoteApprovalRequestedPayload, 'mode'> | null;
}

export interface QuoteTransition {
  readonly from: QuoteStatus;
  readonly to: Exclude<QuoteStatus, 'DRAFT' | 'PENDING' | 'SUPERSEDED' | 'EXPIRED'>;
  /** Tên thao tác ghi nhật ký: `approve`, `reject`, `send`, `accept`, `decline`. */
  readonly action: string;
  readonly reason: string | null;
}

export interface QuoteStore {
  listQuotes(tenantId: string, scope: CrmDataScope, filter: QuoteFilter): Promise<CrmPage<QuoteSummary>>;
  /** Báo giá kèm phiên bản `versionNo` (mặc định phiên bản hiện tại), danh sách phiên bản, lịch sử. */
  getQuote(tenantId: string, scope: CrmDataScope, id: string, versionNo?: number): Promise<QuoteDetail | undefined>;
  loadForEdit(tenantId: string, scope: CrmDataScope, id: string, versionNo: number): Promise<EditableQuote | undefined>;
  /** Tạo báo giá cùng phiên bản 1 ở Nháp và nhật ký. Trả id. */
  createQuote(tenantId: string, record: NewQuoteRecord, actorId: string): Promise<string>;
  /**
   * Ghi phiên bản đã tính lại. `IN_PLACE`: thay dòng, tổng của phiên bản Nháp,
   * tăng `revision`. `NEW_VERSION`: phiên bản `base` sang Đã thay thế, sinh phiên
   * bản kế tiếp ở Nháp với nội dung `write`. Trả số phiên bản đã ghi.
   */
  saveVersion(
    tenantId: string,
    quoteId: string,
    base: QuoteVersionRef,
    plan: QuoteEditPlan,
    write: QuoteVersionWrite,
    actorId: string,
  ): Promise<number>;
  /** Nháp → Đã duyệt hoặc Chờ duyệt (kèm liên kết Quy trình). Trả id liên kết nếu có. */
  submit(tenantId: string, quoteId: string, base: QuoteVersionRef, submission: QuoteSubmission, actorId: string): Promise<string | null>;
  /** Duyệt, từ chối, gửi khách, khách chấp nhận, khách từ chối. */
  transition(tenantId: string, quoteId: string, base: QuoteVersionRef, transition: QuoteTransition, actorId: string): Promise<void>;
  /** Chuyển Hết hạn các báo giá Đã duyệt, Đã gửi khách quá `today`; tối đa `limit` báo giá. Trả số đã chuyển. */
  expireDue(tenantId: string, today: string, limit: number): Promise<number>;
  /** Quy trình hỏi trước khi thu hồi phiên duyệt (`instanceId`, hoặc id liên kết). */
  reversalCheck(tenantId: string, instanceOrLinkId: string): Promise<{ allowed: boolean; reason?: string }>;
}

export interface QuoteSettingsStore {
  approvalSettings(tenantId: string): Promise<QuoteApprovalSettings>;
  saveApprovalSettings(tenantId: string, settings: QuoteApprovalSettings, actorId: string): Promise<void>;
  bindings(tenantId: string): Promise<ApprovalBinding[]>;
  binding(tenantId: string, kind: ApprovalKind): Promise<ApprovalBinding>;
  saveBinding(tenantId: string, binding: Omit<ApprovalBinding, 'updatedAt'>, actorId: string): Promise<void>;
}

export interface StartProcedureInstance {
  readonly definitionId: string;
  readonly title: string;
  readonly sourceType: 'crm_quote' | 'crm_order_credit';
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly initiatedBy: string;
  readonly autoCompleteInitiatorStep: boolean;
}

/** Phiên của người dùng, chuyển tiếp để Quy trình tự lọc quy trình người đó được thấy. */
export interface ForwardedSession {
  readonly cookie?: string;
  readonly authorization?: string;
  readonly csrf?: string;
}

/**
 * Client Quy trình qua API (không đọc `procedure_schema`). Lỗi hạ tầng (mạng,
 * 5xx, token) ném `CrmError` mã `PROCEDURE_UNAVAILABLE` (503); Quy trình từ
 * chối dữ liệu ném mã `PROCEDURE_REJECTED` (422) — không thử lại.
 */
export interface ProcedureClient {
  startInstance(tenantId: string, request: StartProcedureInstance): Promise<{ id: string; code: string | null }>;
  /** Định nghĩa đã công bố; chưa công bố hoặc không có thì 409. */
  publishedDefinition(tenantId: string, definitionId: string): Promise<ProcedureDefinitionOption>;
  listPublished(session: ForwardedSession, tenantId: string): Promise<ProcedureDefinitionOption[]>;
}

/** Tạo phiên Quy trình cho liên kết vừa ghi (sau commit); lỗi được ghi vào liên kết để worker thử lại. */
export interface ApprovalLinks {
  start(tenantId: string, linkId: string): Promise<void>;
}
