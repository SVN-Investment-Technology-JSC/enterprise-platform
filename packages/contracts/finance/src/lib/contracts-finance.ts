/**
 * Hợp đồng dữ liệu của module Tài chính (Finance).
 *
 * Phiếu thu, phiếu chi và lệnh chuyển tiền dùng chung một bảng `vouchers`; khác nhau ở `kind`.
 * Tiền được ghi sổ (sổ cái tài khoản) khi phiếu được DUYỆT, không phải khi lập.
 */

export const FINANCE_VOUCHER_KINDS = ['RECEIPT', 'PAYMENT', 'TRANSFER'] as const;
export type FinanceVoucherKind = (typeof FINANCE_VOUCHER_KINDS)[number];

export const FINANCE_VOUCHER_KIND_LABELS: Readonly<Record<FinanceVoucherKind, string>> = {
  RECEIPT: 'Phiếu thu',
  PAYMENT: 'Phiếu chi',
  TRANSFER: 'Lệnh chuyển tiền',
};

/** Tiền tố mã phiếu: PT_<số thứ tự>_<tháng>_<năm>. */
export const FINANCE_VOUCHER_CODE_PREFIX: Readonly<Record<FinanceVoucherKind, string>> = {
  RECEIPT: 'PT',
  PAYMENT: 'PC',
  TRANSFER: 'PCT',
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

/** Trung tâm chi phí / đơn vị hạch toán nội bộ. */
export interface FinanceCostCenter {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}
export interface SaveFinanceCostCenterRequest {
  code: string;
  name: string;
  isActive?: boolean;
}

export interface FinanceCatalogs {
  reasons: FinanceReason[];
  counterpartyGroups: FinanceCounterpartyGroup[];
  costCenters: FinanceCostCenter[];
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

export interface FinanceVoucherRelated {
  id?: string;
  /** VOUCHER: trỏ tới một phiếu khác; REFERENCE: tham chiếu tự do (số hợp đồng, mã dự án...). */
  kind: 'VOUCHER' | 'REFERENCE';
  voucherId?: string | null;
  label: string;
}

export interface FinanceVoucherAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
}

export type FinanceVoucherEventAction =
  | 'CREATED'
  | 'UPDATED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'REVERSED';

export const FINANCE_VOUCHER_EVENT_LABELS: Readonly<Record<FinanceVoucherEventAction, string>> = {
  CREATED: 'Tạo phiếu',
  UPDATED: 'Sửa phiếu',
  SUBMITTED: 'Gửi duyệt',
  APPROVED: 'Duyệt và ghi sổ',
  REJECTED: 'Từ chối',
  RETURNED: 'Trả về chỉnh sửa',
  CANCELLED: 'Huỷ phiếu',
  REVERSED: 'Huỷ phiếu đã ghi sổ (đảo bút toán)',
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
  counterpartyName: string | null;
  totalAmount: number;
  status: FinanceVoucherStatus;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  /** Đang chạy qua quy trình duyệt (Procedure) hay duyệt trực tiếp. */
  approvalMode: FinanceApprovalMode;
}

export interface FinanceVoucher extends FinanceVoucherSummary {
  counterpartyGroupId: string | null;
  counterpartyAccountNo: string | null;
  counterpartyBank: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
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
  related: FinanceVoucherRelated[];
  attachments: FinanceVoucherAttachment[];
  events: FinanceVoucherEvent[];
  /** Phiếu đã ghi sổ: tiền đã vào/ra tài khoản. */
  posted: boolean;
  /** Tiến độ quy trình (chế độ PROCEDURE). */
  procedure: FinanceProcedureProgress | null;
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
  counterpartyName?: string | null;
  counterpartyAccountNo?: string | null;
  counterpartyBank?: string | null;
  costCenterId?: string | null;
  taxIncluded?: boolean;
  taxRate?: number;
  note?: string | null;
  /** Lệnh chuyển tiền: số tiền một dòng. Phiếu thu/chi tính từ `lines`. */
  amount?: number;
  lines?: FinanceVoucherLine[];
  invoices?: FinanceVoucherInvoice[];
  related?: FinanceVoucherRelated[];
  /** Phiên bản đang sửa, để phát hiện sửa chồng. */
  revision?: number;
}

export interface FinanceVoucherListQuery {
  kind: FinanceVoucherKind;
  status?: FinanceVoucherStatus;
  search?: string;
  accountId?: string;
  reasonId?: string;
  costCenterId?: string;
  from?: string;
  to?: string;
  /** Chỉ phiếu của tôi / chỉ phiếu chờ tôi duyệt. */
  scope?: 'mine' | 'to-approve';
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

export type FinanceApprovalMode = 'DIRECT' | 'PROCEDURE';

export interface FinanceApprovalBinding {
  kind: FinanceVoucherKind;
  mode: FinanceApprovalMode;
  procedureDefinitionId: string | null;
  procedureDefinitionName: string | null;
  isActive: boolean;
}
export interface SaveFinanceApprovalBindingRequest {
  mode: FinanceApprovalMode;
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
  costCenterId?: string;
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
  paymentsByCostCenter: FinanceBreakdownRow[];
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

/** Mã phiếu: PT_<số thứ tự>_<tháng 2 chữ số>_<năm>. */
export function formatFinanceVoucherCode(kind: FinanceVoucherKind, sequence: number, date: string): string {
  const [year, month] = date.split('-');
  return `${FINANCE_VOUCHER_CODE_PREFIX[kind]}_${sequence}_${month}_${year}`;
}

export function formatFinanceMoney(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}
