import {
  PROCEDURE_SETTINGS_KEYS,
  type ProcedureGroupCatalog,
  type ProcedureGroupOption,
  type ProcedureSettings,
  type ProcedureSettingsKey,
} from '@enterprise-platform/contracts-procedure-engine';

/**
 * Năm nhóm mặc định theo yêu cầu 21/8.
 *
 * Chỉ là dữ liệu mặc định, không phải enum: admin bật/tắt và thêm/xoá được, nên
 * đừng để chỗ nào trong code so sánh cứng với các mã này.
 */
export const DEFAULT_GROUP_CATALOG: ProcedureGroupCatalog = {
  options: [
    { code: 'governance', label: 'Quản trị', sortOrder: 1, isActive: true },
    { code: 'admin_hr', label: 'Hành chính - Nhân sự', sortOrder: 2, isActive: true },
    { code: 'finance', label: 'Tài chính', sortOrder: 3, isActive: true },
    { code: 'sales_marketing', label: 'Kinh doanh', sortOrder: 4, isActive: true },
    { code: 'technical', label: 'Kỹ thuật', sortOrder: 5, isActive: true },
  ],
  autoAssignEnabled: true,
};

export const PROCEDURE_SETTINGS_DEFAULTS: ProcedureSettings = {
  // Rỗng nghĩa là "dùng thẻ defaultEnabled của catalog", xem resolveDashboardCards.
  'dashboard.cards': { cardIds: [] },
  'catalog.group': DEFAULT_GROUP_CATALOG,
};

export function isProcedureSettingsKey(value: string): value is ProcedureSettingsKey {
  return (PROCEDURE_SETTINGS_KEYS as readonly string[]).includes(value);
}

const MAX_DASHBOARD_CARDS = 12;
const MAX_GROUPS = 40;

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

function normalizeGroupCatalog(value: unknown): ProcedureGroupCatalog {
  const raw = value as Partial<ProcedureGroupCatalog> | null;
  const autoAssignEnabled = raw?.autoAssignEnabled !== false;
  if (!Array.isArray(raw?.options)) {
    return { ...DEFAULT_GROUP_CATALOG, autoAssignEnabled };
  }

  const seen = new Set<string>();
  const options: ProcedureGroupOption[] = [];
  for (const entry of raw.options) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Partial<ProcedureGroupOption>;
    const code = typeof candidate.code === 'string' ? candidate.code.trim().toLowerCase() : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    if (!code || !label || seen.has(code)) continue;
    seen.add(code);
    options.push({
      code,
      label,
      sortOrder: Number.isInteger(candidate.sortOrder)
        ? Number(candidate.sortOrder)
        : options.length + 1,
      isActive: candidate.isActive !== false,
    });
    if (options.length >= MAX_GROUPS) break;
  }

  // Danh mục rỗng sẽ khiến không quy trình nào công bố được, vì bản nháp bắt
  // buộc phải có nhóm. Rơi về mặc định thay vì tự khoá cả module.
  if (options.length === 0) return { ...DEFAULT_GROUP_CATALOG, autoAssignEnabled };
  return {
    options: options.sort((left, right) => left.sortOrder - right.sortOrder),
    autoAssignEnabled,
  };
}

/**
 * Một hàm chuẩn hoá cho mỗi khoá, tra theo bảng.
 *
 * Cố ý không dùng `switch`: TypeScript không thu hẹp được tham số kiểu `K` bên
 * trong `switch` nên bản đó phải ép kiểu ở mọi nhánh, mà ép kiểu chính là thứ
 * để lọt một khoá khai báo sai hình dạng.
 */
const NORMALIZERS: {
  [K in ProcedureSettingsKey]: (value: unknown) => ProcedureSettings[K];
} = {
  'dashboard.cards': (value) => ({
    cardIds: normalizeStringList(
      (value as { cardIds?: unknown } | null)?.cardIds,
      MAX_DASHBOARD_CARDS,
    ),
  }),
  'catalog.group': normalizeGroupCatalog,
};

export function normalizeProcedureSetting<K extends ProcedureSettingsKey>(
  key: K,
  value: unknown,
): ProcedureSettings[K] {
  return NORMALIZERS[key](value);
}
