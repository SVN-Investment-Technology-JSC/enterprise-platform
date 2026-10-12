export interface ShiftTimeLike {
  readonly startTime?: string | null;
  readonly endTime?: string | null;
  readonly breakMinutes?: number | null;
  readonly crossMidnight?: boolean | null;
}

function toMinutes(value?: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Công chuẩn (giờ) của một ca = (giờ kết thúc - giờ bắt đầu [+24h nếu qua đêm] - phút nghỉ) / 60,
 * làm tròn 2 chữ số, không âm. Trả về null nếu thiếu giờ bắt đầu/kết thúc.
 */
export function computeShiftStandardHours(shift: ShiftTimeLike): number | null {
  const start = toMinutes(shift.startTime);
  const end = toMinutes(shift.endTime);
  if (start === null || end === null) return null;
  let span = end - start;
  if (shift.crossMidnight || span < 0) span += 24 * 60;
  const net = Math.max(0, span - Math.max(0, shift.breakMinutes ?? 0));
  return Math.round((net / 60) * 100) / 100;
}

export function shiftStatusLabel(status?: string | null): string {
  return status === 'ACTIVE' ? 'Đang dùng' : status === 'INACTIVE' ? 'Tạm dừng' : (status ?? '');
}

/** Cộng phút vào giờ HH:mm (vòng 24 giờ); giờ không hợp lệ được trả nguyên. */
export function addMinutesToTime(time: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})/.exec(time || '');
  if (!m) return time;
  const total = (((Number(m[1]) * 60 + Number(m[2]) + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** HH:mm[:ss] -> HH:mm; rỗng nếu không có giờ. */
export function normalizeShiftTime(value?: string | null): string {
  const m = /^(\d{2}):(\d{2})/.exec(value ?? '');
  return m ? `${m[1]}:${m[2]}` : '';
}
