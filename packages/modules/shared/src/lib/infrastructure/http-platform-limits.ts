import {
  STORAGE_RESOURCE_KEY,
  type TenantLimitsResponse,
  type TenantStorageLimit,
} from '@enterprise-platform/contracts-shared';
import type { PlatformLimitsReader } from '../application/platform-limits.port.js';

/** Giữ hạn mức 60 giây: đổi gói không cần hiệu lực tức thì như đổi quyền. */
const CACHE_TTL_MS = 60_000;

/**
 * Hỏi Platform hạn mức của tenant qua endpoint nội bộ (service token).
 *
 * Platform không trả lời được thì dùng lại con số đã biết gần nhất, chưa có
 * thì trả `undefined` để tầng application dùng mức mặc định.
 */
export class HttpPlatformLimits implements PlatformLimitsReader {
  private readonly cache = new Map<string, { at: number; limit: TenantStorageLimit | undefined }>();

  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  async storageLimit(tenantId: string): Promise<TenantStorageLimit | undefined> {
    const cached = this.cache.get(tenantId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.limit;

    const root =
      process.env.PLATFORM_TENANT_LIMITS_URL ??
      'http://localhost:3333/api/platform/internal/v1/tenant-limits';
    try {
      const response = await this.fetcher(`${root}/${encodeURIComponent(tenantId)}`, {
        headers: { 'x-service-token': process.env.INTERNAL_SERVICE_TOKEN ?? '' },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Platform tenant-limits returned ${response.status}.`);
      const body = (await response.json()) as TenantLimitsResponse;
      const limit = body.limits?.find((item) => item.resourceKey === STORAGE_RESOURCE_KEY);
      this.cache.set(tenantId, { at: Date.now(), limit });
      return limit;
    } catch {
      return cached?.limit;
    }
  }
}
