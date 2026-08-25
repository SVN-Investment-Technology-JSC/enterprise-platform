import {
  MAINTENANCE_SETTINGS_KEYS,
  type MaintenanceFrequencyCatalog,
  type MaintenanceFrequencyOption,
  type MaintenanceSettings,
  type MaintenanceSettingsKey,
} from '@enterprise-platform/contracts-maintenance';

const INTERVAL_UNITS: readonly MaintenanceFrequencyOption['intervalUnit'][] = [
  'day',
  'week',
  'month',
  'year',
];

/**
 * Năm tần suất cố định trước đây, nay là dữ liệu mặc định.
 *
 * Giữ nguyên `code` của bản cũ để lịch bảo trì đang chạy không phải chuyển đổi:
 * cột `frequency` trong `maintenance_schema.schedules` vẫn lưu đúng các mã này.
 */
export const DEFAULT_FREQUENCY_CATALOG: MaintenanceFrequencyCatalog = {
  options: [
    { code: 'day', label: 'Ngày', intervalUnit: 'day', intervalCount: 1, sortOrder: 1, isActive: true },
    { code: 'week', label: 'Tuần', intervalUnit: 'week', intervalCount: 1, sortOrder: 2, isActive: true },
    { code: 'month', label: 'Tháng', intervalUnit: 'month', intervalCount: 1, sortOrder: 3, isActive: true },
    { code: 'quarter', label: 'Quý', intervalUnit: 'month', intervalCount: 3, sortOrder: 4, isActive: true },
    { code: 'year', label: 'Năm', intervalUnit: 'year', intervalCount: 1, sortOrder: 5, isActive: true },
  ],
};

export const MAINTENANCE_SETTINGS_DEFAULTS: MaintenanceSettings = {
  // Rỗng nghĩa là "dùng thẻ defaultEnabled của catalog", xem resolveDashboardCards.
  'dashboard.cards': { cardIds: [] },
  'catalog.frequency': DEFAULT_FREQUENCY_CATALOG,
};

export function isMaintenanceSettingsKey(value: string): value is MaintenanceSettingsKey {
  return (MAINTENANCE_SETTINGS_KEYS as readonly string[]).includes(value);
}

const MAX_DASHBOARD_CARDS = 12;
const MAX_FREQUENCIES = 40;

function normalizeStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed) seen.add(trimmed);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/**
 * Bỏ tần suất không hợp lệ thay vì sửa đại.
 *
 * `intervalCount` sai làm lịch sinh sai ngày mà không báo lỗi ở đâu cả, nên thà
 * mất một dòng cấu hình còn hơn giữ lại một dòng tính ra ngày vô nghĩa.
 */
function normalizeFrequencyCatalog(value: unknown): MaintenanceFrequencyCatalog {
  const raw = (value as { options?: unknown } | null)?.options;
  if (!Array.isArray(raw)) return DEFAULT_FREQUENCY_CATALOG;

  const seen = new Set<string>();
  const options: MaintenanceFrequencyOption[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Partial<MaintenanceFrequencyOption>;
    const code = typeof candidate.code === 'string' ? candidate.code.trim().toLowerCase() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const unit = candidate.intervalUnit;
    const count = Number(candidate.intervalCount);
    if (!code || !label || seen.has(code)) continue;
    if (!unit || !INTERVAL_UNITS.includes(unit)) continue;
    if (!Number.isInteger(count) || count < 1 || count > 120) continue;
    seen.add(code);
    options.push({
      code,
      label,
      intervalUnit: unit,
      intervalCount: count,
      sortOrder: Number.isInteger(candidate.sortOrder) ? Number(candidate.sortOrder) : options.length + 1,
      isActive: candidate.isActive !== false,
    });
    if (options.length >= MAX_FREQUENCIES) break;
  }

  // Không có dòng nào dùng được thì trả mặc định: một danh mục tần suất rỗng sẽ
  // khiến không tạo được lịch nào cả.
  if (options.length === 0) return DEFAULT_FREQUENCY_CATALOG;
  return { options: options.sort((left, right) => left.sortOrder - right.sortOrder) };
}

/**
 * Một hàm chuẩn hoá cho mỗi khoá, tra theo bảng.
 *
 * Cố ý không dùng `switch`: TypeScript không thu hẹp được tham số kiểu `K` bên
 * trong `switch` nên bản đó phải ép kiểu ở mọi nhánh, mà ép kiểu chính là thứ
 * để lọt một khoá khai báo sai hình dạng.
 */
const NORMALIZERS: {
  [K in MaintenanceSettingsKey]: (value: unknown) => MaintenanceSettings[K];
} = {
  'dashboard.cards': (value) => ({
    cardIds: normalizeStringList(
      (value as { cardIds?: unknown } | null)?.cardIds,
      MAX_DASHBOARD_CARDS,
    ),
  }),
  'catalog.frequency': normalizeFrequencyCatalog,
};

export function normalizeMaintenanceSetting<K extends MaintenanceSettingsKey>(
  key: K,
  value: unknown,
): MaintenanceSettings[K] {
  return NORMALIZERS[key](value);
}
