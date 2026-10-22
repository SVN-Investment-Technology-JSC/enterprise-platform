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

/** Cấu hình chấm công tự động của một nhân viên: `weekdays` rỗng/null là mọi ngày có ca; `toDate` null là chưa kết thúc. */
export interface AutoAttendanceEmployeeRule {
  employeeId: string;
  weekdays: number[] | null;
  fromDate: string;
  toDate: string | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: unknown): value is string =>
  typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** Kiểm tra thân yêu cầu thêm/sửa cấu hình theo nhân viên; trả giá trị đã chuẩn hóa hoặc thông báo lỗi. */
export function parseAutoAttendanceEmployeeInput(
  body: unknown,
  today: string,
):
  | { value: { employeeId: string; weekdays: number[] | null; fromDate: string; toDate: string | null; reason: string } }
  | { error: string } {
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input.employeeId !== 'string' || !input.employeeId) return { error: 'Chưa chọn nhân viên' };
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) return { error: 'Cần nhập lý do chấm công tự động' };
  if (reason.length > 500) return { error: 'Lý do tối đa 500 ký tự' };
  const fromDate = input.fromDate === undefined || input.fromDate === null ? today : input.fromDate;
  if (!validDate(fromDate)) return { error: 'Ngày bắt đầu không hợp lệ' };
  const toDate = input.toDate === undefined || input.toDate === null || input.toDate === '' ? null : input.toDate;
  if (toDate !== null && !validDate(toDate)) return { error: 'Ngày kết thúc không hợp lệ' };
  if (toDate !== null && toDate < fromDate) return { error: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu' };
  let weekdays: number[] | null = null;
  if (input.weekdays !== undefined && input.weekdays !== null) {
    if (!Array.isArray(input.weekdays)) return { error: 'Danh sách thứ áp dụng không hợp lệ' };
    const days = new Set<number>();
    for (const value of input.weekdays) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 6)
        return { error: 'Thứ áp dụng phải từ 0 (Chủ nhật) đến 6 (thứ Bảy)' };
      days.add(value);
    }
    weekdays = days.size ? [...days].sort((a, b) => a - b) : null;
  }
  return { value: { employeeId: input.employeeId, weekdays, fromDate, toDate, reason } };
}

/** Ngày có được tự động chấm công theo cấu hình riêng của nhân viên không (trong khoảng hiệu lực và đúng thứ). */
export function appliesToEmployeeOnDate(rule: AutoAttendanceEmployeeRule, date: string): boolean {
  if (date < rule.fromDate) return false;
  if (rule.toDate && date > rule.toDate) return false;
  return !rule.weekdays?.length || rule.weekdays.includes(weekdayOfDate(date));
}

/** Ngày có được tự động chấm công theo cấu hình không (đã bật, đúng thứ, từ ngày bật trở đi). */
export function appliesOnDate(settings: AutoAttendanceSettings, date: string): boolean {
  if (!settings.enabled || settings.weekdays.length === 0) return false;
  if (settings.enabledFrom && date < settings.enabledFrom) return false;
  return settings.weekdays.includes(weekdayOfDate(date));
}
