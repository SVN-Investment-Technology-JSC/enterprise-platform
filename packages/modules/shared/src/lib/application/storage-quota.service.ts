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
export const CAPACITY_CACHE_TTL_MS = 30_000;
export const CAPACITY_CACHE_MAX_TENANTS = 2_000;

interface CapacityEntry {
  usedBytes: number;
  quotaBytes: number;
  enforcement: TenantStorageLimit['enforcement'];
  expiresAt: number;
  /** Số byte đã cho phép trong cửa sổ cache; về 0 khi đọc lại dung lượng thật. */
  reservedBytes: number;
}

export class StorageQuotaService {
  private readonly capacityCache = new Map<string, CapacityEntry>();
  private readonly capacityLoads = new Map<string, Promise<CapacityEntry>>();

  constructor(
    private readonly store: SharedStore,
    private readonly limits: PlatformLimitsReader,
    private readonly now: () => number = Date.now,
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
    const entry = await this.capacityEntry(tenantId);
    if (entry.enforcement !== 'hard' || entry.quotaBytes <= 0) return;
    const additional = Math.max(0, additionalBytes);
    const committed = entry.usedBytes + entry.reservedBytes;
    if (committed + additional > entry.quotaBytes) {
      throw new StorageQuotaExceededError(
        `Kho đã dùng ${formatBytes(committed)} / ${formatBytes(entry.quotaBytes)}. ` +
          `Tệp ${formatBytes(additionalBytes)} vượt hạn mức dung lượng của gói; ` +
          'hãy lưu trữ bớt tài liệu cũ hoặc liên hệ quản trị để mua thêm dung lượng.',
      );
    }
    // Đặt trước ngay (đồng bộ, không có await xen giữa) để các lần tải gần như
    // đồng thời không cùng lọt qua.
    entry.reservedBytes += additional;
  }

  private async capacityEntry(tenantId: string): Promise<CapacityEntry> {
    const cached = this.capacityCache.get(tenantId);
    if (cached && cached.expiresAt > this.now()) return cached;
    const inflight = this.capacityLoads.get(tenantId);
    if (inflight) return inflight;
    const load = this.usage(tenantId)
      .then((usage) => {
        const entry: CapacityEntry = {
          usedBytes: usage.usedBytes,
          quotaBytes: usage.quotaBytes,
          enforcement: usage.enforcement,
          expiresAt: this.now() + CAPACITY_CACHE_TTL_MS,
          reservedBytes: 0,
        };
        this.storeCapacityEntry(tenantId, entry);
        return entry;
      })
      .finally(() => this.capacityLoads.delete(tenantId));
    this.capacityLoads.set(tenantId, load);
    return load;
  }

  private storeCapacityEntry(tenantId: string, entry: CapacityEntry): void {
    this.capacityCache.delete(tenantId);
    if (this.capacityCache.size >= CAPACITY_CACHE_MAX_TENANTS) {
      const now = this.now();
      for (const [key, value] of this.capacityCache) {
        if (value.expiresAt <= now) this.capacityCache.delete(key);
      }
      // Vẫn đầy: bỏ mục cũ nhất (Map giữ thứ tự chèn).
      while (this.capacityCache.size >= CAPACITY_CACHE_MAX_TENANTS) {
        const oldest = this.capacityCache.keys().next();
        if (oldest.done) break;
        this.capacityCache.delete(oldest.value);
      }
    }
    this.capacityCache.set(tenantId, entry);
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
