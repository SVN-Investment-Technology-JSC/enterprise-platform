/** Cấu hình chấm công tự động của tenant: bật/tắt và các thứ áp dụng (0 = Chủ nhật ... 6 = thứ Bảy). */
export interface AutoAttendanceSettings {
  enabled: boolean;
  weekdays: number[];
  /** Ngày bật gần nhất (YYYY-MM-DD); chỉ sinh cho ngày từ đây trở đi. */
  enabledFrom: string | null;
}

export const EMPTY_AUTO_ATTENDANCE: AutoAttendanceSettings = { enabled: false, weekdays: [], enabledFrom: null };

/** Kiểm tra thân yêu cầu lưu; trả cấu hình đã chuẩn hóa (thứ sắp tăng dần, không trùng) hoặc thông báo lỗi. */
export function parseAutoAttendanceInput(
  body: unknown,
): { value: { enabled: boolean; weekdays: number[] } } | { error: string } {
  const input = (body ?? {}) as { enabled?: unknown; weekdays?: unknown };
  if (typeof input.enabled !== 'boolean') return { error: 'Thiếu trạng thái bật/tắt chấm công tự động' };
  if (!Array.isArray(input.weekdays)) return { error: 'Danh sách thứ áp dụng không hợp lệ' };
  const days = new Set<number>();
  for (const value of input.weekdays) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 6)
      return { error: 'Thứ áp dụng phải từ 0 (Chủ nhật) đến 6 (thứ Bảy)' };
    days.add(value);
  }
  if (input.enabled && days.size === 0) return { error: 'Chọn ít nhất một thứ trong tuần để bật chấm công tự động' };
  return { value: { enabled: input.enabled, weekdays: [...days].sort((a, b) => a - b) } };
}

/** Thứ trong tuần của một ngày YYYY-MM-DD (0 = Chủ nhật). */
export function weekdayOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Ngày có được tự động chấm công theo cấu hình không (đã bật, đúng thứ, từ ngày bật trở đi). */
export function appliesOnDate(settings: AutoAttendanceSettings, date: string): boolean {
  if (!settings.enabled || settings.weekdays.length === 0) return false;
  if (settings.enabledFrom && date < settings.enabledFrom) return false;
  return settings.weekdays.includes(weekdayOfDate(date));
}
