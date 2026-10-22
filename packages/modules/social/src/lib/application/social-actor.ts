import type { SocialPrincipal } from '../domain/social-principal.js';

/**
 * Danh tính người gọi, do guard của `apps/social-api` gắn vào request dưới tên
 * `socialActor` sau khi access-decision của Platform trả về. Tầng application
 * không tự đọc JWT.
 *
 * Các cờ tính bằng `tenantActionHeld` từ quyền `social.*` của người dùng.
 */
export interface SocialActor extends SocialPrincipal {
  readonly tenantId: string;
  readonly displayName: string;
}
