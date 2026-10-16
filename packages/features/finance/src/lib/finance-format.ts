import type { FinanceVoucherSummary } from '@enterprise-platform/contracts-finance';
import { FINANCE_VOUCHER_STATUS_LABELS, FINANCE_VOUCHER_KIND_LABELS, formatFinanceMoney } from '@enterprise-platform/contracts-finance';

export const money = (value: number | null | undefined): string => (value === null || value === undefined ? '-' : formatFinanceMoney(value));

/** Mã chống gửi trùng cho một lần bấm duyệt/từ chối qua quy trình (nếu mạng lỗi và bấm lại, Procedure chỉ nhận một lần). */
export const newFinanceIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

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
    ['Mã phiếu', 'Loại', 'Ngày', 'Ngày hạch toán', 'Nội dung', 'Lý do', 'Tài khoản', 'Tài khoản đích', 'Đối tượng', 'Số tiền', 'Trạng thái', 'Người tạo'],
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
      item.totalAmount,
      FINANCE_VOUCHER_STATUS_LABELS[item.status],
      item.createdByName ?? '',
    ]),
  ];
}

/** Khoảng ngày của một tháng `YYYY-MM`: từ ngày 1 đến ngày cuối tháng (kể cả tháng 2 năm nhuận). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

/** Tháng liền trước/sau (delta âm hoặc dương), qua ranh giới năm. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** "Tháng 10/2026". */
export const monthLabel = (month: string): string => `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;

export const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** Số nguyên từ chuỗi người dùng gõ ("1.500.000" → 1500000); rỗng → 0. */
export function parseMoneyInput(text: string): number {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return 0;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : 0;
}

/** Số chữ số tối đa của ô nhập tiền (khớp `FINANCE_MAX_AMOUNT` = 999.999.999.999.999). */
export const MONEY_INPUT_MAX_DIGITS = 15;

/** "1500000" → "1.500.000" (chỉ chuỗi chữ số, không qua Intl nên dấu phân cách luôn là dấu chấm). */
export function groupDigits(digits: string): string {
  let out = '';
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += '.';
    out += digits[index];
  }
  return out;
}

export interface MoneyInputUpdate {
  /** Giá trị số sau khi gõ (0 khi ô trống). */
  value: number;
  /** Chuỗi hiển thị, đã có dấu phân cách hàng nghìn. */
  display: string;
  /** Vị trí con trỏ trong `display`: giữ nguyên số chữ số đứng trước con trỏ lúc gõ, để sửa giữa chuỗi không nhảy con trỏ về cuối. */
  caret: number;
  /** Mới gõ dấu trừ: giá trị vẫn 0 nhưng ô phải hiện "-". */
  pendingMinus: boolean;
}

/**
 * Định dạng ô nhập tiền NGAY khi gõ hoặc dán. Chỉ giữ chữ số (và dấu trừ ở đầu khi `allowNegative`); dán "1.500.000,50 đ"
 * thì bỏ phần thập phân sau dấu phẩy vì ô chỉ nhập số nguyên đồng. Trả null khi vượt số chữ số cho phép: nơi gọi giữ nguyên
 * giá trị cũ thay vì cắt hay đổi về 0 (đổi về 0 làm mất cả số đã nhập khi lỡ dán một chuỗi quá dài).
 */
export function reformatMoneyInput(raw: string, caret: number, allowNegative = false): MoneyInputUpdate | null {
  const negative = allowNegative && raw.trimStart().startsWith('-');
  const fraction = /,\d{1,2}(?:\s*(?:đ|₫|vnd))?\s*$/i.exec(raw);
  const body = fraction ? raw.slice(0, fraction.index) : raw;
  const digitsOnly = body.replace(/[^\d]/g, '');
  const digits = digitsOnly.replace(/^0+/, '');
  if (digits.length > MONEY_INPUT_MAX_DIGITS) return null;

  const removedZeros = digitsOnly.length - digits.length;
  const before = Math.max(0, Math.min(raw.slice(0, Math.max(0, caret)).replace(/[^\d]/g, '').length - removedZeros, digits.length));
  const sign = negative && digits ? '-' : '';
  const display = digits ? sign + groupDigits(digits) : negative ? '-' : '';

  let position = sign.length;
  if (digits && before > 0) {
    let seen = 0;
    for (let index = sign.length; index < display.length; index += 1) {
      if (display[index] !== '.') seen += 1;
      if (seen === before) {
        position = index + 1;
        break;
      }
    }
  }
  if (!digits) position = display.length;

  const magnitude = digits ? Number(digits) : 0;
  return { value: negative && magnitude ? -magnitude : magnitude, display, caret: position, pendingMinus: negative && !digits };
}
