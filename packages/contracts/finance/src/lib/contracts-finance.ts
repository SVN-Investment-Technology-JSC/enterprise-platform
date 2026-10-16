/**
 * Hợp đồng dữ liệu của module Tài chính (Finance).
 *
 * Phiếu thu, phiếu chi và lệnh chuyển tiền dùng chung một bảng `vouchers`; khác nhau ở `kind`.
 * Tiền được ghi sổ (sổ cái tài khoản) khi phiếu được DUYỆT, không phải khi lập.
 */
import type { FinanceSourcedVoucherPermissions, FinanceVoucherSource } from './finance-procedure-step.js';

export const FINANCE_VOUCHER_KINDS = ['RECEIPT', 'PAYMENT', 'TRANSFER'] as const;
export type FinanceVoucherKind = (typeof FINANCE_VOUCHER_KINDS)[number];

export const FINANCE_VOUCHER_KIND_LABELS: Readonly<Record<FinanceVoucherKind, string>> = {
  RECEIPT: 'Phiếu thu',
  PAYMENT: 'Phiếu chi',
  TRANSFER: 'Lệnh chuyển tiền',
};

/**
 * Tiền tố mã phiếu. Mã chính thức `PC-2610-0045` (cấp lúc ghi sổ), mã nháp `NHAP_PC_2610_0045` (cấp lúc lập).
 * Xem `formatFinanceOfficialCode` / `formatFinanceDraftCode`.
 */
export const FINANCE_VOUCHER_CODE_PREFIX: Readonly<Record<FinanceVoucherKind, string>> = {
  RECEIPT: 'PT',
  PAYMENT: 'PC',
  TRANSFER: 'CT',
};

export const FINANCE_VOUCHER_STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type FinanceVoucherStatus = (typeof FINANCE_VOUCHER_STATUSES)[number];

export const FINANCE_VOUCHER_STATUS_LABELS: Readonly<Record<FinanceVoucherStatus, string>> = {
  DRAFT: 'Nháp',
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  CANCELLED: 'Đã huỷ',
};

export type FinanceAccountType = 'BANK' | 'CASH';
export const FINANCE_ACCOUNT_TYPE_LABELS: Readonly<Record<FinanceAccountType, string>> = {
  BANK: 'Tài khoản ngân hàng',
  CASH: 'Quỹ tiền mặt',
};

export const FINANCE_CURRENCY = 'VND';

/** Số tiền tối đa một dòng: giữ trong miền số nguyên an toàn của JSON và numeric(18,2). */
export const FINANCE_MAX_AMOUNT = 999_999_999_999_999;

/** Danh sách ngân hàng thường dùng tại Việt Nam, cho ô chọn "Ngân hàng". */
export const FINANCE_BANKS: readonly string[] = [
  'Vietcombank (VCB)',
  'VietinBank (CTG)',
  'BIDV',
  'Agribank',
  'Techcombank (TCB)',
  'MB Bank (MBB)',
  'ACB',
  'VPBank',
  'Sacombank (STB)',
  'TPBank',
  'HDBank',
  'VIB',
  'SHB',
  'OCB',
  'MSB',
  'SeABank',
  'Eximbank (EIB)',
  'LPBank',
  'Nam A Bank',
  'Bac A Bank',
  'ABBank',
  'PVcomBank',
  'Kienlongbank',
  'Viet Capital Bank',
  'NCB',
  'Saigonbank',
  'BaoViet Bank',
  'VietBank',
  'PG Bank',
  'Shinhan Bank Việt Nam',
  'Woori Bank Việt Nam',
  'HSBC Việt Nam',
  'Standard Chartered Việt Nam',
  'Ngân hàng khác',
];

/* ----------------------------- Tài khoản ----------------------------- */

export interface FinanceAccount {
  id: string;
  code: string;
  name: string;
  accountType: FinanceAccountType;
  bankName: string | null;
  accountNumber: string | null;
  accountHolder: string | null;
  branch: string | null;
  currency: string;
  openingBalance: number;
  openingDate: string;
  /** Cho phép số dư âm (thấu chi). Mặc định không: phiếu chi/chuyển làm âm số dư sẽ không được duyệt. */
  allowNegative: boolean;
  isActive: boolean;
  note: string | null;
  /**
   * Số dư hiện tại = số dư đầu kỳ + toàn bộ bút toán đã ghi sổ.
   * null khi người xem chỉ có quyền lập phiếu (được chọn tài khoản nhưng không xem số dư).
   */
  balance: number | null;
  /** Tổng phiếu chi/chuyển đang chờ duyệt: tiền có thể sắp ra khỏi tài khoản. */
  pendingOut: number | null;
  /**
   * Số phiếu ĐÃ DUYỆT liên quan tới tài khoản, theo loại (chuyển tiền tính cho cả tài khoản nguồn và đích).
   * null khi người xem không được xem số liệu tài khoản.
   */
  receiptCount: number | null;
  paymentCount: number | null;
  transferCount: number | null;
  /**
   * Tiền thu = mọi khoản đã ghi sổ vào tài khoản (phiếu thu và chuyển tiền đến), Tiền chi = mọi khoản đã ghi sổ ra
   * (phiếu chi và chuyển tiền đi); phần đảo phiếu trừ vào đúng bên đã ghi. Số dư (Tổng tiền) = đầu kỳ + thu - chi.
   */
  totalReceipts: number | null;
  totalPayments: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveFinanceAccountRequest {
  code: string;
  name: string;
  accountType: FinanceAccountType;
  bankName?: string | null;
  accountNumber?: string | null;
  accountHolder?: string | null;
  branch?: string | null;
  /** Chỉ nhận khi tạo mới, hoặc khi tài khoản chưa có bút toán nào. */
  openingBalance?: number;
  openingDate?: string;
  allowNegative?: boolean;
  isActive?: boolean;
  note?: string | null;
}

/** Một dòng sổ cái của tài khoản. */
export interface FinanceLedgerEntry {
  id: string;
  accountId: string;
  voucherId: string;
  voucherCode: string;
  voucherKind: FinanceVoucherKind;
  postedDate: string;
  /** Dương: tiền vào; âm: tiền ra. */
  amount: number;
  /** Số dư sau bút toán (tính theo thứ tự ghi sổ). */
  balanceAfter: number;
  description: string | null;
  isReversal: boolean;
  createdAt: string;
}

/* ------------------------------ Danh mục ------------------------------ */

export interface FinanceReason {
  id: string;
  /** Lý do thu hoặc lý do chi. */
  kind: 'RECEIPT' | 'PAYMENT';
  code: string;
  name: string;
  isActive: boolean;
  note: string | null;
}
export interface SaveFinanceReasonRequest {
  kind: 'RECEIPT' | 'PAYMENT';
  code: string;
  name: string;
  isActive?: boolean;
  note?: string | null;
}

/** Nhóm đối tượng thu/chi (khách hàng, nhà cung cấp, nhân viên...). */
export interface FinanceCounterpartyGroup {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface SaveFinanceCounterpartyGroupRequest {
  code: string;
  name: string;
  isActive?: boolean;
}

export interface FinanceCatalogs {
  reasons: FinanceReason[];
  counterpartyGroups: FinanceCounterpartyGroup[];
}

/* ------------------------------- Phiếu ------------------------------- */

export interface FinanceVoucherLine {
  id?: string;
  lineNo?: number;
  description: string;
  quantity: number;
  unitAmount: number;
  /** = quantity * unitAmount, làm tròn 2 chữ số. Server luôn tính lại. */
  total: number;
}

export interface FinanceVoucherInvoice {
  id?: string;
  invoiceNo: string;
  invoiceDate: string | null;
  taxCode: string | null;
  amount: number;
}

/**
 * Hạch toán nội bộ của phiếu thu/chi: tiền thuộc về một dự án hoặc một công việc của dự án (Workspace).
 * Chỉ phần này được cộng vào tổng thu chi của dự án. Mã và tên là bản chụp lúc gắn, do Workspace xác nhận khi lưu phiếu.
 */
export type FinanceAllocationType = 'PROJECT' | 'WORK_ITEM';
export const FINANCE_ALLOCATION_LABELS: Readonly<Record<FinanceAllocationType, string>> = {
  PROJECT: 'Hạch toán cho dự án',
  WORK_ITEM: 'Hạch toán cho công việc',
};

export interface FinanceAllocation {
  type: FinanceAllocationType;
  projectId: string;
  projectCode: string;
  projectName: string;
  workItemId: string | null;
  workItemCode: string | null;
  workItemTitle: string | null;
}

/** Nhãn gọn của hạch toán: "DA001 - Tên dự án" hoặc "CV-12 - Tên công việc (DA001)". */
export function financeAllocationLabel(allocation: Pick<FinanceAllocation, 'type' | 'projectCode' | 'projectName' | 'workItemCode' | 'workItemTitle'>): string {
  const project = `${allocation.projectCode} - ${allocation.projectName}`;
  if (allocation.type === 'WORK_ITEM') return `${allocation.workItemCode ?? ''} - ${allocation.workItemTitle ?? ''} (${allocation.projectCode})`;
  return project;
}

/** Dự án liên quan: chỉ để tham chiếu, không cộng vào tổng thu chi của dự án. */
export interface FinanceRelatedProject {
  projectId: string;
  projectCode: string;
  projectName: string;
}

/** Yêu cầu gắn hạch toán; mã/tên không nhận từ client mà lấy từ Workspace. */
export interface FinanceAllocationInput {
  type: FinanceAllocationType;
  projectId: string;
  /** Bắt buộc khi `type = 'WORK_ITEM'`; phải thuộc đúng `projectId`. */
  workItemId?: string | null;
}

/** Chứng từ đính kèm thủ công (ATTACHMENT) hay ảnh dán trực tiếp vào ô Ghi chú (NOTE_IMAGE); hai loại dùng chung kho nhưng đếm giới hạn riêng. */
export type FinanceAttachmentPurpose = 'ATTACHMENT' | 'NOTE_IMAGE';

export interface FinanceVoucherAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
  purpose: FinanceAttachmentPurpose;
}

/** Ghi chú lưu HTML (rich text); ảnh dán vào được tham chiếu bằng marker ổn định, không nhúng base64. */
export const FINANCE_NOTE_MAX_LENGTH = 20_000;
export const financeNoteImageMarker = (attachmentId: string): string => `voucher-note-image://${attachmentId}`;
const NOTE_IMAGE_MARKER_PATTERN = /^voucher-note-image:\/\/([0-9a-f-]{36})$/i;
export const financeNoteImageIdOf = (src: string): string | null => NOTE_IMAGE_MARKER_PATTERN.exec(src)?.[1] ?? null;

export type FinanceVoucherEventAction =
  | 'CREATED'
  | 'UPDATED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'REVERSED'
  /** Phiếu tạo từ bước Tài chính: người khác nhận xử lý thay người đang giữ khoá mềm. */
  | 'TAKEN_OVER';

export const FINANCE_VOUCHER_EVENT_LABELS: Readonly<Record<FinanceVoucherEventAction, string>> = {
  CREATED: 'Tạo phiếu',
  UPDATED: 'Sửa phiếu',
  SUBMITTED: 'Gửi duyệt',
  APPROVED: 'Duyệt và ghi sổ',
  REJECTED: 'Từ chối',
  RETURNED: 'Trả về chỉnh sửa',
  CANCELLED: 'Huỷ phiếu',
  REVERSED: 'Huỷ phiếu đã ghi sổ (đảo bút toán)',
  TAKEN_OVER: 'Nhận xử lý thay',
};

export interface FinanceVoucherEvent {
  id: string;
  action: FinanceVoucherEventAction;
  actorId: string | null;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

export interface FinanceVoucherSummary {
  id: string;
  kind: FinanceVoucherKind;
  code: string;
  voucherDate: string;
  postingDate: string;
  content: string;
  reasonId: string | null;
  reasonName: string | null;
  accountId: string | null;
  accountName: string | null;
  destAccountId: string | null;
  destAccountName: string | null;
  counterpartyGroupName: string | null;
  totalAmount: number;
  status: FinanceVoucherStatus;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  /**
   * Đang chạy qua quy trình duyệt (Procedure), duyệt trực tiếp, hay INHERITED: phiếu tạo từ bước Tài chính của một hồ sơ
   * quy trình (đã duyệt ở quy trình, kế toán chỉ ghi sổ hoặc trả hồ sơ).
   */
  approvalMode: FinanceApprovalMode;
  /** Hạch toán nội bộ, hiển thị ở danh sách. */
  allocation: FinanceAllocation | null;
  /** Mã nháp cấp lúc lập phiếu; giữ suốt vòng đời để tra cứu. Null với phiếu cũ đã ghi sổ trước khi có mã nháp. */
  draftCode: string | null;
  /** Mã chính thức cấp lúc ghi sổ; null khi phiếu chưa từng ghi sổ. `code` là mã đang hiển thị. */
  officialCode: string | null;
  /** Mã hồ sơ quy trình đã tạo ra phiếu (INHERITED); null với phiếu thường. */
  sourceCode: string | null;
}

export interface FinanceVoucher extends FinanceVoucherSummary {
  counterpartyGroupId: string | null;
  /** Hạch toán nội bộ (null: chưa hạch toán). Lệnh chuyển tiền không có. */
  allocation: FinanceAllocation | null;
  taxIncluded: boolean;
  taxRate: number;
  /** Phần thuế trong tổng tiền khi "Bao gồm thuế". */
  taxAmount: number;
  note: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  revision: number;
  lines: FinanceVoucherLine[];
  invoices: FinanceVoucherInvoice[];
  relatedProjects: FinanceRelatedProject[];
  attachments: FinanceVoucherAttachment[];
  events: FinanceVoucherEvent[];
  /** Phiếu đã ghi sổ: tiền đã vào/ra tài khoản. */
  posted: boolean;
  /** Tiến độ quy trình (chế độ PROCEDURE). */
  procedure: FinanceProcedureProgress | null;
  /** Hồ sơ quy trình đã tạo ra phiếu (chế độ INHERITED). */
  source: FinanceVoucherSource | null;
  /** Thao tác người xem được phép làm ngay bây giờ. */
  permissions: FinanceVoucherPermissions;
}

export interface FinanceVoucherPermissions {
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  /** Huỷ phiếu đã ghi sổ (đảo bút toán). */
  canReverse: boolean;
  canDelete: boolean;
  /** Phiếu duyệt qua quy trình đang kẹt (chưa tạo được hồ sơ hoặc chưa ghi sổ được): được bấm thử lại/áp lại. */
  canRetryProcedure: boolean;
  /** Phiếu có nguồn hồ sơ (INHERITED): thao tác của kế toán. Phiếu thường luôn là false. */
  sourced: FinanceSourcedVoucherPermissions;
}

export interface SaveFinanceVoucherRequest {
  kind: FinanceVoucherKind;
  voucherDate: string;
  postingDate: string;
  content: string;
  reasonId?: string | null;
  /** Phiếu thu/chi: tài khoản thu/chi. Lệnh chuyển: tài khoản nguồn. */
  accountId?: string | null;
  destAccountId?: string | null;
  counterpartyGroupId?: string | null;
  /** Hạch toán nội bộ cho dự án/công việc (phiếu thu/chi). */
  allocation?: FinanceAllocationInput | null;
  taxIncluded?: boolean;
  taxRate?: number;
  note?: string | null;
  /** Lệnh chuyển tiền: số tiền một dòng. Phiếu thu/chi tính từ `lines`. */
  amount?: number;
  lines?: FinanceVoucherLine[];
  invoices?: FinanceVoucherInvoice[];
  /** Id dự án liên quan (tham chiếu, không cộng vào tổng của dự án). */
  relatedProjectIds?: string[];
  /** Phiên bản đang sửa, để phát hiện sửa chồng. */
  revision?: number;
}

export interface FinanceVoucherListQuery {
  kind: FinanceVoucherKind;
  status?: FinanceVoucherStatus;
  search?: string;
  accountId?: string;
  reasonId?: string;
  /** Phiếu hạch toán cho dự án này (kể cả công việc thuộc dự án). */
  projectId?: string;
  from?: string;
  to?: string;
  /**
   * Chỉ phiếu của tôi / chờ tôi duyệt / chờ tôi ghi sổ (phiếu từ quy trình mà tôi được giao bước Tài chính) /
   * chờ ghi sổ (mọi phiếu từ quy trình đang chờ, cho người có quyền duyệt loại phiếu).
   */
  scope?: 'mine' | 'to-approve' | 'to-post' | 'awaiting-post';
  /** Chỉ phiếu tạo từ quy trình. */
  source?: 'procedure';
  page?: number;
  pageSize?: number;
}

export interface FinancePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FinanceVoucherList extends FinancePage<FinanceVoucherSummary> {
  /** Số phiếu theo trạng thái (theo bộ lọc nhưng không theo trạng thái), cho các tab. */
  statusCounts: Record<FinanceVoucherStatus, number>;
  /** Tổng tiền các phiếu đã duyệt trong bộ lọc. */
  approvedTotal: number;
  /** Tổng tiền theo trạng thái (cùng bộ lọc như `statusCounts`), cho thẻ tổng kết kỳ: đã duyệt, chờ duyệt, nháp... */
  statusAmounts: Record<FinanceVoucherStatus, number>;
}

export interface FinanceDecisionRequest {
  note?: string;
}

/* --------------------------- Quy trình duyệt --------------------------- */

/** Cách duyệt của phiếu. Cấu hình theo loại phiếu chỉ chọn DIRECT/PROCEDURE; INHERITED chỉ có ở phiếu tạo từ quy trình. */
export type FinanceApprovalMode = 'DIRECT' | 'PROCEDURE' | 'INHERITED';
export type FinanceBindingMode = Exclude<FinanceApprovalMode, 'INHERITED'>;

export interface FinanceApprovalBinding {
  kind: FinanceVoucherKind;
  mode: FinanceBindingMode;
  procedureDefinitionId: string | null;
  procedureDefinitionName: string | null;
  isActive: boolean;
}
export interface SaveFinanceApprovalBindingRequest {
  mode: FinanceBindingMode;
  procedureDefinitionId?: string | null;
}

export interface SaveFinanceApprovalBindingResponse {
  binding: FinanceApprovalBinding;
  /** Cảnh báo cấu hình (không chặn lưu), ví dụ bước đầu của quy trình không chỉ có vai S. */
  warnings: string[];
}

/** Thao tác trên hồ sơ quy trình của phiếu, thực hiện bằng phiên của chính người dùng. */
export type FinanceProcedureActionKind = 'approve' | 'reject' | 'return';
export interface FinanceProcedureActionRequest {
  action: FinanceProcedureActionKind;
  comment?: string;
  /** Mã chống gửi trùng do giao diện sinh cho mỗi lần bấm. */
  idempotencyKey: string;
}

export interface FinanceProcedureProgress {
  instanceId: string | null;
  instanceCode: string | null;
  status: string;
  currentStepName: string | null;
  currentAssigneeName: string | null;
  canAct: boolean | null;
  /**
   * START_PENDING/FAILED: chưa tạo được hồ sơ; RUNNING: đang chạy; APPLIED: kết quả đã áp vào phiếu;
   * CONFLICT: quy trình đã duyệt nhưng chưa ghi sổ được (xem lastError); CLOSED: lần gửi cũ.
   */
  syncStatus: string;
  lastError: string | null;
}

export interface FinanceProcedureDefinitionOption {
  id: string;
  code: string;
  name: string;
}

/* ------------------------------- Báo cáo ------------------------------- */

export interface FinanceReportQuery {
  from: string;
  to: string;
  accountId?: string;
  /** Chỉ phiếu hạch toán cho dự án này. */
  projectId?: string;
}

export interface FinanceCashflowPoint {
  /** Ngày (YYYY-MM-DD) hoặc tháng (YYYY-MM) tuỳ độ chi tiết. */
  period: string;
  receipts: number;
  payments: number;
  net: number;
}

export interface FinanceBreakdownRow {
  id: string | null;
  name: string;
  amount: number;
  count: number;
}

export interface FinanceAccountMovement {
  accountId: string;
  accountName: string;
  openingBalance: number;
  receipts: number;
  payments: number;
  transfersIn: number;
  transfersOut: number;
  closingBalance: number;
}

export interface FinanceReport {
  from: string;
  to: string;
  granularity: 'day' | 'month';
  totals: { receipts: number; payments: number; net: number; receiptCount: number; paymentCount: number; transferCount: number };
  cashflow: FinanceCashflowPoint[];
  receiptsByReason: FinanceBreakdownRow[];
  paymentsByReason: FinanceBreakdownRow[];
  /** Theo dự án hạch toán (công việc gộp về dự án chứa nó); phiếu chưa hạch toán gộp vào "Chưa hạch toán". */
  receiptsByProject: FinanceBreakdownRow[];
  paymentsByProject: FinanceBreakdownRow[];
  accounts: FinanceAccountMovement[];
}

export interface FinanceDashboard {
  today: string;
  monthFrom: string;
  monthTo: string;
  monthReceipts: number;
  monthPayments: number;
  monthNet: number;
  totalBalance: number;
  pendingApprovalCount: number;
  pendingApprovalAmount: number;
  myDraftCount: number;
  cashflow: FinanceCashflowPoint[];
  accounts: Pick<FinanceAccount, 'id' | 'code' | 'name' | 'accountType' | 'balance' | 'pendingOut'>[];
  recent: FinanceVoucherSummary[];
}

/* ---------------------------- Cài đặt & quyền ---------------------------- */

export interface FinanceSettings {
  /** Không ghi sổ/đảo phiếu có ngày hạch toán trước hoặc bằng ngày này. */
  booksLockedUntil: string | null;
  /** Cho phép người lập tự duyệt phiếu của mình (mặc định tắt: tách người lập và người duyệt). */
  allowSelfApproval: boolean;
}
export interface SaveFinanceSettingsRequest {
  booksLockedUntil?: string | null;
  allowSelfApproval?: boolean;
}

export interface FinanceCapabilities {
  canManage: boolean;
  canReadAll: boolean;
  receipt: { create: boolean; approve: boolean };
  payment: { create: boolean; approve: boolean };
  transfer: { create: boolean; approve: boolean };
  canManageAccounts: boolean;
  canReadReports: boolean;
  canManageSettings: boolean;
  procedureAvailable: boolean;
}

/** Quyền tạo/duyệt theo loại phiếu. */
export const FINANCE_KIND_PERMISSIONS: Readonly<
  Record<FinanceVoucherKind, { create: string; approve: string }>
> = {
  RECEIPT: { create: 'finance.receipt.create', approve: 'finance.receipt.approve' },
  PAYMENT: { create: 'finance.payment.create', approve: 'finance.payment.approve' },
  TRANSFER: { create: 'finance.transfer.create', approve: 'finance.transfer.approve' },
};

/* --------------------------- Hàm tính dùng chung --------------------------- */

/** Làm tròn tiền 2 chữ số thập phân (half away from zero) mà không sinh sai số nhị phân. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  // Dịch dấu phẩy bằng số mũ trên chuỗi thập phân để 1.005 làm tròn thành 1.01 (1.005 * 100 = 100.49999...).
  const text = String(abs);
  if (text.includes('e')) return (sign * Math.round(abs * 100)) / 100;
  return sign * Number(`${Math.round(Number(`${text}e2`))}e-2`);
}

export function financeLineTotal(quantity: number, unitAmount: number): number {
  return roundMoney(quantity * unitAmount);
}

export function financeLinesTotal(lines: readonly Pick<FinanceVoucherLine, 'quantity' | 'unitAmount'>[]): number {
  return roundMoney(lines.reduce((sum, line) => sum + financeLineTotal(line.quantity, line.unitAmount), 0));
}

/** Phần thuế nằm trong tổng đã gồm thuế: total - total / (1 + rate%). */
export function financeIncludedTax(total: number, taxRate: number): number {
  if (!(taxRate > 0)) return 0;
  return roundMoney(total - total / (1 + taxRate / 100));
}

/** Kỳ đánh số của một ngày `YYYY-MM-DD`: `YYMM` (2026-10-14 → 2610). */
export function financePeriodOf(date: string): string {
  const [year, month] = date.split('-');
  return `${year.slice(-2)}${month}`;
}

/** Mã chính thức, cấp lúc ghi sổ, đánh số lại từ 1 mỗi kỳ: `PC-2610-0045`. */
export function formatFinanceOfficialCode(kind: FinanceVoucherKind, period: string, sequence: number): string {
  return `${FINANCE_VOUCHER_CODE_PREFIX[kind]}-${period}-${String(sequence).padStart(4, '0')}`;
}

/** Mã nháp, cấp lúc lập phiếu theo dãy riêng: `NHAP_PC_2610_0045`. */
export function formatFinanceDraftCode(kind: FinanceVoucherKind, period: string, sequence: number): string {
  return `NHAP_${FINANCE_VOUCHER_CODE_PREFIX[kind]}_${period}_${String(sequence).padStart(4, '0')}`;
}

export function formatFinanceMoney(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}

/* ----------------- Phiếu của dự án (Workspace đọc qua API nội bộ) ----------------- */

/** Phiếu hiển thị trên trang dự án. Chỉ dữ kiện cần thiết: không tài khoản ngân hàng, không người nộp/nhận tiền. */
export interface FinanceProjectVoucher {
  id: string;
  kind: FinanceVoucherKind;
  code: string;
  voucherDate: string;
  content: string;
  reasonName: string | null;
  status: FinanceVoucherStatus;
  totalAmount: number;
  /** ALLOCATION: hạch toán cho dự án/công việc của dự án (được cộng vào tổng); RELATED: chỉ liên quan (không cộng). */
  link: 'ALLOCATION' | 'RELATED';
  workItem: { id: string; code: string; title: string } | null;
  createdByName: string | null;
}

/** Tổng thu/chi của một nhóm phiếu hạch toán: đã duyệt là đã ghi sổ, chờ duyệt chưa ghi sổ. */
export interface FinanceProjectTotals {
  received: number;
  paid: number;
  pendingReceived: number;
  pendingPaid: number;
  receiptCount: number;
  paymentCount: number;
}

/** Thu/chi hạch toán riêng cho một công việc; chi đã duyệt chính là chi phí thực tế của công việc. */
export interface FinanceProjectWorkItemTotals extends FinanceProjectTotals {
  workItemId: string;
  code: string;
  title: string;
}

export interface FinanceProjectVoucherList {
  items: FinanceProjectVoucher[];
  /** Chỉ tính phiếu HẠCH TOÁN cho dự án (gồm cả phiếu hạch toán cho công việc của dự án). */
  totals: FinanceProjectTotals;
  /** Phần hạch toán cho cả dự án, không gắn công việc nào (chi phí chung, thu chung). */
  projectLevel: FinanceProjectTotals;
  /** Phần hạch toán cho từng công việc của dự án; `totals` = `projectLevel` + tổng các dòng này. */
  workItems: FinanceProjectWorkItemTotals[];
  /** Có phiếu nhiều hơn số trả về (trần danh sách). */
  truncated: boolean;
}
