import type { FinanceVoucherKind } from '@enterprise-platform/contracts-finance';
import type { FinanceKindConfig } from './finance-kinds';

/** Mã cột của danh sách phiếu; lưu theo từng người dùng nên không đổi tên mã đã dùng. */
export type VoucherColumnKey =
  | 'creator'
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
  | 'amount'
  | 'status';

export interface VoucherColumnDef {
  key: VoucherColumnKey;
  label: string;
  /** Tỷ trọng bề ngang: bề ngang thật là tỷ lệ trên tổng các cột đang hiện, nên bảng luôn vừa một bề ngang. */
  weight: number;
  /** Cột luôn hiện (mã phiếu là đường mở phiếu). */
  required?: boolean;
  /** Có trong bộ cột mặc định khi người dùng chưa chọn. */
  byDefault: boolean;
}

/** Các cột có của một loại phiếu, theo thứ tự hiển thị. */
export function voucherColumnCatalog(kind: FinanceVoucherKind, config: FinanceKindConfig): VoucherColumnDef[] {
  const transfer = kind === 'TRANSFER';
  const all: (VoucherColumnDef | false)[] = [
    { key: 'creator', label: 'Người tạo', weight: 6, byDefault: true },
    { key: 'code', label: config.codeLabel, weight: transfer ? 14 : 11, required: true, byDefault: true },
    { key: 'date', label: config.dateLabel, weight: 8, byDefault: true },
    { key: 'content', label: config.contentLabel, weight: transfer ? 23 : 15, byDefault: true },
    transfer && { key: 'accounts', label: 'Từ tài khoản → Đến tài khoản', weight: 32, byDefault: true },
    !transfer && { key: 'reason', label: config.reasonLabel, weight: 10, byDefault: true },
    !transfer && { key: 'account', label: 'Tài khoản', weight: 11, byDefault: true },
    !transfer && { key: 'counterparty', label: config.counterpartyLabel, weight: 8, byDefault: true },
    !transfer && { key: 'person', label: config.personLabel, weight: 10, byDefault: false },
    !transfer && { key: 'allocation', label: 'Hạch toán', weight: 11, byDefault: true },
    !transfer && { key: 'project', label: 'Dự án', weight: 12, byDefault: false },
    { key: 'amount', label: 'Số tiền', weight: transfer ? 14 : 11, byDefault: true },
    { key: 'status', label: 'Trạng thái', weight: 9, byDefault: true },
  ];
  return all.filter((column): column is VoucherColumnDef => Boolean(column));
}

/**
 * Cột đang hiện: theo lựa chọn đã lưu (giữ thứ tự của bảng, bỏ mã lạ, luôn có cột bắt buộc), chưa lưu thì bộ mặc định.
 */
export function visibleVoucherColumns(catalog: readonly VoucherColumnDef[], saved: readonly string[] | null): VoucherColumnDef[] {
  if (!saved) return catalog.filter((column) => column.byDefault);
  const chosen = new Set(saved);
  return catalog.filter((column) => column.required || chosen.has(column.key));
}

/** Bề ngang theo phần trăm của từng cột đang hiện, cộng lại đúng 100%. */
export function voucherColumnWidths(columns: readonly VoucherColumnDef[]): Record<string, string> {
  const total = columns.reduce((sum, column) => sum + column.weight, 0) || 1;
  return Object.fromEntries(columns.map((column) => [column.key, `${Math.round((column.weight / total) * 10_000) / 100}%`]));
}
