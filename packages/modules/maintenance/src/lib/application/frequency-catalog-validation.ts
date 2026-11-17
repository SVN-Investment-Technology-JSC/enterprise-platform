import type { MaintenanceFrequencyOption } from '@enterprise-platform/contracts-maintenance';

const INTERVAL_UNITS: readonly MaintenanceFrequencyOption['intervalUnit'][] = ['day', 'week', 'month', 'year'];
const MAX_INTERVAL_COUNT = 120;

/**
 * Kiểm danh mục tần suất người dùng gửi lên, trả danh sách lời báo (rỗng là hợp lệ).
 *
 * Khác `normalizeFrequencyCatalog` (đọc, bỏ dòng hỏng để màn hình không chết): khi GHI phải từ chối chứ không lặng lẽ
 * bỏ dòng, vì một dòng bị bỏ làm cột tần suất biến mất khỏi ma trận cùng các ô đã tick.
 */
export function validateFrequencyCatalog(value: unknown): string[] {
  const options = (value as { options?: unknown } | null)?.options;
  if (!Array.isArray(options) || options.length === 0) return ['Danh mục tần suất phải có ít nhất một dòng.'];

  const errors: string[] = [];
  const seen = new Set<string>();
  options.forEach((entry, index) => {
    const row = `Dòng ${index + 1}`;
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${row}: không hợp lệ.`);
      return;
    }
    const candidate = entry as Partial<MaintenanceFrequencyOption>;
    const code = typeof candidate.code === 'string' ? candidate.code.trim().toLowerCase() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const name = label ? `"${label}"` : row;
    if (!code) errors.push(`${row}: thiếu mã tần suất.`);
    else if (seen.has(code)) errors.push(`${name}: mã "${code}" bị trùng.`);
    seen.add(code);
    if (!label) errors.push(`${row}: tên tần suất không được để trống.`);
    if (!candidate.intervalUnit || !INTERVAL_UNITS.includes(candidate.intervalUnit)) {
      errors.push(`${name}: đơn vị kỳ không hợp lệ.`);
    }
    const count = Number(candidate.intervalCount);
    if (!Number.isInteger(count) || count < 1 || count > MAX_INTERVAL_COUNT) {
      errors.push(`${name}: số kỳ phải là số nguyên từ 1 đến ${MAX_INTERVAL_COUNT}.`);
    }
  });
  return errors;
}
