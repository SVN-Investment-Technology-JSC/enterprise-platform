/** Hàm thuần dùng chung cho các màn hình bảng công / dữ liệu chấm công. */

const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] as const;
const TIMEZONE = 'Asia/Ho_Chi_Minh';

const pad = (n: number) => String(n).padStart(2, '0');

/** Ngày hôm nay (YYYY-MM-DD) theo giờ Việt Nam. */
export function todayVn(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
}

/** Tháng hiện tại YYYY-MM theo giờ Việt Nam. */
export function currentMonthVn(now: Date = new Date()): string {
  return todayVn(now).slice(0, 7);
}

export function isMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Từ ngày đầu đến ngày cuối của tháng YYYY-MM. */
export function monthRange(month: string): { from: string; to: string } {
  if (!isMonthKey(month)) throw new Error(`Tháng không hợp lệ: ${month}`);
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** Cộng/trừ số tháng cho khóa YYYY-MM. */
export function shiftMonth(month: string, delta: number): string {
  if (!isMonthKey(month)) throw new Error(`Tháng không hợp lệ: ${month}`);
  const [year, m] = month.split('-').map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** Số phút -> h:mm ("7:30"); null/NaN -> "—". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
    return '—';
  }
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/** YYYY-MM-DD -> dd/MM/yyyy (giá trị lạ được trả nguyên). */
export function formatDateVn(iso: string | null | undefined): string {
  if (!iso) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** YYYY-MM-DD -> T2..T7/CN. */
export function weekdayVn(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return '';
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return WEEKDAYS[date.getUTCDay()];
}

/** Thời điểm ISO -> HH:mm theo giờ Việt Nam; thiếu -> "—". */
export function formatTimeVn(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIMEZONE,
  }).format(date);
}

/** Số ngày bao gồm cả hai đầu. */
export function inclusiveDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000) + 1;
}

export type TimesheetTone = 'ok' | 'info' | 'warn' | 'bad' | 'muted';

const TIMESHEET_STATUS: Record<string, { label: string; tone: TimesheetTone }> = {
  NORMAL: { label: 'Đi làm', tone: 'ok' },
  LEAVE: { label: 'Nghỉ phép', tone: 'info' },
  HOLIDAY: { label: 'Nghỉ lễ', tone: 'warn' },
  ABSENT: { label: 'Vắng mặt', tone: 'bad' },
  ADJUSTED: { label: 'Đã điều chỉnh', tone: 'info' },
  OFF: { label: 'Ngày nghỉ', tone: 'muted' },
  BUSINESS_TRIP: { label: 'Công tác', tone: 'info' },
  ABNORMAL: { label: 'Bất thường', tone: 'bad' },
};

export function timesheetStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Chưa xác định';
  return TIMESHEET_STATUS[status]?.label ?? 'Khác';
}

export function timesheetStatusTone(
  status: string | null | undefined,
): TimesheetTone {
  return (status && TIMESHEET_STATUS[status]?.tone) || 'muted';
}

/** Bảng công của tôi: kỳ chốt thì số liệu là chính thức, còn lại chỉ tạm tính. */
export function timesheetPeriodBadge(
  periodStatus: string | null | undefined,
  periodCode: string | null | undefined,
): { label: string; locked: boolean; code: string } {
  const locked = periodStatus === 'LOCKED';
  return {
    label: locked ? 'Đã chốt' : 'Tạm tính',
    locked,
    code: periodCode ?? '',
  };
}
