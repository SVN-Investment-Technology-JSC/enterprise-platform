import {
  FINANCE_MAX_AMOUNT,
  FINANCE_VOUCHER_KINDS,
  financeLineTotal,
  roundMoney,
  type FinanceVoucherInvoice,
  type FinanceVoucherKind,
  type FinanceAllocationInput,
  type FinanceVoucherPermissions,
  type FinanceVoucherStatus,
  type SaveFinanceVoucherRequest,
} from '@enterprise-platform/contracts-finance';
import { invalid } from './finance.error.js';

export interface NormalizedLine {
  lineNo: number;
  description: string;
  quantity: number;
  unitAmount: number;
  total: number;
}

export interface NormalizedVoucher {
  kind: FinanceVoucherKind;
  voucherDate: string;
  postingDate: string;
  content: string;
  reasonId: string | null;
  accountId: string | null;
  destAccountId: string | null;
  counterpartyGroupId: string | null;
  counterpartyName: string | null;
  counterpartyAccountNo: string | null;
  counterpartyBank: string | null;
  /** Hạch toán nội bộ cho dự án/công việc; mã và tên lấy từ Workspace khi lưu (xem `resolveWorkspaceLinks`). */
  allocation: { type: FinanceAllocationInput['type']; projectId: string; workItemId: string | null } | null;
  taxIncluded: boolean;
  taxRate: number;
  note: string | null;
  totalAmount: number;
  lines: NormalizedLine[];
  invoices: (Required<Pick<FinanceVoucherInvoice, 'invoiceNo' | 'amount'>> & {
    invoiceDate: string | null;
    taxCode: string | null;
  })[];
  /** Dự án liên quan (chỉ tham chiếu), đã bỏ trùng và bỏ dự án đang là dự án hạch toán. */
  relatedProjectIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINES = 200;
const MAX_INVOICES = 50;
const MAX_RELATED = 50;
const ALLOCATION_TYPES: readonly string[] = ['PROJECT', 'WORK_ITEM'];

/** Ngày dạng YYYY-MM-DD và hợp lệ theo lịch (không nhận 2026-02-30). */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function text(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid(`${label} không hợp lệ.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw invalid(`${label} tối đa ${max} ký tự.`);
  return trimmed;
}

function uuidOrNull(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(`${label} không hợp lệ.`);
  return value;
}

function money(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw invalid(`${label} không hợp lệ.`);
  if (number < 0) throw invalid(`${label} không được âm.`);
  if (number > FINANCE_MAX_AMOUNT) throw invalid(`${label} vượt giới hạn cho phép.`);
  return roundMoney(number);
}

/**
 * Chuẩn hoá và kiểm tra cấu trúc dữ liệu một phiếu (đủ để lưu nháp). Server luôn tính lại thành tiền
 * từng dòng và tổng phiếu, không tin số client gửi. Điều kiện để GỬI DUYỆT nằm ở `validateForSubmit`.
 */
export function normalizeVoucherInput(input: SaveFinanceVoucherRequest): NormalizedVoucher {
  if (!FINANCE_VOUCHER_KINDS.includes(input.kind)) throw invalid('Loại phiếu không hợp lệ.');
  if (!isValidDate(input.voucherDate)) throw invalid('Ngày lập phiếu không hợp lệ.');
  if (!isValidDate(input.postingDate)) throw invalid('Ngày hạch toán không hợp lệ.');
  const content = text(input.content, 500, 'Nội dung');
  if (!content) throw invalid('Nội dung là bắt buộc.');

  const kind = input.kind;
  const isTransfer = kind === 'TRANSFER';
  const taxRate = money(input.taxRate, 'Thuế suất');
  if (taxRate > 100) throw invalid('Thuế suất tối đa 100%.');

  const lines: NormalizedLine[] = [];
  let totalAmount = 0;
  if (isTransfer) {
    totalAmount = money(input.amount, 'Số tiền');
  } else {
    const rawLines = input.lines ?? [];
    if (rawLines.length > MAX_LINES) throw invalid(`Tối đa ${MAX_LINES} dòng chi tiết.`);
    rawLines.forEach((raw, index) => {
      const description = text(raw.description, 500, `Diễn giải dòng ${index + 1}`);
      const unitAmount = money(raw.unitAmount, `Số tiền dòng ${index + 1}`);
      // Dòng trắng hoàn toàn (form luôn có sẵn một dòng) được bỏ qua thay vì báo lỗi.
      if (!description && unitAmount === 0) return;
      const quantity = raw.quantity === undefined || raw.quantity === null ? 1 : Number(raw.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw invalid(`Số lượng dòng ${index + 1} phải lớn hơn 0.`);
      if (quantity > 999_999_999) throw invalid(`Số lượng dòng ${index + 1} vượt giới hạn cho phép.`);
      if (!description) throw invalid(`Dòng ${index + 1} thiếu diễn giải.`);
      const total = financeLineTotal(quantity, unitAmount);
      if (total > FINANCE_MAX_AMOUNT) throw invalid(`Thành tiền dòng ${index + 1} vượt giới hạn cho phép.`);
      lines.push({ lineNo: lines.length + 1, description, quantity: Math.round(quantity * 1000) / 1000, unitAmount, total });
    });
    totalAmount = roundMoney(lines.reduce((sum, line) => sum + line.total, 0));
    if (totalAmount > FINANCE_MAX_AMOUNT) throw invalid('Tổng tiền vượt giới hạn cho phép.');
  }

  const rawInvoices = input.invoices ?? [];
  if (rawInvoices.length > MAX_INVOICES) throw invalid(`Tối đa ${MAX_INVOICES} hoá đơn.`);
  const invoices = rawInvoices.map((raw, index) => {
    const invoiceNo = text(raw.invoiceNo, 80, `Số hoá đơn ${index + 1}`);
    if (!invoiceNo) throw invalid(`Hoá đơn ${index + 1} thiếu số hoá đơn.`);
    if (raw.invoiceDate && !isValidDate(raw.invoiceDate)) throw invalid(`Ngày hoá đơn ${index + 1} không hợp lệ.`);
    return {
      invoiceNo,
      invoiceDate: raw.invoiceDate || null,
      taxCode: text(raw.taxCode, 30, `Mã số thuế hoá đơn ${index + 1}`),
      amount: money(raw.amount, `Số tiền hoá đơn ${index + 1}`),
    };
  });

  const allocation = normalizeAllocation(input.allocation, isTransfer);

  const rawRelated = input.relatedProjectIds ?? [];
  if (!Array.isArray(rawRelated)) throw invalid('Đối tượng liên quan không hợp lệ.');
  if (rawRelated.length > MAX_RELATED) throw invalid(`Tối đa ${MAX_RELATED} đối tượng liên quan.`);
  const relatedProjectIds: string[] = [];
  rawRelated.forEach((raw, index) => {
    const id = uuidOrNull(raw, `Đối tượng liên quan ${index + 1}`);
    if (!id) throw invalid(`Đối tượng liên quan ${index + 1} không hợp lệ.`);
    const lower = id.toLowerCase();
    // Dự án đang hạch toán đã được ghi riêng; lặp lại trong "liên quan" chỉ làm một dự án xuất hiện hai lần ở trang dự án.
    if (lower !== allocation?.projectId && !relatedProjectIds.includes(lower)) relatedProjectIds.push(lower);
  });

  const accountId = uuidOrNull(input.accountId, 'Tài khoản');
  const destAccountId = isTransfer ? uuidOrNull(input.destAccountId, 'Tài khoản đích') : null;
  if (accountId && destAccountId && accountId === destAccountId) throw invalid('Tài khoản nguồn và tài khoản đích phải khác nhau.');

  return {
    kind,
    voucherDate: input.voucherDate,
    postingDate: input.postingDate,
    content,
    // Lệnh chuyển tiền chỉ có tài khoản nguồn/đích; không có lý do, đối tượng, đơn vị hay thuế.
    reasonId: isTransfer ? null : uuidOrNull(input.reasonId, 'Lý do'),
    accountId,
    destAccountId,
    counterpartyGroupId: isTransfer ? null : uuidOrNull(input.counterpartyGroupId, 'Đối tượng'),
    counterpartyName: isTransfer ? null : text(input.counterpartyName, 255, 'Người nộp/nhận tiền'),
    counterpartyAccountNo: isTransfer ? null : text(input.counterpartyAccountNo, 60, 'Số tài khoản'),
    counterpartyBank: isTransfer ? null : text(input.counterpartyBank, 120, 'Ngân hàng'),
    allocation,
    taxIncluded: isTransfer ? false : input.taxIncluded === true,
    taxRate: isTransfer || input.taxIncluded !== true ? 0 : taxRate,
    note: text(input.note, 4000, 'Ghi chú'),
    totalAmount,
    lines,
    invoices,
    relatedProjectIds,
  };
}

/** Hạch toán: dự án, hoặc công việc (kèm dự án chứa nó). Lệnh chuyển tiền chuyển giữa hai tài khoản công ty nên không hạch toán. */
function normalizeAllocation(raw: FinanceAllocationInput | null | undefined, isTransfer: boolean): NormalizedVoucher['allocation'] {
  if (raw === undefined || raw === null) return null;
  if (isTransfer) throw invalid('Lệnh chuyển tiền không hạch toán cho dự án hoặc công việc.');
  if (typeof raw !== 'object' || !ALLOCATION_TYPES.includes(raw.type)) throw invalid('Hình thức hạch toán không hợp lệ.');
  const projectId = uuidOrNull(raw.projectId, 'Dự án hạch toán');
  if (!projectId) throw invalid('Chọn dự án để hạch toán.');
  const workItemId = uuidOrNull(raw.workItemId, 'Công việc hạch toán');
  if (raw.type === 'WORK_ITEM' && !workItemId) throw invalid('Chọn công việc để hạch toán.');
  if (raw.type === 'PROJECT' && workItemId) throw invalid('Hạch toán cho dự án không kèm công việc.');
  return { type: raw.type, projectId: projectId.toLowerCase(), workItemId: workItemId ? workItemId.toLowerCase() : null };
}

export interface SubmitReferences {
  account: { name: string; isActive: boolean; openingDate: string } | null;
  dest: { name: string; isActive: boolean; openingDate: string } | null;
  reason: { kind: string; isActive: boolean } | null;
  counterpartyGroup: { isActive: boolean } | null;
}

/** Điều kiện để gửi duyệt: trả danh sách lỗi (rỗng nghĩa là hợp lệ). */
export function validateForSubmit(voucher: NormalizedVoucher, refs: SubmitReferences): string[] {
  const errors: string[] = [];
  const isTransfer = voucher.kind === 'TRANSFER';
  if (voucher.totalAmount <= 0) errors.push('Số tiền phải lớn hơn 0.');
  if (!isTransfer) {
    if (!voucher.lines.length) errors.push('Cần ít nhất một dòng chi tiết.');
    if (voucher.lines.some((line) => line.total <= 0)) errors.push('Mỗi dòng chi tiết phải có thành tiền lớn hơn 0.');
    if (!voucher.reasonId) errors.push(voucher.kind === 'RECEIPT' ? 'Chọn lý do thu.' : 'Chọn lý do chi.');
    else if (!refs.reason) errors.push('Lý do không tồn tại.');
    else {
      if (refs.reason.kind !== voucher.kind) errors.push('Lý do không đúng loại phiếu.');
      if (!refs.reason.isActive) errors.push('Lý do đã ngừng sử dụng.');
    }
    if (!voucher.counterpartyGroupId) errors.push(voucher.kind === 'RECEIPT' ? 'Chọn đối tượng thu.' : 'Chọn đối tượng chi.');
    else if (!refs.counterpartyGroup) errors.push('Đối tượng không tồn tại.');
    else if (!refs.counterpartyGroup.isActive) errors.push('Đối tượng đã ngừng sử dụng.');
  }
  const accountLabel = isTransfer ? 'tài khoản nguồn' : voucher.kind === 'RECEIPT' ? 'tài khoản thu' : 'tài khoản chi';
  if (!voucher.accountId) errors.push(`Chọn ${accountLabel}.`);
  else if (!refs.account) errors.push(`${capitalize(accountLabel)} không tồn tại.`);
  else {
    if (!refs.account.isActive) errors.push(`${capitalize(accountLabel)} đã ngừng sử dụng.`);
    if (voucher.postingDate < refs.account.openingDate)
      errors.push(`Ngày hạch toán trước ngày bắt đầu sử dụng của ${refs.account.name} (${refs.account.openingDate}).`);
  }
  if (isTransfer) {
    if (!voucher.destAccountId) errors.push('Chọn tài khoản đích.');
    else if (!refs.dest) errors.push('Tài khoản đích không tồn tại.');
    else {
      if (!refs.dest.isActive) errors.push('Tài khoản đích đã ngừng sử dụng.');
      if (voucher.postingDate < refs.dest.openingDate)
        errors.push(`Ngày hạch toán trước ngày bắt đầu sử dụng của ${refs.dest.name} (${refs.dest.openingDate}).`);
    }
    if (voucher.accountId && voucher.destAccountId && voucher.accountId === voucher.destAccountId)
      errors.push('Tài khoản nguồn và tài khoản đích phải khác nhau.');
  }
  return errors;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface PermissionInput {
  status: FinanceVoucherStatus;
  createdBy: string;
  actorId: string;
  canCreate: boolean;
  canApprove: boolean;
  allowSelfApproval: boolean;
  approvalMode: 'DIRECT' | 'PROCEDURE';
  /** Chế độ PROCEDURE: người dùng đang được giao bước hiện tại (null: chưa biết). */
  procedureCanAct: boolean | null;
}

/** Thao tác người xem được làm trên một phiếu. Server kiểm lại ở từng endpoint, đây chỉ để giao diện hiển thị nút. */
export function computeVoucherPermissions(input: PermissionInput): FinanceVoucherPermissions {
  const mine = input.createdBy === input.actorId;
  const owner = mine && input.canCreate;
  const editable = input.status === 'DRAFT' || input.status === 'REJECTED';
  const pending = input.status === 'PENDING';
  const directDecision =
    pending && input.approvalMode === 'DIRECT' && input.canApprove && (!mine || input.allowSelfApproval);
  const procedureDecision = pending && input.approvalMode === 'PROCEDURE' && input.procedureCanAct === true;
  const decide = directDecision || procedureDecision;
  return {
    canEdit: editable && owner,
    canSubmit: editable && owner,
    canApprove: decide,
    canReject: decide,
    canCancel: (editable || pending) && (owner || (input.canApprove && input.status !== 'DRAFT')),
    canReverse: input.status === 'APPROVED' && input.canApprove,
    canDelete: input.status === 'DRAFT' && owner,
    // Nơi gọi (có thông tin liên kết quy trình) bật cờ này sau khi tính.
    canRetryProcedure: false,
  };
}

/** Hạn mức ghi sổ: ngày hạch toán phải nằm sau ngày khoá sổ và không ở tương lai. */
export function assertPostingDateAllowed(postingDate: string, booksLockedUntil: string | null, today: string): void {
  if (booksLockedUntil && postingDate <= booksLockedUntil)
    throw invalid(`Sổ đã khoá đến ngày ${booksLockedUntil}; không thể ghi sổ hoặc đảo phiếu có ngày hạch toán ${postingDate}.`);
  if (postingDate > today) throw invalid(`Ngày hạch toán ${postingDate} ở tương lai; chỉ được duyệt từ ngày đó trở đi.`);
}
