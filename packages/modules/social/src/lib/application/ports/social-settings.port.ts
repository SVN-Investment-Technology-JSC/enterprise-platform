import type { SocialSettings, UpdateSocialSettingsRequest } from '@enterprise-platform/contracts-social';

/**
 * Cài đặt phân hệ (bảng `social_schema.settings`, key/value JSON). BE-1 hiện thực và sở hữu route
 * `GET/PATCH /v1/settings`; BE-2 và BE-3 chỉ đọc qua cổng này. Thiếu dòng thì dùng
 * `SOCIAL_DEFAULT_SETTINGS`.
 */
export const SOCIAL_SETTINGS = Symbol('SOCIAL_SETTINGS');

export interface SocialSettingsPort {
  get(tenantId: string): Promise<SocialSettings>;

  /** Ghi các khoá có mặt; trả cài đặt sau khi ghi. Người gọi đã kiểm `social.manage`. */
  update(tenantId: string, patch: UpdateSocialSettingsRequest, userId: string): Promise<SocialSettings>;
}
