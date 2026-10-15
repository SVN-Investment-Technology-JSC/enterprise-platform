/**
 * Bước Tài chính: một bước của quy trình mà việc làm thật nằm ở module Tài chính.
 *
 * Khi hồ sơ tới bước này, Quy trình phát `procedure.step.finance_voucher_requested`;
 * Tài chính tự tạo phiếu thu/chi và báo kết quả bằng `finance.voucher.*`. Hai bên
 * không gọi API ghi của nhau và không import hợp đồng của nhau: Tài chính khai lại
 * đúng các tên sự kiện và hình dạng payload dưới đây.
 */
import type { ProcedureAttributeType } from './procedure-flow.types.js';

/** Loại phiếu bước Tài chính tạo ra. Lệnh chuyển tiền không đi qua quy trình. */
export const PROCEDURE_FINANCE_VOUCHER_KINDS = ['PAYMENT', 'RECEIPT'] as const;
export type ProcedureFinanceVoucherKind = (typeof PROCEDURE_FINANCE_VOUCHER_KINDS)[number];

export const PROCEDURE_FINANCE_VOUCHER_KIND_LABELS: Readonly<Record<ProcedureFinanceVoucherKind, string>> = {
  PAYMENT: 'Phiếu chi',
  RECEIPT: 'Phiếu thu',
};

/** Trường của phiếu được lấy từ thuộc tính của hồ sơ. */
export const FINANCE_VOUCHER_SOURCE_FIELDS = [
  'amount',
  'content',
  'counterpartyName',
  'counterpartyAccountNo',
  'counterpartyBank',
  'voucherDate',
] as const;
export type FinanceVoucherSourceField = (typeof FINANCE_VOUCHER_SOURCE_FIELDS)[number];

export const FINANCE_VOUCHER_SOURCE_FIELD_LABELS: Readonly<Record<FinanceVoucherSourceField, string>> = {
  amount: 'Số tiền',
  content: 'Nội dung',
  counterpartyName: 'Người nộp/nhận tiền',
  counterpartyAccountNo: 'Số tài khoản',
  counterpartyBank: 'Ngân hàng',
  voucherDate: 'Ngày lập phiếu',
};

/**
 * Mã thuộc tính tự khớp khi bước không khai ánh xạ, theo thứ tự ưu tiên. Cùng quy
 * ước mã với chiều phiếu → hồ sơ (`FINANCE_PROCEDURE_ATTRIBUTES` bên Tài chính).
 */
export const FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES: Readonly<Record<FinanceVoucherSourceField, readonly string[]>> = {
  amount: ['so_tien', 'amount', 'tong_tien'],
  content: ['noi_dung', 'content'],
  counterpartyName: ['nguoi_nop_nhan', 'counterparty'],
  counterpartyAccountNo: ['so_tai_khoan', 'account_no'],
  counterpartyBank: ['ngan_hang', 'bank'],
  voucherDate: ['ngay_lap', 'voucher_date'],
};

/** Kiểu thuộc tính chấp nhận cho từng trường phiếu. */
export const FINANCE_VOUCHER_SOURCE_FIELD_TYPES: Readonly<Record<FinanceVoucherSourceField, readonly ProcedureAttributeType[]>> = {
  amount: ['money', 'number'],
  content: ['text', 'select'],
  counterpartyName: ['text', 'user', 'select'],
  counterpartyAccountNo: ['text'],
  counterpartyBank: ['text', 'select'],
  voucherDate: ['date'],
};

/**
 * Cấu hình tích hợp của một bước định nghĩa. Vắng mặt = bước thường.
 *
 * Tổng quát theo `module`/`action` để sau này module khác dùng lại cùng cơ chế;
 * hiện chỉ có Tài chính.
 */
export interface ProcedureStepIntegration {
  readonly module: 'finance';
  readonly action: 'voucher';
  readonly voucherKind: ProcedureFinanceVoucherKind;
  /**
   * Trường phiếu ← khoá thuộc tính hồ sơ (`process:<code>` hoặc `step:<stepId>:<code>`).
   * Trường không khai thì tự khớp theo `FINANCE_VOUCHER_SOURCE_ATTRIBUTE_CODES`.
   */
  readonly mapping?: Partial<Record<FinanceVoucherSourceField, string>>;
  /**
   * Bước (id bước định nghĩa) nhận hồ sơ khi kế toán trả về. Lúc lưu nháp được phép
   * ghi mã bước; server đổi sang id. Bỏ trống = bước liền trước trên đường đã đi.
   */
  readonly returnToStepId?: string;
}

/**
 * Tiến trình của phiếu ở một bước Tài chính đang chạy, ghi trên bước của hồ sơ.
 *
 * - `requested`: đã phát yêu cầu, chờ Tài chính tạo phiếu.
 * - `linked`: Tài chính đã tạo/cập nhật phiếu nháp.
 * - `posted`: đã ghi sổ — bước được đóng.
 * - `returned`: kế toán trả hồ sơ về.
 */
export type ProcedureFinanceVoucherState = 'requested' | 'linked' | 'posted' | 'returned';

export interface ProcedureStepFinanceVoucher {
  /** Lần kích hoạt bước, tăng 1 mỗi lần bước được mở lại. Sự kiện của lần cũ bị bỏ qua. */
  activation: number;
  state: ProcedureFinanceVoucherState;
  requestedAt: string;
  /** Giữ qua các lần kích hoạt: một hồ sơ chỉ có một phiếu. */
  voucherId?: string;
  code?: string;
  amount?: number;
  postedAt?: string;
  postedBy?: string;
  postedByName?: string;
  returnedReason?: string;
  updatedAt?: string;
}

/* --------------------------------- Sự kiện --------------------------------- */

/** Quy trình → Tài chính: hồ sơ vừa tới bước Tài chính (hoặc tới lại sau khi bị trả về). */
export const PROCEDURE_STEP_FINANCE_VOUCHER_REQUESTED = 'procedure.step.finance_voucher_requested';
/** Tài chính → Quy trình: đã tạo/cập nhật phiếu nháp cho bước. */
export const FINANCE_VOUCHER_LINKED = 'finance.voucher.linked';
/** Tài chính → Quy trình: phiếu đã ghi sổ; bước được đóng. */
export const FINANCE_VOUCHER_POSTED = 'finance.voucher.posted';
/** Tài chính → Quy trình: kế toán trả hồ sơ về. */
export const FINANCE_VOUCHER_RETURNED = 'finance.voucher.returned';

/** Giá trị lấy từ thuộc tính hồ sơ; `null` khi hồ sơ không có. */
export interface ProcedureFinanceVoucherRequestedValues {
  readonly amount: number | null;
  readonly content: string | null;
  readonly counterpartyName: string | null;
  readonly counterpartyAccountNo: string | null;
  readonly counterpartyBank: string | null;
  /** YYYY-MM-DD. */
  readonly voucherDate: string | null;
}

/** Chủ thể được giao vai R ở bước mà không phải gán thẳng cho người (đơn vị, chức danh). */
export interface ProcedureFinanceStepAssigneeSubject {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly subjectLabel?: string;
}

export interface ProcedureFinanceVoucherRequestedPayload {
  readonly instanceId: string;
  readonly instanceCode: string;
  readonly instanceTitle: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly stepInstanceId: string;
  readonly stepName: string;
  readonly activation: number;
  readonly voucherKind: ProcedureFinanceVoucherKind;
  readonly values: ProcedureFinanceVoucherRequestedValues;
  /** Dự án gắn với hồ sơ (`workspaceLink`). */
  readonly projectId?: string;
  /** Công việc "Theo quy trình" đã mở hồ sơ (`sourceType = workspace_work_item`). */
  readonly workItemId?: string;
  readonly initiatedBy: string;
  readonly initiatedByName?: string;
  /**
   * Người được gán THẲNG vai R (kể cả người duyệt động đã phân giải). Chỉ để lọc và
   * hiển thị — không dùng để cấp quyền; quyền hỏi `can-act` lúc thao tác.
   */
  readonly assigneeIds: readonly string[];
  /** Vai R gán cho đơn vị/chức danh: bên nhận tự giải bằng sơ đồ tổ chức nếu cần. */
  readonly assigneeSubjects: readonly ProcedureFinanceStepAssigneeSubject[];
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

/* ------------------------------ API nội bộ ------------------------------ */

/** `GET {FINANCE_API_URL}/v1/internal/integration/capabilities` — Quy trình hỏi lúc công bố. */
export interface ProcedureFinanceCapabilities {
  readonly voucherKinds: readonly ProcedureFinanceVoucherKind[];
}

/** `POST /api/procedure/v1/internal/instances/:instanceId/steps/:stepInstanceId/can-act`. */
export interface ProcedureFinanceStepCanActRequest {
  readonly userId: string;
  readonly activation: number;
}

export interface ProcedureFinanceStepCanActResponse {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly viaDelegation?: boolean;
  readonly viaEscalation?: boolean;
}
