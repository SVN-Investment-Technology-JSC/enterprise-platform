import type { Route } from 'next';

export const LIBRARY_PATH = '/platform/brand-studio';
export const STANDARDS_PATH = '/platform/brand-studio/standards';
/** `iconId` của route trình thiết kế khi vẽ icon mới (chưa nằm trong thư viện). */
export const NEW_ICON_ID = 'new';

export function editorPath(iconId: string): string {
  return `${LIBRARY_PATH}/editor/${encodeURIComponent(iconId)}`;
}

/**
 * Đường dẫn Brand Studio là chuỗi dựng động nên không khớp kiểu route sinh tự động của Next (typedRoutes);
 * ép về `Route` ở một chỗ duy nhất để các màn hình dùng chung.
 */
export function asRoute(path: string): Route {
  return path as Route;
}
