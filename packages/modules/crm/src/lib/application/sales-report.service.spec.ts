import { CRM_NO_CAPABILITIES } from '@enterprise-platform/contracts-crm';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope } from './data-scope.js';
import type { SalesReportStore } from './sales-report-store.port.js';
import { SalesReportService } from './sales-report.service.js';

const TENANT = 'tenant-1';
const OWNER = '11111111-1111-4111-8111-111111111111';
const NOW = () => new Date('2026-10-28T03:00:00Z');

const actor = (extra: Partial<CrmActor> = {}): CrmActor => ({
  ...CRM_NO_CAPABILITIES,
  tenantId: TENANT,
  userId: 'nv-1',
  displayName: 'Nhân viên',
  canReadReport: true,
  ...extra,
});

function fakeStore(): jest.Mocked<SalesReportStore> {
  return {
    salesByDimension: jest.fn().mockResolvedValue({
      rows: [{ key: OWNER, code: null, label: null, figures: { quantity: 2, revenue: 2_000_000, vatAmount: 200_000, costAmount: 1_600_000, orderCount: 1 } }],
      truncated: false,
      totals: { quantity: 2, revenue: 2_000_000, vatAmount: 200_000, costAmount: 1_600_000, orderCount: 1 },
    }),
    conversionCounts: jest.fn().mockResolvedValue([
      { ownerUserId: 'a', counts: { OPPORTUNITY: 4, QUOTE: 2, CONTRACT: 1, ORDER: 1 } },
      { ownerUserId: 'b', counts: { OPPORTUNITY: 6, QUOTE: 4, CONTRACT: 3, ORDER: 2 } },
    ]),
    alerts: jest.fn().mockResolvedValue([]),
    receivables: jest.fn().mockResolvedValue({
      customers: [
        { revenue: 1_000, collected: 400, adjusted: 0, balance: 600, uncollectedRevenue: 600, overdueAmount: 100 },
        { revenue: 500, collected: 0, adjusted: -100, balance: 400, uncollectedRevenue: 500, overdueAmount: 0 },
      ],
      overdueOrders: [],
    }),
  };
}

describe('SalesReportService', () => {
  const scope: CrmDataScope = { kind: 'users', userIds: ['nv-1'] };
  const scopes = { resolve: jest.fn(async () => scope) };
  const settings = { contractExpiringDays: jest.fn(async () => 30) };

  it('không có crm.report.read thì 403 ở mọi báo cáo; quản trị tenant được xem', async () => {
    const store = fakeStore();
    const service = new SalesReportService(store, scopes, settings, NOW);
    const reader = actor({ canReadReport: false });
    await expect(service.sales(reader, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.conversion(reader, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.alerts(reader, {})).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.receivables(reader, {})).rejects.toMatchObject({ statusCode: 403 });
    expect(store.salesByDimension).not.toHaveBeenCalled();
    await expect(service.sales(actor({ canReadReport: false, isTenantAdmin: true }), {})).resolves.toBeDefined();
  });

  it('báo cáo doanh thu áp phạm vi của người xem, kỳ mặc định từ đầu tháng, tính lợi nhuận', async () => {
    const store = fakeStore();
    const service = new SalesReportService(store, scopes, settings, NOW);
    const report = await service.sales(actor(), { groupBy: 'owner', ownerUserId: OWNER, region: ' Miền Bắc ' });
    expect(store.salesByDimension).toHaveBeenCalledWith(
      TENANT,
      scope,
      'owner',
      { from: '2026-10-01', to: '2026-10-28', ownerUserId: OWNER, customerGroupId: undefined, region: 'Miền Bắc' },
      2_000,
    );
    expect(report.rows[0]).toMatchObject({ key: OWNER, label: '', profit: 400_000, marginPercent: 20 });
    expect(report.totals.profit).toBe(400_000);
  });

  it('chiều không hợp lệ là lỗi nhập', async () => {
    const service = new SalesReportService(fakeStore(), scopes, settings, NOW);
    await expect(service.sales(actor(), { groupBy: 'warehouse' as never })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('chuyển đổi: cộng các nhân viên rồi tính tỷ lệ', async () => {
    const service = new SalesReportService(fakeStore(), scopes, settings, NOW);
    const report = await service.conversion(actor(), { from: '2026-01-01', to: '2026-10-28' });
    expect(report.steps.map((step) => [step.count, step.stepPercent])).toEqual([
      [10, null],
      [6, 60],
      [4, 66.67],
      [3, 75],
    ]);
    expect(report.byOwner.map((row) => row.ownerUserId)).toEqual(['b', 'a']);
  });

  it('cảnh báo hợp đồng dùng số ngày cấu hình', async () => {
    const store = fakeStore();
    const service = new SalesReportService(store, scopes, settings, NOW);
    expect(await service.alerts(actor(), {})).toEqual({ items: [], contractExpiringDays: 30 });
    expect(store.alerts).toHaveBeenCalledWith(TENANT, scope, { today: '2026-10-28', expiringUntil: '2026-11-27', ownerUserId: undefined, kind: undefined });
  });

  it('công nợ: tổng cộng các khách', async () => {
    const service = new SalesReportService(fakeStore(), scopes, settings, NOW);
    const report = await service.receivables(actor(), {});
    expect(report.totals).toEqual({ revenue: 1_500, collected: 400, adjusted: -100, balance: 1_000, uncollectedRevenue: 1_100, overdueAmount: 100 });
    expect(report.asOf).toBe('2026-10-28');
  });
});
