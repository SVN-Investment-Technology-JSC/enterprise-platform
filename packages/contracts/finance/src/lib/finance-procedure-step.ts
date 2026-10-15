/**
 * Bước Tài chính của quy trình: hồ sơ tới bước này thì Tài chính tạo phiếu thu/chi, kế toán ghi sổ hoặc trả hồ sơ về.
 *
 * Hai module chỉ trao đổi bằng sự kiện và không import hợp đồng của nhau: tên sự kiện và hình dạng payload dưới đây khai lại
 * ĐÚNG như `procedure-finance-step.ts` của Procedure Engine. Đổi một bên thì phải đổi bên kia.
 */
/** Loại phiếu bước Tài chính tạo ra. Lệnh chuyển tiền không đi qua quy trình. */
export const FINANCE_STEP_VOUCHER_KINDS = ['PAYMENT', 'RECEIPT'] as const;
export type FinanceStepVoucherKind = (typeof FINANCE_STEP_VOUCHER_KINDS)[number];

/* --------------------------------- Sự kiện --------------------------------- */

/** Quy trình → Tài chính: hồ sơ vừa tới bước Tài chính (hoặc tới lại sau khi bị trả về). */
export const FINANCE_STEP_VOUCHER_REQUESTED = 'procedure.step.finance_voucher_requested';
/** Tài chính → Quy trình: đã tạo/cập nhật phiếu nháp cho bước. */
export const FINANCE_VOUCHER_LINKED = 'finance.voucher.linked';
/** Tài chính → Quy trình: phiếu đã ghi sổ; bước được đóng. */
export const FINANCE_VOUCHER_POSTED = 'finance.voucher.posted';
/** Tài chính → Quy trình: kế toán trả hồ sơ về. */
export const FINANCE_VOUCHER_RETURNED = 'finance.voucher.returned';

/** Giá trị lấy từ thuộc tính hồ sơ; `null` khi hồ sơ không có. */
export interface FinanceStepVoucherRequestedValues {
  readonly amount: number | null;
  readonly content: string | null;
  readonly counterpartyName: string | null;
  readonly counterpartyAccountNo: string | null;
  readonly counterpartyBank: string | null;
  /** YYYY-MM-DD. */
  readonly voucherDate: string | null;
}

/** Chủ thể được giao vai R ở bước mà không phải gán thẳng cho người (đơn vị, chức danh). */
export interface FinanceStepAssigneeSubject {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subjectLabel?: string;
}

export interface FinanceStepVoucherRequestedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly instanceTitle: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly stepInstanceId: string;
  readonly stepName: string;
  readonly activation: number;
  readonly voucherKind: FinanceStepVoucherKind;
  readonly values: FinanceStepVoucherRequestedValues;
  /** Dự án gắn với hồ sơ (`workspaceLink`). */
  readonly projectId?: string;
  /** Công việc "Theo quy trình" đã mở hồ sơ; Tài chính tự hỏi Workspace dự án chứa nó. */
  readonly workItemId?: string;
  readonly initiatedBy: string;
  readonly initiatedByName?: string;
  /** Người được gán THẲNG vai R. Chỉ để lọc và hiển thị; quyền hỏi `can-act` lúc thao tác. */
  readonly assigneeIds: readonly string[];
  /** Vai R gán cho đơn vị/chức danh. */
  readonly assigneeSubjects: readonly FinanceStepAssigneeSubject[];
  /** Nhãn người phụ trách để hiển thị, ví dụ "Kế toán thanh toán". */
  readonly assigneeLabel?: string;
  readonly requestedAt: string;
}

export interface FinanceVoucherLinkedPayload {
  readonly instanceId: string;
  readonly stepInstanceId: string;
  readonly activation: number;
  readonly voucherId: string;
  readonly code: string;
  readonly status: string;
  readonly amount: number;
}

export interface FinanceVoucherPostedPayload {
  readonly instanceId: string;
  readonly stepInstanceId: string;
  readonly activation: number;
  readonly voucherId: string;
  readonly code: string;
  readonly amount: number;
  readonly postedAt: string;
  readonly postedBy: string;
  readonly postedByName?: string;
}

export interface FinanceVoucherReturnedPayload {
  readonly instanceId: string;
  readonly stepInstanceId: string;
  readonly activation: number;
  readonly voucherId: string;
  readonly reason: string;
  readonly actorId: string;
  readonly actorName?: string;
}

/* ------------------------------- API nội bộ ------------------------------- */

/** `GET /api/finance/v1/internal/integration/capabilities`: Procedure hỏi lúc công bố quy trình có bước Tài chính. */
export interface FinanceIntegrationCapabilities {
  readonly voucherKinds: readonly FinanceStepVoucherKind[];
}

/** `POST /api/procedure/v1/internal/instances/:instanceId/steps/:stepInstanceId/can-act`. */
export interface FinanceStepCanActRequest {
  readonly userId: string;
  readonly activation: number;
}

export interface FinanceStepCanActResponse {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly viaDelegation?: boolean;
  readonly viaEscalation?: boolean;
}

/* ----------------------------- Phiếu có nguồn ----------------------------- */

/** Trường phiếu lấy từ hồ sơ và bị khoá trên form. */
export type FinanceSourceLockedField =
  | 'amount'
  | 'content'
  | 'counterpartyName'
  | 'counterpartyAccountNo'
  | 'counterpartyBank'
  | 'voucherDate'
  | 'allocation';

/**
 * OPEN: chờ kế toán ghi sổ; RETURNED: đã trả hồ sơ về, chờ hồ sơ quay lại; POSTED: đã ghi sổ; CLOSED: hồ sơ huỷ/huỷ hiệu lực.
 * REVERSAL_PENDING: hồ sơ đã bị huỷ hiệu lực nhưng chưa đảo được phiếu đã ghi sổ (khoá sổ, số dư...); không tự thử lại,
 * người có quyền ghi sổ bấm "Đảo lại" sau khi xử lý nguyên nhân.
 */
export type FinanceVoucherSourceStatus = 'OPEN' | 'RETURNED' | 'POSTED' | 'CLOSED' | 'REVERSAL_PENDING';

/** Khoá mềm "đang xử lý" hết hạn sau khoảng này không có thao tác. */
export const FINANCE_SOURCE_HANDLING_TTL_MINUTES = 30;

/** Nguồn hồ sơ quy trình của một phiếu tạo từ bước Tài chính (`approvalMode = 'INHERITED'`). */
export interface FinanceVoucherSource {
  instanceId: string;
  instanceCode: string;
  instanceTitle: string | null;
  definitionName: string | null;
  stepName: string | null;
  activation: number;
  status: FinanceVoucherSourceStatus;
  /** Giá trị đã nhận từ hồ sơ (chỉ đọc). */
  values: FinanceStepVoucherRequestedValues;
  /** Dự án / công việc hồ sơ yêu cầu hạch toán (id), kể cả khi chưa xác nhận được với Workspace. */
  requestedProjectId: string | null;
  requestedWorkItemId: string | null;
  lockedFields: FinanceSourceLockedField[];
  assigneeLabel: string | null;
  /** Người đang xử lý (khoá mềm còn hiệu lực); null khi chưa ai nhận hoặc đã hết hạn. */
  handlingBy: string | null;
  handlingByName: string | null;
  handlingSince: string | null;
  /**
   * Người xem có đang được giao bước Tài chính không, theo Procedure (`can-act`). null: không hỏi (không có quyền ghi sổ hoặc
   * phiếu không còn chờ) hoặc Procedure không trả lời — khi đó không được thao tác.
   */
  canAct: boolean | null;
  /** Lý do Procedure trả khi không cho thao tác, hoặc thông báo không xác minh được. */
  canActReason: string | null;
  /** Hồ sơ đã bị huỷ hiệu lực mà chưa đảo được phiếu: lý do huỷ hiệu lực và lỗi của lần đảo gần nhất. */
  reversalReason: string | null;
  reversalError: string | null;
}

/** Thao tác trên phiếu có nguồn. */
export interface FinanceSourcedVoucherPermissions {
  /** Sửa phần kế toán được nhập (tài khoản, lý do, ngày hạch toán, hoá đơn...). */
  canEditSourced: boolean;
  canPost: boolean;
  canReturnSource: boolean;
  /** Người khác đang giữ khoá mềm: được nhận xử lý thay. */
  canTakeOver: boolean;
  /** Hồ sơ đã huỷ hiệu lực nhưng phiếu chưa đảo được: thử đảo lại ngay. */
  canRetryReversal: boolean;
}

/** Procedure hỏi trước khi huỷ hiệu lực một hồ sơ có bước Tài chính. */
export interface FinanceInstanceReversalCheck {
  allowed: boolean;
  reason?: string;
}

export interface FinanceReturnSourceRequest {
  reason: string;
}

export interface FinancePostSourcedRequest {
  note?: string;
  /** Phiên bản đang xem, để không ghi sổ phiếu đã bị người khác sửa. */
  revision?: number;
}
