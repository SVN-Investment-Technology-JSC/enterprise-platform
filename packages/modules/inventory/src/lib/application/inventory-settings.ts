import {
  INVENTORY_SETTINGS_KEYS,
  type InventoryCatalogSettings,
  type InventorySettings,
  type InventorySettingsKey,
} from '@enterprise-platform/contracts-inventory';

/**
 * Mặc định BẬT giá và bảo hành.
 *
 * Hai trường này được thêm theo yêu cầu 21/8, nên mặc định phải nhìn thấy —
 * tenant nào không dùng thì tự tắt. Để mặc định tắt thì người dùng nhập giá vào
 * rồi không thấy nó đâu, và tưởng hệ thống mất dữ liệu.
 *
 * `enabledStatuses` rỗng nghĩa là "dùng hết mọi trạng thái", không phải "không
 * trạng thái nào" — xem `statusOn` ở AssetCatalogEditor.
 */
const DEFAULT_CATALOG: InventoryCatalogSettings = {
  enabledAttributes: [],
  enabledStatuses: [],
  priceFieldsEnabled: true,
  warrantyFieldsEnabled: true,
};

/**
 * Giá trị dùng khi bảng chưa có dòng cho khoá đó.
 *
 * Nhờ có mặc định trong code, tenant mới không cần dữ liệu seed, và đổi mặc
 * định ở bản sau cũng không cần migration dữ liệu.
 */
export const INVENTORY_SETTINGS_DEFAULTS: InventorySettings = {
  // Rỗng nghĩa là "dùng thẻ defaultEnabled của catalog", xem resolveDashboardCards.
  'dashboard.cards': { cardIds: [] },
  'catalog.material': DEFAULT_CATALOG,
  'catalog.asset': DEFAULT_CATALOG,
};

export function isInventorySettingsKey(value: string): value is InventorySettingsKey {
  return (INVENTORY_SETTINGS_KEYS as readonly string[]).includes(value);
}

/** Trần số thẻ dashboard, chặn một payload hỏng làm phình màn hình. */
const MAX_DASHBOARD_CARDS = 12;

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

function normalizeCatalog(value: unknown): InventoryCatalogSettings {
  const raw = (value ?? {}) as Partial<InventoryCatalogSettings>;
  return {
    enabledAttributes: normalizeStringList(raw.enabledAttributes, 64),
    enabledStatuses: normalizeStringList(raw.enabledStatuses, 64),
    // Thiếu trường trong payload thì giữ mặc định BẬT, không rơi về tắt: một
    // client cũ gửi thiếu trường sẽ vô tình ẩn mất cột của cả tenant.
    priceFieldsEnabled: raw.priceFieldsEnabled !== false,
    warrantyFieldsEnabled: raw.warrantyFieldsEnabled !== false,
  };
}

/**
 * Một hàm chuẩn hoá cho mỗi khoá.
 *
 * Cố ý dùng bảng thay vì `switch`: TypeScript không thu hẹp được tham số kiểu
 * `K` bên trong `switch`, nên bản `switch` phải ép kiểu ở mọi nhánh — mà ép kiểu
 * chính là thứ khiến một khoá khai báo sai hình dạng lọt qua biên dịch. Tra bảng
 * theo `K` thì trình biên dịch tự khớp đúng kiểu trả về.
 */
const NORMALIZERS: {
  [K in InventorySettingsKey]: (value: unknown) => InventorySettings[K];
} = {
  'dashboard.cards': (value) => ({
    cardIds: normalizeStringList(
      (value as { cardIds?: unknown } | null)?.cardIds,
      MAX_DASHBOARD_CARDS,
    ),
  }),
  'catalog.material': normalizeCatalog,
  'catalog.asset': normalizeCatalog,
};

/**
 * Ép giá trị thô về đúng hình dạng của khoá.
 *
 * Dùng cho cả lúc đọc lẫn lúc ghi, cố ý: một dòng dữ liệu hỏng phải rơi về mặc
 * định chứ không được làm chết cả màn dashboard, và một payload lạ gửi lên
 * không được lưu nguyên trạng vào database.
 */
export function normalizeInventorySetting<K extends InventorySettingsKey>(
  key: K,
  value: unknown,
): InventorySettings[K] {
  return NORMALIZERS[key](value);
}
