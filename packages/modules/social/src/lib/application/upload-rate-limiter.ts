import { SocialRateLimitedError } from '../domain/social.error.js';

export const UPLOAD_RATE_WINDOW_MS = 60_000;
export const UPLOAD_RATE_PER_USER = 30;
export const UPLOAD_RATE_PER_TENANT = 300;

export interface UploadRateLimits {
  readonly windowMs: number;
  readonly perUser: number;
  readonly perTenant: number;
}

const DEFAULT_LIMITS: UploadRateLimits = {
  windowMs: UPLOAD_RATE_WINDOW_MS,
  perUser: UPLOAD_RATE_PER_USER,
  perTenant: UPLOAD_RATE_PER_TENANT,
};

/**
 * Giới hạn tần suất `initiate`, cửa sổ trượt trong bộ nhớ của tiến trình:
 * mỗi người tối đa `perUser` lần và mỗi tenant tối đa `perTenant` lần trong
 * `windowMs`. Lần bị từ chối không được tính vào cửa sổ.
 */
export class UploadRateLimiter {
  private readonly users = new Map<string, number[]>();
  private readonly tenants = new Map<string, number[]>();

  constructor(
    private readonly clock: () => number = () => Date.now(),
    private readonly limits: UploadRateLimits = DEFAULT_LIMITS,
  ) {}

  /** Ghi nhận một lần gọi; ném `SocialRateLimitedError` khi vượt. */
  consume(tenantId: string, userId: string): void {
    const now = this.clock();
    const userKey = `${tenantId}:${userId}`;
    const userHits = this.prune(this.users, userKey, now);
    const tenantHits = this.prune(this.tenants, tenantId, now);
    if (userHits.length >= this.limits.perUser || tenantHits.length >= this.limits.perTenant) {
      throw new SocialRateLimitedError();
    }
    userHits.push(now);
    tenantHits.push(now);
  }

  /** Bỏ các lần ngoài cửa sổ; xoá khoá rỗng để bản đồ không phình mãi. */
  private prune(map: Map<string, number[]>, key: string, now: number): number[] {
    const hits = (map.get(key) ?? []).filter((at) => now - at < this.limits.windowMs);
    map.set(key, hits);
    if (map.size > 5000) {
      for (const [otherKey, otherHits] of map) {
        if (otherKey !== key && otherHits.every((at) => now - at >= this.limits.windowMs)) map.delete(otherKey);
      }
    }
    return hits;
  }
}
