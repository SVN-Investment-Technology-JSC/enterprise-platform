/**
 * Hiển thị thời gian của đơn từ thống nhất: "dd/MM/yyyy HH:mm -> dd/MM/yyyy HH:mm (x giờ)".
 * Giờ hiển thị theo múi giờ mặc định của tenant (Việt Nam); đơn cũ chưa lưu giờ hiển thị ở mức ngày.
 */
export const REQUEST_TIMEZONE = 'Asia/Ho_Chi_Minh';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: REQUEST_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(iso: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const out: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(new Date(ms)))
    if (p.type !== 'literal') out[p.type] = p.value;
  return {
    date: `${out.day}/${out.month}/${out.year}`,
    time: `${out.hour === '24' ? '00' : out.hour}:${out.minute}`,
  };
}

/** dd/MM/yyyy HH:mm của một thời điểm ISO; chuỗi rỗng nếu không đọc được. */
export function formatDateTimeVn(iso: string | null | undefined): string {
  const p = iso ? parts(iso) : null;
  return p ? `${p.date} ${p.time}` : '';
}

/** dd/MM/yyyy của một ngày YYYY-MM-DD (hoặc chuỗi ISO); trả nguyên giá trị nếu không đúng định dạng. */
export function formatDateVn(value: string | null | undefined): string {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value ?? '');
}

/** Số giờ hiển thị gọn: 2 -> "2", 2.5 -> "2,5". */
export function formatHours(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return String(hours).replace('.', ',');
}

export interface RequestTimeFields {
  fromAt?: string | null;
  toAt?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  /** Đơn làm thêm giờ cũ: ngày + giờ bắt đầu/kết thúc. */
  workDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  requestDate?: string | null;
  durationMinutes?: number | null;
  plannedMinutes?: number | null;
}

/**
 * Chuỗi thời gian của một đơn:
 *  - có mốc giờ: "02/11/2026 09:00 -> 02/11/2026 11:30";
 *  - đơn làm thêm giờ cũ: "12/10/2026 (18:00 - 20:00)";
 *  - đơn cũ theo ngày: "12/10/2026 - 14/10/2026" (cả ngày) hoặc một ngày;
 *  - không có thời gian: chuỗi rỗng.
 */
export function formatRequestPeriod(r: RequestTimeFields): string {
  const from = formatDateTimeVn(r.fromAt);
  const to = formatDateTimeVn(r.toAt);
  if (from && to) return `${from} -> ${to}`;
  if (r.workDate && r.startTime && r.endTime)
    return `${formatDateVn(r.workDate)} (${r.startTime.slice(0, 5)} - ${r.endTime.slice(0, 5)})`;
  if (r.fromDate)
    return r.toDate && r.toDate !== r.fromDate
      ? `${formatDateVn(r.fromDate)} - ${formatDateVn(r.toDate)}`
      : formatDateVn(r.fromDate);
  return formatDateVn(r.workDate ?? r.requestDate ?? '');
}

/** Thời lượng gọn của đơn có giờ: "2,5 giờ"; rỗng nếu không biết. */
export function formatRequestDuration(r: RequestTimeFields): string {
  const minutes = r.durationMinutes ?? r.plannedMinutes;
  return typeof minutes === 'number' && minutes > 0 ? `${formatHours(minutes)} giờ` : '';
}
