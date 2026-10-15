import {
  BYTES_PER_GB,
  STORAGE_DEFAULT_QUOTA_GB,
  STORAGE_RESOURCE_KEY,
  STORAGE_WARN_PERCENT,
  formatBytes,
  type StorageUsage,
  type TenantStorageLimit,
} from '@enterprise-platform/contracts-shared';
import { StorageQuotaExceededError } from '../domain/shared.error.js';
import type { PlatformLimitsReader } from './platform-limits.port.js';
import type { SharedStore } from './shared-store.port.js';

/**
 * Hạn mức dung lượng của tenant.
 *
 * Một hạn mức chung cho cả tenant: tài liệu công ty cộng với tài liệu, đính
 * kèm của mọi phân hệ khác trong cùng DB tenant. Con số hạn mức đến từ
 * Platform (gói + gói mua thêm); thiếu thì dùng mức mặc định và **không chặn**
 * (`soft`) — Platform trục trặc không được làm cả công ty không tải nổi tệp.
 */
export class StorageQuotaService {
  constructor(
    private readonly store: SharedStore,
    private readonly limits: PlatformLimitsReader,
  ) {}

  async usage(tenantId: string): Promise<StorageUsage> {
    const [limit, byModule] = await Promise.all([
      this.resolveLimit(tenantId),
      this.store.storage.usageByModule(tenantId),
    ]);
    const quotaBytes = Math.max(0, limit.limitValue) * BYTES_PER_GB;
    const usedBytes = byModule.reduce((sum, item) => sum + item.bytes, 0);
    return {
      quotaBytes,
      usedBytes,
      usedPercent: quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 1000) / 10 : 0,
      warnPercent: STORAGE_WARN_PERCENT,
      enforcement: limit.enforcement,
      source: limit.source,
      planKey: limit.planKey,
      addOnBytes: Math.max(0, limit.addOnValue) * BYTES_PER_GB,
      byModule: [...byModule].sort((left, right) => right.bytes - left.bytes),
    };
  }

  /**
   * Chặn trước khi ký URL tải lên.
   *
   * `additionalBytes` là con số client khai — URL ký sẵn không ghim độ dài nên
   * không kiểm chứng được; đây là hàng rào chống nhầm và chống vượt gói, không
   * phải hàng rào chống gian lận.
   */
  async ensureCapacity(tenantId: string, additionalBytes: number): Promise<void> {
    const usage = await this.usage(tenantId);
    if (usage.enforcement !== 'hard' || usage.quotaBytes <= 0) return;
    if (usage.usedBytes + Math.max(0, additionalBytes) <= usage.quotaBytes) return;
    throw new StorageQuotaExceededError(
      `Kho đã dùng ${formatBytes(usage.usedBytes)} / ${formatBytes(usage.quotaBytes)}. ` +
        `Tệp ${formatBytes(additionalBytes)} vượt hạn mức dung lượng của gói; ` +
        'hãy lưu trữ bớt tài liệu cũ hoặc liên hệ quản trị để mua thêm dung lượng.',
    );
  }

  private async resolveLimit(tenantId: string): Promise<TenantStorageLimit> {
    const limit = await this.limits.storageLimit(tenantId);
    if (limit && limit.resourceKey === STORAGE_RESOURCE_KEY && limit.limitValue > 0) return limit;
    return {
      resourceKey: STORAGE_RESOURCE_KEY,
      limitValue: STORAGE_DEFAULT_QUOTA_GB,
      enforcement: 'soft',
      source: 'default',
      addOnValue: 0,
    };
  }
}
