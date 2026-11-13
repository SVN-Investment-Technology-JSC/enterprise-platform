import type { MaintenanceFrequencyCatalog } from '@enterprise-platform/contracts-maintenance';

/**
 * Kiểm danh mục tần suất trước khi lưu, để báo lỗi ngay thay vì chờ máy chủ từ chối. Cùng luật với máy chủ: tên không
 * trống, số kỳ nguyên từ 1 đến 120.
 */
export function validateFrequencyDraft(catalog: MaintenanceFrequencyCatalog): string[] {
  const errors: string[] = [];
  catalog.options.forEach((option, index) => {
    const name = option.label.trim() ? `"${option.label.trim()}"` : `Dòng ${index + 1}`;
    if (!option.label.trim()) errors.push(`${name}: tên tần suất không được để trống.`);
    const count = Number(option.intervalCount);
    if (!Number.isInteger(count) || count < 1 || count > 120) {
      errors.push(`${name}: số kỳ phải là số nguyên từ 1 đến 120.`);
    }
  });
  return errors;
}
