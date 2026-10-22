/** Kỳ báo cáo chọn nhanh. `custom` là tự chọn từ ngày – đến ngày. */
export type ReportPeriodPreset = 'week' | 'month' | 'quarter' | 'year' | 'custom';

export const REPORT_PERIOD_LABELS: Record<ReportPeriodPreset, string> = {
  week: 'Tuần này',
  month: 'Tháng này',
  quarter: 'Quý này',
  year: 'Năm nay',
  custom: 'Tuỳ chọn',
};

const pad = (value: number) => String(value).padStart(2, '0');
const key = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * Ngày đầu và ngày cuối (`YYYY-MM-DD`, theo giờ máy người dùng) của kỳ chứa `today`. Tuần bắt đầu thứ Hai như trang
 * "Công việc của tôi".
 */
export function presetRange(
  preset: Exclude<ReportPeriodPreset, 'custom'>,
  today: Date = new Date(),
): { from: string; to: string } {
  const year = today.getFullYear();
  const month = today.getMonth();
  if (preset === 'week') {
    const fromMonday = (today.getDay() + 6) % 7;
    const monday = new Date(year, month, today.getDate() - fromMonday);
    return { from: key(monday), to: key(new Date(year, month, monday.getDate() + 6)) };
  }
  if (preset === 'month') {
    return { from: key(new Date(year, month, 1)), to: key(new Date(year, month + 1, 0)) };
  }
  if (preset === 'quarter') {
    const first = month - (month % 3);
    return { from: key(new Date(year, first, 1)), to: key(new Date(year, first + 3, 0)) };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Tỉ lệ phần trăm làm tròn; mẫu bằng 0 thì không có tỉ lệ. */
export function percent(part: number, whole: number): number | undefined {
  return whole > 0 ? Math.round((part / whole) * 100) : undefined;
}

/** Ngày địa phương (`YYYY-MM-DD`) của một mốc ISO; mốc đầu kỳ 00:00 giờ Việt Nam là 17:00 UTC ngày hôm trước. */
export function localDay(iso: string): string {
  return key(new Date(iso));
}
