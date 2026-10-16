/** Khóa của phân hệ Trợ lý trong danh mục phân hệ. */
export const ASSISTANT_MODULE_KEY = 'assistant';

/**
 * Phân hệ chỉ mở bằng nút trên khung chung, không phải trang để chuyển sang.
 *
 * Trợ lý là ngăn chat mở từ nút cạnh chuông Thông báo, nên "Ứng dụng đang dùng", ô chuyển phân hệ, tìm nhanh,
 * số ứng dụng và ma trận phân quyền đều bỏ qua nó. File này không có 'use client' để trang máy chủ cũng lọc được.
 */
export const LAUNCHER_ONLY_MODULES: readonly string[] = [ASSISTANT_MODULE_KEY];

export function isLauncherOnlyModule(key: string): boolean {
  return LAUNCHER_ONLY_MODULES.includes(key);
}
