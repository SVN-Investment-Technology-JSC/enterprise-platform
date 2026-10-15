import type { TenantStorageLimit } from '@enterprise-platform/contracts-shared';

export const PLATFORM_LIMITS_READER = Symbol('PLATFORM_LIMITS_READER');

/**
 * Đọc hạn mức của tenant từ Platform.
 *
 * Trả `undefined` khi Platform không trả lời được: hạn mức là việc của nhà
 * cung cấp, phân hệ không tự đặt ra con số nào ngoài mức mặc định.
 */
export interface PlatformLimitsReader {
  storageLimit(tenantId: string): Promise<TenantStorageLimit | undefined>;
}
