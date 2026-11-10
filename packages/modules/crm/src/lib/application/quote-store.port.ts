import type {
  ApprovalBinding,
  ApprovalKind,
  CrmPage,
  CrmQuoteApprovalRequestedPayload,
  ProcedureDefinitionOption,
  QuoteApprovalReason,
  QuoteAdjustmentMode,
  QuoteApprovalSettings,
  QuoteCustomFields,
  QuoteDetail,
  QuoteFee,
  QuoteOrderAmountInput,
  QuoteLine,
  QuoteSeller,
  QuoteShipping,
  QuoteStatus,
  QuoteSummary,
  QuoteTotals,
  QuoteVersion,
} from '@enterprise-platform/contracts-crm';
import type { PlanAttachment } from './business-plan-store.port.js';
import type { KeysetCursor } from '../domain/pagination.js';
import type { QuoteEditPlan } from '../domain/quote.js';
import type { CrmDataScope } from './data-scope.js';
import type { CrmSourceSummary } from '../domain/procedure-source-summary.js';

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
  /** Chỉ các báo giá này (bộ lọc "Cần tôi duyệt"); mảng rỗng là không có báo giá nào. */
  readonly ids?: readonly string[];
  readonly cursor?: KeysetCursor;
  /** Phân trang theo số trang (bỏ qua `cursor`). */
  readonly page?: number;
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

/** Mẫu, loại và chế độ chọn lúc lập báo giá (GĐI); rỗng thì store dùng mẫu và loại mặc định. */
export interface NewQuoteForm {
  readonly templateId: string | null;
  readonly quoteTypeId: string | null;
  readonly discountMode: QuoteAdjustmentMode;
  readonly taxMode: QuoteAdjustmentMode;
}

export interface NewQuoteRecord {
  readonly opportunityId: string | null;
  readonly customerId: string;
  readonly ownerUserId: string;
  readonly validUntil: string | null;
  readonly note: string | null;
  /** Mã nhập tay; rỗng thì sinh theo mẫu mã đã cấu hình. Trùng mã: 409. */
  readonly code?: string | null;
  /** Rỗng: `Báo giá <mã>`. */
  readonly quoteName?: string | null;
  readonly quoteDate?: string | null;
  readonly form?: NewQuoteForm | null;
  /** Giá trị trường tuỳ biến đã kiểm (P2I-06). */
  readonly customFields?: QuoteCustomFields;
  /**
   * Tổ chức báo giá đã chọn và thông tin chữ của nó (plan mục 16). Không có (`undefined`, ví dụ báo giá tự tạo khi cơ
   * hội sang giai đoạn Báo giá): store chọn tổ chức mặc định đang bật và chép thông tin của nó.
   */
  readonly organization?: QuoteOrganizationInput;
}

/** Tổ chức báo giá trên phiên bản: id (rỗng là không chọn) và thông tin chữ in lên báo giá (rỗng là không có). */
export interface QuoteOrganizationInput {
  readonly organizationId: string | null;
  readonly seller: QuoteSeller | null;
}

/** Dòng đã tính giá, giá vốn, sẵn sàng ghi. */
export type QuoteLineRecord = Omit<QuoteLine, 'availableStock'> & { readonly priceReferenceId: string | null };

/** Trường theo mẫu của phiên bản (phần người dùng nhập); số đã tính nằm ở `QuoteFormWrite`. */
export interface QuoteFormInput {
  readonly quoteName: string | null;
  readonly quoteDate: string | null;
  readonly templateId: string | null;
  readonly quoteTypeId: string | null;
  readonly discountMode: QuoteAdjustmentMode;
  readonly taxMode: QuoteAdjustmentMode;
  /** Phần trăm hoặc số tiền, tối đa một trong hai khác rỗng. */
  readonly orderDiscount: QuoteOrderAmountInput;
  readonly orderTax: QuoteOrderAmountInput;
  readonly fees: readonly QuoteFee[];
  /** Giá trị trường tuỳ biến của phiên bản (đã gộp, đã kiểm). */
  readonly customFields: QuoteCustomFields;
  /** Tổ chức báo giá và thông tin chữ của nó (plan mục 16); phiên bản mới chép từ phiên bản trước. */
  readonly organizationId: string | null;
  readonly seller: QuoteSeller | null;
}

export interface QuoteFormWrite extends QuoteFormInput {
  readonly orderDiscountTotal: number;
  readonly orderTaxTotal: number;
  readonly feesAmount: number;
}

export interface QuoteVersionWrite {
  /** Đổi mã báo giá (chỉ khi sửa tại chỗ ở Nháp); rỗng là giữ. */
  readonly code?: string | null;
  readonly form: QuoteFormWrite;
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
  /** PAKD đang soạn đính vào hồ sơ duyệt: khoá và mở vòng duyệt trong cùng transaction (chỉ khi `PENDING`). */
  readonly businessPlan?: PlanAttachment | null;
}

export interface QuoteTransition {
  readonly from: QuoteStatus;
  readonly to: Exclude<QuoteStatus, 'DRAFT' | 'PENDING' | 'SUPERSEDED' | 'EXPIRED'>;
  /** Tên thao tác ghi nhật ký: `approve`, `reject`, `send`, `accept`, `decline`. */
  readonly action: string;
  readonly reason: string | null;
}

/** Liên kết Quy trình của báo giá sắp xoá, đã tạm đóng (`CLOSED`) để kết quả đến giữa chừng không áp vào báo giá. */
export interface QuoteDeletionLink {
  readonly id: string;
  /** Hồ sơ đã tạo bên Quy trình; rỗng là chưa tạo (không cần huỷ). */
  readonly instanceId: string | null;
  /** Trạng thái trước khi đóng, để mở lại nếu không huỷ được hồ sơ. */
  readonly previousStatus: string;
}

export interface QuoteDeletion {
  readonly code: string;
  readonly links: readonly QuoteDeletionLink[];
}

export interface QuoteStore {
  listQuotes(tenantId: string, scope: CrmDataScope, filter: QuoteFilter): Promise<CrmPage<QuoteSummary>>;
  /**
   * Bước 1 của xoá báo giá: khoá báo giá, kiểm còn xoá được (một phiên bản, Nháp hoặc Chờ duyệt, chưa chuyển đơn), tạm
   * đóng các liên kết Quy trình còn mở của báo giá và PAKD. Đang gửi sang Quy trình (liên kết đang giữ lease) thì 409.
   */
  prepareDelete(tenantId: string, quoteId: string): Promise<QuoteDeletion>;
  /** Không huỷ được hồ sơ Quy trình: mở lại các liên kết đã tạm đóng. */
  reopenDeletionLinks(tenantId: string, links: readonly QuoteDeletionLink[]): Promise<void>;
  /** Bước 2: kiểm lại rồi xoá hẳn báo giá (dòng hàng, PAKD, người theo dõi, liên kết, tài liệu), ghi nhật ký. */
  deleteQuote(tenantId: string, quoteId: string, actorId: string, reason: string): Promise<void>;
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
  readonly sourceType: CrmProcedureSourceType;
  readonly sourceId: string;
  readonly idempotencyKey: string;
  readonly initiatedBy: string;
  readonly autoCompleteInitiatorStep: boolean;
  /** Thông tin nguồn cho người duyệt (báo giá, PAKD); đã cắt theo giới hạn của Quy trình. */
  readonly sourceSummary?: CrmSourceSummary | null;
}

/** Nguồn phiên Quy trình của Bán hàng (`procedure_links.source_type`). */
export type CrmProcedureSourceType = 'crm_quote' | 'crm_order_credit' | 'crm_tender_plan' | 'crm_business_plan';

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
  /**
   * Bổ sung thông tin nguồn cho hồ sơ đã tạo (`PUT /v1/internal/instances/:id/source-summary`). `false` khi Quy trình
   * không nhận (route chưa có, dữ liệu sai, hồ sơ không còn): không hỏi lại. Lỗi hạ tầng ném 503 để lần sau thử lại.
   * Không có (client giả cũ) thì không bổ sung.
   */
  updateSourceSummary?(tenantId: string, instanceId: string, summary: CrmSourceSummary): Promise<boolean>;
  /**
   * Huỷ hồ sơ đang chạy khi xoá báo giá (`POST /v1/internal/instances/:id/cancel`): `cancelled` đã huỷ, `missing` Quy
   * trình không còn hồ sơ, `finished` hồ sơ đã kết thúc khác (đã duyệt, từ chối). Không có (client giả cũ) thì không
   * xoá được báo giá đang duyệt qua Quy trình.
   */
  cancelInstance?(
    tenantId: string,
    instanceId: string,
    input: { readonly reason: string; readonly actorUserId?: string; readonly actorName?: string },
  ): Promise<'cancelled' | 'missing' | 'finished'>;
}

/**
 * Hồ sơ người dùng đang được Quy trình giao xử lý (`POST /v1/internal/instances/actionable`, tối đa 100 mã mỗi lần).
 * Quy trình là nơi duy nhất quyết định người duyệt từng bước.
 */
export interface ProcedureActionableReader {
  actionableInstanceIds(tenantId: string, actorUserId: string, instanceIds: readonly string[]): Promise<string[]>;
}

/** Tạo phiên Quy trình cho liên kết vừa ghi (sau commit); lỗi được ghi vào liên kết để worker thử lại. */
export interface ApprovalLinks {
  start(tenantId: string, linkId: string): Promise<void>;
  /**
   * Huỷ hồ sơ Quy trình khi xoá báo giá: `cancelled` đã huỷ hoặc Quy trình không còn hồ sơ; `finished` hồ sơ đã kết
   * thúc (đã duyệt, từ chối) nên không xoá báo giá. Không hỗ trợ (client giả cũ) thì `unsupported`.
   */
  cancel?(
    tenantId: string,
    instanceId: string,
    input: { readonly reason: string; readonly actorUserId?: string; readonly actorName?: string },
  ): Promise<'cancelled' | 'finished' | 'unsupported'>;
}
