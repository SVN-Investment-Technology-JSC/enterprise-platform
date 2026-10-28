import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope } from './data-scope.js';
import type { SalesDashboardStore } from './sales-dashboard-store.port.js';
import { SalesDashboardService, dashboardScopeLevel } from './sales-dashboard.service.js';

const TENANT = 'tenant-1';
const NOW = () => new Date('2026-10-28T03:00:00Z');
const EMPTY = { total: 0, items: [] };

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: 'nv-1',
  displayName: 'Nhân viên',
  ...extra,
});

function fakeStore(): jest.Mocked<SalesDashboardStore> {
  return {
    periodFigures: jest.fn().mockResolvedValue({
      current: { revenue: 2_000_000, costAmount: 1_500_000, newOrders: 3, won: 2, lost: 2 },
      previous: { revenue: 1_000_000, costAmount: 800_000, newOrders: 0, won: 1, lost: 3 },
    }),
    dailyFigures: jest.fn().mockResolvedValue([{ date: '2026-10-05', revenue: 2_000_000, orders: 3 }]),
    pipeline: jest.fn().mockResolvedValue([
      { stage: 'QUOTING', count: 2, value: 10_000_000, weightedValue: 5_000_000 },
      { stage: 'NEW', count: 1, value: 1_000_000, weightedValue: 100_000 },
    ]),
    topCustomers: jest.fn().mockResolvedValue([]),
    topProducts: jest.fn().mockResolvedValue([]),
    snapshot: jest.fn().mockResolvedValue({
      receivableBalance: 5_000_000,
      receivableOverdue: 1_200_000,
      overdueCustomers: 1,
      pendingQuotes: 2,
      pendingQuoteValue: 3_000_000,
    }),
    lateDeliveries: jest.fn().mockResolvedValue(EMPTY),
    pendingQuotes: jest.fn().mockResolvedValue(EMPTY),
    expiringContracts: jest.fn().mockResolvedValue(EMPTY),
    dueActivities: jest.fn().mockResolvedValue(EMPTY),
    overdueReceivables: jest.fn().mockResolvedValue(EMPTY),
  };
}

describe('SalesDashboardService', () => {
  const mine: CrmDataScope = { kind: 'users', userIds: ['nv-1'] };
  const settings = { contractExpiringDays: jest.fn(async () => 30) };

  it('chỉ cần crm.read; mọi truy vấn theo kỳ đều đi qua phạm vi của người xem', async () => {
    const store = fakeStore();
    const scopes = { resolve: jest.fn(async () => mine) };
    const dashboard = await new SalesDashboardService(store, scopes, settings, NOW).dashboard(actor(), {});
    expect(scopes.resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: 'nv-1' }));
    const range = { from: '2026-10-01', to: '2026-10-28' };
    const previous = { from: '2026-09-01', to: '2026-09-28' };
    expect(store.periodFigures).toHaveBeenCalledWith(TENANT, mine, range, previous);
    expect(store.dailyFigures).toHaveBeenCalledWith(TENANT, mine, range);
    expect(store.pipeline).toHaveBeenCalledWith(TENANT, mine);
    expect(store.topCustomers).toHaveBeenCalledWith(TENANT, mine, range, 5);
    expect(store.topProducts).toHaveBeenCalledWith(TENANT, mine, range, 5);
    expect(store.snapshot).toHaveBeenCalledWith(TENANT, mine, '2026-10-28');
    const filter = { today: '2026-10-28', expiringUntil: '2026-11-27', limit: 5 };
    for (const list of [store.lateDeliveries, store.expiringContracts, store.overdueReceivables]) {
      expect(list).toHaveBeenCalledWith(TENANT, mine, filter);
    }
    expect(store.pendingQuotes).toHaveBeenCalledWith(TENANT, mine, { userId: 'nv-1', canApproveQuote: false }, filter);
    // Hoạt động: chỉ việc giao cho chính người xem.
    expect(store.dueActivities).toHaveBeenCalledWith(TENANT, 'nv-1', filter);
    expect(dashboard.scope).toBe('mine');
    expect(dashboard.range).toEqual(range);
    expect(dashboard.previous).toEqual(previous);
  });

  it('chỉ số: lợi nhuận, biên, tỷ lệ thắng, thay đổi so với kỳ trước (kỳ trước 0 thì null)', async () => {
    const service = new SalesDashboardService(fakeStore(), { resolve: async () => mine }, settings, NOW);
    const { kpis, trend, pipeline } = await service.dashboard(actor(), { period: 'month' });
    expect(kpis.revenue).toEqual({ value: 2_000_000, previous: 1_000_000, changePercent: 100 });
    expect(kpis.profit).toEqual({ value: 500_000, previous: 200_000, changePercent: 150 });
    expect(kpis.marginPercent).toEqual({ value: 25, previous: 20, changePoints: 5 });
    expect(kpis.newOrders).toEqual({ value: 3, previous: 0, changePercent: null });
    expect(kpis.winRate).toEqual({ value: 50, previous: 25, changePoints: 25, won: 2, lost: 2 });
    expect(kpis.pipeline).toEqual({ count: 3, value: 11_000_000, weightedValue: 5_100_000 });
    expect(kpis.receivables).toEqual({ balance: 5_000_000, overdue: 1_200_000, overdueCustomers: 1 });
    expect(kpis.pendingQuotes).toEqual({ count: 2, value: 3_000_000 });
    expect(pipeline.map((row) => [row.stage, row.count])).toEqual([
      ['NEW', 1],
      ['CONTACTED', 0],
      ['DISCOVERY', 0],
      ['QUOTING', 2],
      ['NEGOTIATION', 0],
    ]);
    expect(trend.granularity).toBe('day');
    expect(trend.buckets).toHaveLength(28);
    expect(trend.buckets[4]).toMatchObject({ start: '2026-10-05', revenue: 2_000_000, orders: 3 });
  });

  it('người duyệt báo giá: danh sách chờ duyệt gồm việc chờ mình duyệt', async () => {
    const store = fakeStore();
    const team: CrmDataScope = { kind: 'users', userIds: ['ql', 'nv-1'] };
    const dashboard = await new SalesDashboardService(store, { resolve: async () => team }, settings, NOW).dashboard(
      actor({ userId: 'ql', canApproveQuote: true }),
      { period: 'year' },
    );
    expect(store.pendingQuotes).toHaveBeenCalledWith(TENANT, team, { userId: 'ql', canApproveQuote: true }, expect.anything());
    expect(dashboard.scope).toBe('team');
    expect(dashboard.trend.granularity).toBe('month');
  });

  it('kỳ, ngày sai là lỗi nhập; Tenant Core lỗi thì không đọc gì', async () => {
    const store = fakeStore();
    const service = new SalesDashboardService(store, { resolve: async () => mine }, settings, NOW);
    await expect(service.dashboard(actor(), { period: 'week' as never })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.dashboard(actor(), { period: 'custom', from: '2026-10-10', to: '2026-10-01' })).rejects.toMatchObject({
      statusCode: 400,
    });
    const failing = new SalesDashboardService(store, { resolve: async () => Promise.reject(new Error('503')) }, settings, NOW);
    await expect(failing.dashboard(actor(), {})).rejects.toThrow('503');
    expect(store.periodFigures).not.toHaveBeenCalled();
  });

  it('mức phạm vi', () => {
    expect(dashboardScopeLevel({ kind: 'all' })).toBe('all');
    expect(dashboardScopeLevel({ kind: 'users', userIds: ['a'] })).toBe('mine');
    expect(dashboardScopeLevel({ kind: 'users', userIds: ['a', 'b'] })).toBe('team');
  });
});
