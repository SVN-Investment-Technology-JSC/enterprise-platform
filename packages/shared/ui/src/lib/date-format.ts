/**
 * Định dạng ngày giờ hiển thị thống nhất toàn hệ thống: dd/mm/yyyy (ngày/tháng/năm).
 * Giá trị dạng 'YYYY-MM-DD' được đổi bằng chuỗi (không qua Date) để không lệch múi giờ;
 * giá trị có giờ (ISO datetime, Date, timestamp) được đổi theo múi giờ của trình duyệt.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PLAIN_MONTH = /^(\d{4})-(\d{2})$/;

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026-10-09` hoặc ISO datetime -> `09/10/2026`. Giá trị không hợp lệ trả về `fallback`. */
export function formatDate(value: DateInput, fallback = ''): string {
  if (typeof value === 'string') {
    const plain = PLAIN_DATE.exec(value.trim());
    if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`;
  }
  const date = toDate(value);
  if (!date) return fallback;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** -> `09/10/2026 14:05` (24 giờ). */
export function formatDateTime(value: DateInput, fallback = ''): string {
  const date = toDate(value);
  if (!date) return fallback;
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** -> `14:05` (24 giờ). */
export function formatTime(value: DateInput, fallback = ''): string {
  const date = toDate(value);
  if (!date) return fallback;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `2026-10` -> `10/2026`. */
export function formatMonth(
  value: string | null | undefined,
  fallback = '',
): string {
  const match = PLAIN_MONTH.exec((value ?? '').trim());
  return match ? `${match[2]}/${match[1]}` : fallback;
}

/** `2026-10-01`, `2026-10-31` -> `01/10/2026 - 31/10/2026`; thiếu đầu mút thì thay bằng `openText`. */
export function formatDateRange(
  from: DateInput,
  to: DateInput,
  openText = 'Không giới hạn',
): string {
  return `${formatDate(from, openText)} - ${formatDate(to, openText)}`;
}
