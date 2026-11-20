import { buildSupplierPolicy, type SupplierPolicy } from '../domain/supplier-catalog.js';
import { INVENTORY_SETTINGS_DEFAULTS, normalizeInventorySetting } from './inventory-settings.js';
import type { InventoryStore } from './inventory-store.port.js';

/**
 * Đọc quy tắc nhập nhà cung cấp của tenant: danh mục và cách nhập.
 *
 * Chỉ gọi khi thật sự có nhà cung cấp cần kiểm (xem `hasSupplier`): hai lần đọc cấu hình mỗi lần ghi là
 * thừa với phần lớn chứng từ không khai nhà cung cấp.
 */
export async function loadSupplierPolicy(
  settings: InventoryStore['settings'],
  tenantId: string,
): Promise<SupplierPolicy> {
  const [catalogEntry, inputEntry] = await Promise.all([
    settings.get(tenantId, 'catalog.supplier'),
    settings.get(tenantId, 'supplier.input'),
  ]);
  const catalog = catalogEntry
    ? normalizeInventorySetting('catalog.supplier', catalogEntry.value)
    : INVENTORY_SETTINGS_DEFAULTS['catalog.supplier'];
  const input = inputEntry
    ? normalizeInventorySetting('supplier.input', inputEntry.value)
    : INVENTORY_SETTINGS_DEFAULTS['supplier.input'];
  return buildSupplierPolicy(catalog.suppliers, input.mode);
}

/** Có chữ nào đáng kiểm không: trống thì khỏi đọc cấu hình. */
export function hasSupplier(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

/** Đọc một lần, dùng lại cho nhiều dòng (nhập hàng loạt). */
export function memoizedSupplierPolicy(
  settings: InventoryStore['settings'],
  tenantId: string,
): () => Promise<SupplierPolicy> {
  let pending: Promise<SupplierPolicy> | undefined;
  return () => (pending ??= loadSupplierPolicy(settings, tenantId));
}
