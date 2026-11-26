import {
  FINANCE_SOURCE_MODULE_PROCEDURE,
  FINANCE_VOUCHER_KINDS,
  FINANCE_VOUCHER_KIND_LABELS,
  FINANCE_VOUCHER_STATUS_LABELS,
  financeAllocationLabel,
  type FinanceVoucherKind,
  type FinanceVoucherSource,
  type FinanceVoucherSummary,
} from '@enterprise-platform/contracts-finance';
import type {
  LinkableCandidate,
  LinkableField,
  LinkableKind,
  LinkableObject,
} from '@enterprise-platform/contracts-integration';
import { canApprove, canCreate, canReadAll, type FinanceActor } from '../domain/finance.access.js';

/**
 * Tài chính công bố phiếu của mình cho module khác gắn vào (hợp đồng `LinkableObject` ở `contracts-integration`).
 *
 * Chỉ chuyển dạng dữ liệu mà service sẵn có đã trả (đã lọc theo quyền và phạm vi của người xem); không đọc thêm gì.
 * `label` chỉ gồm mã và nội dung, không số tiền: bên gắn lưu nhãn này và ai trong dự án cũng thấy. Số tiền nằm ở `fields`,
 * chỉ đọc trực tiếp mỗi lần xem nên người không xem được phiếu ở Tài chính thì không thấy.
 */
export const FINANCE_LINKABLE_KINDS = {
  receipt: 'finance.receipt',
  payment: 'finance.payment',
  transfer: 'finance.transfer',
} as const;

export type FinanceLinkableKind = (typeof FINANCE_LINKABLE_KINDS)[keyof typeof FINANCE_LINKABLE_KINDS];

const MODULE_LABEL = 'Tài chính';

/** Khoá loại công bố ↔ loại phiếu nội bộ. */
const VOUCHER_KIND_OF: Readonly<Record<FinanceLinkableKind, FinanceVoucherKind>> = {
  'finance.receipt': 'RECEIPT',
  'finance.payment': 'PAYMENT',
  'finance.transfer': 'TRANSFER',
};

/** Trang chi tiết phiếu trong giao diện Tài chính (`apps/finance-web`, basePath `/modules/finance`). */
const PAGE_OF: Readonly<Record<FinanceLinkableKind, string>> = {
  'finance.receipt': 'receipts',
  'finance.payment': 'payments',
  'finance.transfer': 'transfers',
};

const linkableKindOf = (kind: FinanceVoucherKind): FinanceLinkableKind =>
  (Object.keys(VOUCHER_KIND_OF) as FinanceLinkableKind[]).find((key) => VOUCHER_KIND_OF[key] === kind) as FinanceLinkableKind;

/** Thứ tự: phiếu thu, phiếu chi, lệnh chuyển tiền. Nhãn lấy từ hợp đồng Tài chính để khớp với màn hình Tài chính. */
export const FINANCE_LINKABLE_KIND_LIST: readonly LinkableKind[] = FINANCE_VOUCHER_KINDS.map((kind) => ({
  key: linkableKindOf(kind),
  moduleLabel: MODULE_LABEL,
  label: FINANCE_VOUCHER_KIND_LABELS[kind],
  prefill: false,
}));

export function isFinanceLinkableKind(value: unknown): value is FinanceLinkableKind {
  return FINANCE_LINKABLE_KIND_LIST.some((kind) => kind.key === value);
}

export const voucherKindOfLinkable = (kind: FinanceLinkableKind): FinanceVoucherKind => VOUCHER_KIND_OF[kind];

/**
 * Loại người dùng đọc được danh sách: cùng điều kiện với màn danh sách phiếu (lập, duyệt loại đó, hoặc đọc toàn bộ phiếu).
 * Người không vào được danh sách loại nào thì không thấy loại đó trong ô chọn.
 */
export function financeLinkableKinds(actor: FinanceActor): readonly LinkableKind[] {
  return FINANCE_LINKABLE_KIND_LIST.filter((kind) => {
    const voucherKind = VOUCHER_KIND_OF[kind.key as FinanceLinkableKind];
    return canCreate(actor, voucherKind) || canApprove(actor, voucherKind) || canReadAll(actor);
  });
}

/** Đường dẫn mở phiếu trong giao diện Tài chính; mã hoá cả `!'()*` để chỉ còn ký tự hợp đồng cho phép. */
export function financeLaunchUrl(kind: FinanceLinkableKind, id: string): string {
  const safeId = encodeURIComponent(id).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `/modules/finance/${PAGE_OF[kind]}/${safeId}`;
}

/** Nhãn trường theo loại phiếu, giống màn chi tiết phiếu của Tài chính. */
const FIELD_LABELS: Readonly<
  Record<FinanceVoucherKind, { content: string; reason: string; account: string; group: string; person: string }>
> = {
  RECEIPT: {
    content: 'Nội dung thu',
    reason: 'Lý do thu',
    account: 'Tài khoản thu',
    group: 'Đối tượng thu',
    person: 'Người nộp tiền',
  },
  PAYMENT: {
    content: 'Nội dung chi',
    reason: 'Lý do chi',
    account: 'Tài khoản chi',
    group: 'Đối tượng chi',
    person: 'Người nhận tiền',
  },
  TRANSFER: { content: 'Lý do', reason: 'Lý do', account: 'Tài khoản nguồn', group: '', person: '' },
};

/** Nội dung phiếu là chữ tự do: cắt ngắn khi đưa vào nhãn. */
const LABEL_CONTENT_MAX = 80;

const joined = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(' — ');
const shorten = (value: string | null | undefined, max: number) => {
  const clean = (value ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};
const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
const text = (key: string, label: string, value: string | number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'text',
  value: value == null || value === '' ? null : String(value),
});
const date = (key: string, label: string, value: string | null | undefined): LinkableField => ({
  key,
  label,
  type: 'date',
  value: day(value),
});
const money = (key: string, label: string, value: number | null | undefined): LinkableField => ({
  key,
  label,
  type: 'money',
  value: value == null ? null : value,
});

const statusLabel = (row: FinanceVoucherSummary) => FINANCE_VOUCHER_STATUS_LABELS[row.status] ?? row.status;
const accountsText = (row: FinanceVoucherSummary) =>
  row.kind === 'TRANSFER'
    ? [row.accountName, row.destAccountName].filter((name): name is string => Boolean(name && name.trim())).join(' → ')
    : row.accountName;

/* ------------------------------------------------------------------ Phiếu */

export function voucherCandidate(row: FinanceVoucherSummary): LinkableCandidate {
  return {
    kind: linkableKindOf(row.kind),
    id: row.id,
    code: row.code,
    label: joined(row.code, shorten(row.content, LABEL_CONTENT_MAX)),
    status: statusLabel(row),
    hint: joined(row.kind === 'TRANSFER' ? accountsText(row) : row.counterpartyName ?? row.counterpartyGroupName, day(row.voucherDate)),
  };
}

/** Nguồn đã tạo ra phiếu (hồ sơ quy trình hoặc bản ghi của phân hệ khác); có ở phiếu đọc chi tiết. */
type VoucherSourceView = Pick<FinanceVoucherSource, 'sourceModule' | 'instanceCode' | 'instanceTitle' | 'definitionName'>;

export function voucherObject(row: FinanceVoucherSummary & { readonly source?: VoucherSourceView | null }): LinkableObject {
  const labels = FIELD_LABELS[row.kind];
  const kind = linkableKindOf(row.kind);
  const isTransfer = row.kind === 'TRANSFER';
  const source = row.source ?? null;
  const fromProcedure = source ? source.sourceModule === FINANCE_SOURCE_MODULE_PROCEDURE : Boolean(row.sourceCode);
  const sourceText = source
    ? joined(source.instanceCode, source.definitionName ?? source.instanceTitle)
    : row.sourceCode;
  const fields: LinkableField[] = [
    text('code', 'Mã phiếu', row.code),
    date('voucherDate', 'Ngày chứng từ', row.voucherDate),
    date('postingDate', 'Ngày hạch toán', row.postingDate),
    text('content', labels.content, row.content),
  ];
  if (!isTransfer) fields.push(text('reason', labels.reason, row.reasonName));
  fields.push(text('account', labels.account, row.accountName));
  if (isTransfer) fields.push(text('destAccount', 'Tài khoản đích', row.destAccountName));
  else {
    fields.push(text('counterpartyGroup', labels.group, row.counterpartyGroupName));
    fields.push(text('counterparty', labels.person, row.counterpartyName));
  }
  fields.push(
    money('totalAmount', 'Tổng tiền', row.totalAmount),
    text('status', 'Trạng thái', statusLabel(row)),
    text('allocation', 'Hạch toán cho dự án', row.allocation ? financeAllocationLabel(row.allocation) : null),
    text('createdBy', 'Người lập', row.createdByName),
    text('source', fromProcedure ? 'Nguồn quy trình' : 'Nguồn', sourceText),
  );
  return {
    ...voucherCandidate(row),
    launchUrl: financeLaunchUrl(kind, row.id),
    fields,
    // Phiếu chỉ trỏ tới dự án Workspace hoặc lần thu của Bán hàng; không loại nào trong số đó là đối tượng đã công bố.
    upstream: [],
  };
}
