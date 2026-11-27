import type { FinanceVoucherKind, FinanceVoucherSortKey } from '@enterprise-platform/contracts-finance';
import type { FinanceKindConfig } from './finance-kinds';

/** Mã cột của danh sách phiếu; lưu theo từng người dùng nên không đổi tên mã đã dùng. */
export type VoucherColumnKey =
  | 'code'
  | 'date'
  | 'content'
  | 'accounts'
  | 'reason'
  | 'account'
  | 'counterparty'
  | 'person'
  | 'allocation'
  | 'project'
  | 'created-by'
  | 'amount'
  | 'status';

export interface VoucherColumnDef {
  key: VoucherColumnKey;
  label: string;
  /** Bề ngang mặc định (px); người dùng kéo mép tiêu đề cột để đổi, bề ngang riêng được nhớ trên trình duyệt. */
  width: number;
  /** Bề ngang nhỏ nhất khi kéo (px). */
  minWidth: number;
  /** Cột luôn hiện (mã phiếu là đường mở phiếu). */
  required?: boolean;
  /** Có trong bộ cột mặc định khi người dùng chưa chọn. */
  byDefault: boolean;
  /**
   * Cột thêm vào SAU khi người dùng có thể đã lưu bộ cột riêng: vẫn hiện với bộ đã lưu khi bộ đó không nhắc tới cột này (không có mã
   * cột, cũng không có dấu ẩn `no-<mã>`). Người dùng bỏ chọn thì lưu dấu ẩn để cột không tự hiện lại.
   */
  addedLater?: boolean;
  /** Mã sắp xếp gửi máy chủ (danh sách phân trang ở máy chủ nên sắp xếp cũng ở máy chủ). */
  sortKey: FinanceVoucherSortKey;
}

/** Dấu "đã ẩn" của cột thêm sau, lưu cùng bộ cột (cùng dạng mã cột `^[a-z][a-z0-9-]{0,39}$` máy chủ nhận). */
export const hiddenColumnMarker = (key: VoucherColumnKey): string => `no-${key}`;

/**
 * Các cột có của một loại phiếu, theo thứ tự hiển thị (gọn như danh sách phiếu chi của 1Office): số tiền và trạng thái đứng sớm để
 * luôn thấy mà không phải cuộn ngang; các cột tham chiếu (tài khoản, đối tượng, hạch toán, người tạo) ở sau.
 */
export function voucherColumnCatalog(kind: FinanceVoucherKind, config: FinanceKindConfig): VoucherColumnDef[] {
  const transfer = kind === 'TRANSFER';
  const all: (VoucherColumnDef | false)[] = [
    // Đủ rộng để mã nháp dài nhất ("NHAP_PC_2611_0014") nằm trên một dòng.
    { key: 'code', label: config.codeLabel, width: 168, minWidth: 120, required: true, byDefault: true, sortKey: 'code' },
    { key: 'date', label: config.dateLabel, width: 96, minWidth: 80, byDefault: true, sortKey: 'voucher-date' },
    { key: 'content', label: config.contentLabel, width: transfer ? 320 : 280, minWidth: 120, byDefault: true, sortKey: 'content' },
    !transfer && { key: 'reason', label: config.reasonLabel, width: 170, minWidth: 90, byDefault: true, sortKey: 'reason' },
    { key: 'amount', label: 'Số tiền', width: 124, minWidth: 90, byDefault: true, sortKey: 'amount' },
    { key: 'status', label: 'Trạng thái', width: 104, minWidth: 80, byDefault: true, sortKey: 'status' },
    transfer && { key: 'accounts', label: 'Từ tài khoản → Đến tài khoản', width: 300, minWidth: 140, byDefault: true, sortKey: 'account' },
    !transfer && { key: 'account', label: 'Tài khoản', width: 170, minWidth: 90, byDefault: true, sortKey: 'account' },
    !transfer && { key: 'counterparty', label: config.counterpartyLabel, width: 130, minWidth: 80, byDefault: true, sortKey: 'counterparty' },
    !transfer && { key: 'person', label: config.personLabel, width: 170, minWidth: 90, byDefault: false, sortKey: 'person' },
    // Hạch toán chỉ hiện mã dự án (tên đầy đủ khi rê chuột); cột "Dự án" (thêm) hiện cả mã và tên.
    !transfer && { key: 'allocation', label: 'Hạch toán', width: 120, minWidth: 80, byDefault: true, sortKey: 'allocation' },
    !transfer && { key: 'project', label: 'Dự án', width: 220, minWidth: 100, byDefault: false, sortKey: 'allocation' },
    // Người tạo: phiếu từ quy trình là người khởi tạo hồ sơ, còn lại là người lập phiếu ở Tài chính.
    { key: 'created-by', label: 'Người tạo', width: 170, minWidth: 100, byDefault: true, addedLater: true, sortKey: 'created-by' },
  ];
  return all.filter((column): column is VoucherColumnDef => Boolean(column));
}

/**
 * Cột đang hiện: theo lựa chọn đã lưu (giữ thứ tự của bảng, bỏ mã lạ, luôn có cột bắt buộc; cột thêm sau hiện khi bộ đã lưu không
 * nhắc tới nó), chưa lưu thì bộ mặc định.
 */
export function visibleVoucherColumns(catalog: readonly VoucherColumnDef[], saved: readonly string[] | null): VoucherColumnDef[] {
  if (!saved) return catalog.filter((column) => column.byDefault);
  const chosen = new Set(saved);
  return catalog.filter(
    (column) => column.required || chosen.has(column.key) || (column.addedLater === true && !chosen.has(hiddenColumnMarker(column.key))),
  );
}

/** Bộ cột để lưu khi người dùng bật/tắt cột: mã các cột đang hiện, cộng dấu ẩn cho cột thêm sau đang tắt. */
export function voucherColumnSelection(catalog: readonly VoucherColumnDef[], visible: ReadonlySet<string>): string[] {
  const shown = catalog.filter((column) => column.required || visible.has(column.key)).map((column): string => column.key);
  const hidden = catalog
    .filter((column) => column.addedLater && !column.required && !visible.has(column.key))
    .map((column) => hiddenColumnMarker(column.key));
  return [...shown, ...hidden];
}

/** Bề ngang (px) của từng cột đang hiện: bề ngang người dùng đã kéo (không nhỏ hơn mức tối thiểu), chưa kéo thì mặc định. */
export function voucherColumnWidths(columns: readonly VoucherColumnDef[], saved: Readonly<Record<string, number>> = {}): Record<string, number> {
  return Object.fromEntries(
    columns.map((column) => {
      const custom = saved[column.key];
      return [column.key, typeof custom === 'number' && Number.isFinite(custom) ? Math.max(column.minWidth, Math.round(custom)) : column.width];
    }),
  );
}

const widthsKey = (kind: FinanceVoucherKind) => `finance.voucher-list.widths.${kind}`;

/** Bề ngang cột đã kéo của một loại phiếu, nhớ trên trình duyệt; không đọc được thì coi như chưa kéo. */
export function loadVoucherColumnWidths(kind: FinanceVoucherKind): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(widthsKey(kind)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])));
  } catch {
    return {};
  }
}

/** Lưu bề ngang đã kéo; `null` xoá (về bề ngang mặc định). */
export function saveVoucherColumnWidths(kind: FinanceVoucherKind, widths: Readonly<Record<string, number>> | null): void {
  try {
    if (widths && Object.keys(widths).length) globalThis.localStorage?.setItem(widthsKey(kind), JSON.stringify(widths));
    else globalThis.localStorage?.removeItem(widthsKey(kind));
  } catch {
    /* không lưu được thì chỉ áp cho lần xem này */
  }
}

const orderKey = (kind: FinanceVoucherKind) => `finance.voucher-list.order.${kind}`;

/** Thứ tự cột người dùng đã kéo thả, nhớ trên trình duyệt theo loại phiếu; chưa kéo hay không đọc được thì `[]`. */
export function loadVoucherColumnOrder(kind: FinanceVoucherKind): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(orderKey(kind)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/** Lưu thứ tự cột; `null` hay rỗng thì xoá (về thứ tự mặc định). */
export function saveVoucherColumnOrder(kind: FinanceVoucherKind, order: readonly string[] | null): void {
  try {
    if (order && order.length) globalThis.localStorage?.setItem(orderKey(kind), JSON.stringify(order));
    else globalThis.localStorage?.removeItem(orderKey(kind));
  } catch {
    /* không lưu được thì chỉ áp cho lần xem này */
  }
}

/**
 * Xếp cột theo thứ tự đã kéo. Cột có trong `order` đứng đúng thứ tự đó; cột chưa có (mới thêm, hay vừa bật lại) chèn ngay sau
 * cột đứng trước nó trong thứ tự mặc định, không có thì lên đầu.
 */
export function orderVoucherColumns<T extends { key: string }>(columns: readonly T[], order: readonly string[]): T[] {
  if (!order.length) return [...columns];
  const rank = new Map(order.map((key, index) => [key, index]));
  const result = columns.filter((column) => rank.has(column.key)).sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
  columns.forEach((column, index) => {
    if (rank.has(column.key)) return;
    const before = columns
      .slice(0, index)
      .reverse()
      .find((candidate) => result.includes(candidate));
    result.splice(before ? result.indexOf(before) + 1 : 0, 0, column);
  });
  return result;
}

/** Thứ tự mới sau khi kéo cột `from` thả lên cột `to`: cột kéo đứng vào chỗ của cột được thả lên. */
export function moveVoucherColumn(keys: readonly string[], from: string, to: string): string[] {
  const fromIndex = keys.indexOf(from);
  const toIndex = keys.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || from === to) return [...keys];
  const next = keys.filter((key) => key !== from);
  next.splice(toIndex, 0, from);
  return next;
}

/** Cách hiện chữ trong ô: xuống dòng để không mất chữ (mặc định), hoặc gọn một dòng kèm chú thích đủ chữ khi rê chuột. */
export type VoucherCellMode = 'wrap' | 'compact';
const CELL_MODE_KEY = 'finance.voucher-list.cell-mode';

/** Đọc lựa chọn đã nhớ trên trình duyệt; không đọc được (chế độ riêng tư, chặn lưu trữ) thì dùng mặc định. */
export function loadVoucherCellMode(): VoucherCellMode {
  try {
    return globalThis.localStorage?.getItem(CELL_MODE_KEY) === 'compact' ? 'compact' : 'wrap';
  } catch {
    return 'wrap';
  }
}

export function saveVoucherCellMode(mode: VoucherCellMode): void {
  try {
    globalThis.localStorage?.setItem(CELL_MODE_KEY, mode);
  } catch {
    /* không lưu được thì chỉ áp cho lần xem này */
  }
}
