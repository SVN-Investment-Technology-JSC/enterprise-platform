import type { SocialUserRef } from '@enterprise-platform/contracts-social';

/** Token DI của danh bạ người dùng (tên, chức vụ, phòng) lấy từ HRM / Tenant Core. */
export const ORGANIZATION_DIRECTORY = Symbol('SOCIAL_ORGANIZATION_DIRECTORY');

export interface OrganizationDirectory {
  /**
   * Thông tin hiển thị của các người dùng. Id không có trong danh bạ thì không
   * có trong kết quả (người đã nghỉ, hoặc id sai); khoá là id viết thường.
   */
  resolve(tenantId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, SocialUserRef>>;

  /** Gợi ý người để nhắc tên; khớp không phân biệt dấu và hoa thường. */
  search(tenantId: string, query: string, limit: number): Promise<readonly SocialUserRef[]>;
}
