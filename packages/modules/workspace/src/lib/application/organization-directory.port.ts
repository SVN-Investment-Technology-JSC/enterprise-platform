import type { DirectoryResponse } from '@enterprise-platform/contracts-workspace';

/**
 * Token DI của danh bạ tổ chức.
 *
 * Symbol chứ không phải chuỗi: đây là cổng HTTP sang một thành phần khác của
 * nền tảng, cùng quy ước với `EXTERNAL_REFERENCE_READER`.
 */
export const ORGANIZATION_DIRECTORY = Symbol('ORGANIZATION_DIRECTORY');

/**
 * Người trong tổ chức của một tenant.
 *
 * Cài đặt thật đọc organization context của Tenant Core. Mọi lỗi mạng hay
 * payload lạ phải được nuốt và trả `degraded: true` — danh bạ chậm không
 * được làm hỏng việc tạo sự kiện hay xem dự án.
 */
export interface OrganizationDirectory {
  list(tenantId: string): Promise<DirectoryResponse>;
}
