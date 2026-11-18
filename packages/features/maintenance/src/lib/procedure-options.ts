import type { MaintenanceProcedureCatalogEntry } from '@enterprise-platform/contracts-maintenance';

/**
 * Quy trình được phép CHỌN mới: chỉ bản đang công bố. Bản đã ngừng dùng vẫn nằm trong danh mục (để hiện tên cho lịch cũ)
 * nhưng chọn nó thì lịch sinh phiếu ra sẽ lỗi.
 */
export function selectableProcedures(
  catalog: readonly MaintenanceProcedureCatalogEntry[] | undefined,
): MaintenanceProcedureCatalogEntry[] {
  return (catalog ?? []).filter((entry) => entry.status === 'published');
}

/**
 * Như `selectableProcedures` nhưng giữ thêm các quy trình đã ngừng dùng mà hàng nào đó đang gắn (`inUseIds`), gắn nhãn
 * "không còn dùng" để người dùng thấy và đổi, thay vì ô chọn trống không rõ lý do.
 */
export function procedureOptionsKeepingInUse(
  catalog: readonly MaintenanceProcedureCatalogEntry[] | undefined,
  inUseIds: ReadonlySet<string>,
): { value: string; label: string }[] {
  return (catalog ?? [])
    .filter((entry) => entry.status === 'published' || inUseIds.has(entry.definitionId))
    .map((entry) => ({
      value: entry.definitionId,
      label: `${entry.code} — ${entry.name}${entry.status === 'published' ? '' : ' (không còn dùng)'}`,
    }));
}
