import type { TenantStorageLimit } from '@enterprise-platform/contracts-shared';
import { StorageQuotaExceededError } from '../domain/shared.error.js';
import type { SharedStore } from './shared-store.port.js';
import {
  CAPACITY_CACHE_MAX_TENANTS,
  CAPACITY_CACHE_TTL_MS,
  StorageQuotaService,
} from './storage-quota.service.js';

const GB = 1024 * 1024 * 1024;

function setup(options: { usedBytes: number; quotaGb: number; enforcement?: 'hard' | 'soft' }) {
  let now = 1_000_000;
  let used = options.usedBytes;
  const reads = { store: 0, limits: 0 };
  const store = {
    storage: {
      usageByModule: async () => {
        reads.store += 1;
        return [{ module: 'shared', bytes: used }];
      },
    },
  } as unknown as SharedStore;
  const limit: TenantStorageLimit = {
    resourceKey: 'storage_gb',
    limitValue: options.quotaGb,
    enforcement: options.enforcement ?? 'hard',
    source: 'plan',
    addOnValue: 0,
  };
  const limits = {
    storageLimit: async () => {
      reads.limits += 1;
      return limit;
    },
  };
  const service = new StorageQuotaService(store, limits, () => now);
  return {
    service,
    reads,
    advance: (ms: number) => {
      now += ms;
    },
    setUsed: (value: number) => {
      used = value;
    },
  };
}

describe('StorageQuotaService.ensureCapacity', () => {
  it('đọc store lần đầu, lần hai trong 30 giây dùng cache, hết hạn thì đọc lại', async () => {
    const ctx = setup({ usedBytes: 0, quotaGb: 10 });
    await ctx.service.ensureCapacity('t1', 1);
    expect(ctx.reads.store).toBe(1);
    ctx.advance(CAPACITY_CACHE_TTL_MS - 1);
    await ctx.service.ensureCapacity('t1', 1);
    expect(ctx.reads.store).toBe(1);
    ctx.advance(2);
    await ctx.service.ensureCapacity('t1', 1);
    expect(ctx.reads.store).toBe(2);
  });

  it('các tenant có cache riêng', async () => {
    const ctx = setup({ usedBytes: 0, quotaGb: 10 });
    await ctx.service.ensureCapacity('t1', 1);
    await ctx.service.ensureCapacity('t2', 1);
    expect(ctx.reads.store).toBe(2);
  });

  it('đặt trước chặn các lần gần đồng thời mà riêng từng lần đều vừa chỗ', async () => {
    const ctx = setup({ usedBytes: 8 * GB, quotaGb: 10 });
    const results = await Promise.allSettled([
      ctx.service.ensureCapacity('t1', 1.5 * GB),
      ctx.service.ensureCapacity('t1', 1.5 * GB),
      ctx.service.ensureCapacity('t1', 1.5 * GB),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((item) => item.status === 'rejected');
    expect(rejected).toHaveLength(2);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StorageQuotaExceededError);
    expect(ctx.reads.store).toBe(1);
  });

  it('hết hạn cache thì đặt lại phần đã đặt trước', async () => {
    const ctx = setup({ usedBytes: 8 * GB, quotaGb: 10 });
    await ctx.service.ensureCapacity('t1', 1.5 * GB);
    await expect(ctx.service.ensureCapacity('t1', 1.5 * GB)).rejects.toBeInstanceOf(StorageQuotaExceededError);
    ctx.advance(CAPACITY_CACHE_TTL_MS + 1);
    ctx.setUsed(8 * GB);
    await expect(ctx.service.ensureCapacity('t1', 1.5 * GB)).resolves.toBeUndefined();
  });

  it('lần bị từ chối không đặt trước', async () => {
    const ctx = setup({ usedBytes: 9 * GB, quotaGb: 10 });
    await expect(ctx.service.ensureCapacity('t1', 5 * GB)).rejects.toThrow('vượt hạn mức dung lượng');
    await expect(ctx.service.ensureCapacity('t1', 1 * GB)).resolves.toBeUndefined();
  });

  it('soft luôn cho qua và không đặt trước', async () => {
    const ctx = setup({ usedBytes: 50 * GB, quotaGb: 10, enforcement: 'soft' });
    await expect(ctx.service.ensureCapacity('t1', 100 * GB)).resolves.toBeUndefined();
    await expect(ctx.service.ensureCapacity('t1', 100 * GB)).resolves.toBeUndefined();
  });

  it('giới hạn số mục trong cache', async () => {
    const ctx = setup({ usedBytes: 0, quotaGb: 10 });
    for (let index = 0; index < CAPACITY_CACHE_MAX_TENANTS + 5; index += 1) {
      await ctx.service.ensureCapacity(`t${index}`, 1);
    }
    const cache = (ctx.service as unknown as { capacityCache: Map<string, unknown> }).capacityCache;
    expect(cache.size).toBeLessThanOrEqual(CAPACITY_CACHE_MAX_TENANTS);
  });
});

describe('StorageQuotaService.usage', () => {
  it('luôn đọc mới, không dùng cache', async () => {
    const ctx = setup({ usedBytes: 1 * GB, quotaGb: 10 });
    await ctx.service.ensureCapacity('t1', 1);
    expect(ctx.reads.store).toBe(1);
    ctx.setUsed(2 * GB);
    const usage = await ctx.service.usage('t1');
    expect(ctx.reads.store).toBe(2);
    expect(usage.usedBytes).toBe(2 * GB);
    await ctx.service.usage('t1');
    expect(ctx.reads.store).toBe(3);
  });
});
