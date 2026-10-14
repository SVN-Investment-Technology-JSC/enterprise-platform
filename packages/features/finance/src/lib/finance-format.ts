import type { FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import { FINANCE_VOUCHER_STATUS_LABELS, FINANCE_VOUCHER_KIND_LABELS, formatFinanceMoney } from '@enterprise-platform/contracts-finance';

export const money = (value: number | null | undefined): string => (value === null || value === undefined ? '-' : formatFinanceMoney(value));

/** 2026-10-14 → 14/10/2026. */
export function dateVn(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** ISO thời điểm → "14/10/2026 09:30" theo giờ Việt Nam. */
export function dateTimeVn(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const local = new Date(date.getTime() + 7 * 3_600_000).toISOString();
  return `${dateVn(local.slice(0, 10))} ${local.slice(11, 16)}`;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 1) : parts[parts.length - 1].slice(0, 1)).toUpperCase();
}

/** Hôm nay theo giờ Việt Nam, YYYY-MM-DD. */
export function todayVn(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

export interface PeriodPreset {
  id: string;
  label: string;
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Khoảng thời gian chọn nhanh cho báo cáo, tính từ `today` (YYYY-MM-DD). */
export function periodPresets(today: string): PeriodPreset[] {
  const [y, m] = today.split('-').map(Number);
  const monthStart = `${y}-${pad(m)}-01`;
  const prevMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const quarterStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const thirty = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return [
    { id: 'month', label: 'Tháng này', from: monthStart, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` },
    { id: 'prev-month', label: 'Tháng trước', from: `${prevMonth.y}-${pad(prevMonth.m)}-01`, to: `${prevMonth.y}-${pad(prevMonth.m)}-${pad(lastDay(prevMonth.y, prevMonth.m))}` },
    { id: 'quarter', label: 'Quý này', from: `${y}-${pad(quarterStartMonth)}-01`, to: `${y}-${pad(quarterStartMonth + 2)}-${pad(lastDay(y, quarterStartMonth + 2))}` },
    { id: 'year', label: 'Năm nay', from: `${y}-01-01`, to: `${y}-12-31` },
    { id: '30d', label: '30 ngày gần nhất', from: thirty, to: today },
  ];
}

/** Nhãn kỳ biểu đồ: 2026-10 → "T10/2026"; 2026-10-14 → "14/10". */
export function periodLabel(period: string): string {
  if (/^\d{4}-\d{2}$/.test(period)) return `T${Number(period.slice(5))}/${period.slice(0, 4)}`;
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(period);
  return match ? `${match[2]}/${match[1]}` : period;
}

/** Dòng CSV của danh sách phiếu (xuất Excel đúng các dòng đang lọc). */
export function voucherCsvRows(items: readonly FinanceVoucherSummary[]): (string | number)[][] {
  return [
    ['Mã phiếu', 'Loại', 'Ngày', 'Ngày hạch toán', 'Nội dung', 'Lý do', 'Tài khoản', 'Tài khoản đích', 'Đối tượng', 'Người nộp/nhận', 'Số tiền', 'Trạng thái', 'Người tạo'],
    ...items.map((item) => [
      item.code,
      FINANCE_VOUCHER_KIND_LABELS[item.kind],
      dateVn(item.voucherDate),
      dateVn(item.postingDate),
      item.content,
      item.reasonName ?? '',
      item.accountName ?? '',
      item.destAccountName ?? '',
      item.counterpartyGroupName ?? '',
      item.counterpartyName ?? '',
      item.totalAmount,
      FINANCE_VOUCHER_STATUS_LABELS[item.status],
      item.createdByName ?? '',
    ]),
  ];
}

/** Số nguyên từ chuỗi người dùng gõ ("1.500.000" → 1500000); rỗng → 0. */
export function parseMoneyInput(text: string): number {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return 0;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : 0;
}
