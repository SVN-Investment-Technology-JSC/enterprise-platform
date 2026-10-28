import {
  DASHBOARD_LIST_LIMIT,
  DASHBOARD_PERIODS,
  OPEN_OPPORTUNITY_STAGES,
  type DashboardQuery,
  type DashboardScopeLevel,
  type SalesDashboard,
} from '@enterprise-platform/contracts-crm';
import { buildTrend, metric, rate, resolveDashboardRange } from '../domain/dashboard.js';
import { optionalEnum } from '../domain/fields.js';
import { roundVnd } from '../domain/pricing-engine.js';
import { addDays } from '../domain/receivables.js';
import { percentOf, salesFigures } from '../domain/sales-report.js';
import type { SalesSettingsStore } from './contract-store.port.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScope, CrmDataScopeService } from './data-scope.js';
import { vietnamToday } from './pricing.service.js';
import type { DashboardPeriodFigures, SalesDashboardStore } from './sales-dashboard-store.port.js';

/** Mức phạm vi để giao diện ghi rõ con số đang nói về ai. */
export function dashboardScopeLevel(scope: CrmDataScope): DashboardScopeLevel {
  if (scope.kind === 'all') return 'all';
  return scope.userIds.length > 1 ? 'team' : 'mine';
}

/**
 * Dashboard Tổng quan của Bán hàng. Chỉ cần `crm.read` (guard đã kiểm), nhưng
 * mọi con số đi qua phạm vi dữ liệu của người xem (của tôi, cấp dưới, toàn bộ);
 * không có tham số nào mở rộng phạm vi.
 */
export class SalesDashboardService {
  constructor(
    private readonly store: SalesDashboardStore,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly settings: Pick<SalesSettingsStore, 'contractExpiringDays'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dashboard(actor: CrmActor, query: DashboardQuery): Promise<SalesDashboard> {
    const today = vietnamToday(this.now());
    const period = optionalEnum(query?.period, DASHBOARD_PERIODS, 'kỳ') ?? 'month';
    const { range, previous } = resolveDashboardRange(period, query?.from, query?.to, today);
    const scope = await this.scopes.resolve(actor);
    const tenantId = actor.tenantId;
    const contractExpiringDays = await this.settings.contractExpiringDays(tenantId);
    const filter = { today, expiringUntil: addDays(today, contractExpiringDays), limit: DASHBOARD_LIST_LIMIT };

    const [figures, daily, stages, topCustomers, topProducts, snapshot, late, quotes, contracts, activities, receivables] =
      await Promise.all([
        this.store.periodFigures(tenantId, scope, range, previous),
        this.store.dailyFigures(tenantId, scope, range),
        this.store.pipeline(tenantId, scope),
        this.store.topCustomers(tenantId, scope, range, DASHBOARD_LIST_LIMIT),
        this.store.topProducts(tenantId, scope, range, DASHBOARD_LIST_LIMIT),
        this.store.snapshot(tenantId, scope, today),
        this.store.lateDeliveries(tenantId, scope, filter),
        this.store.pendingQuotes(tenantId, scope, { userId: actor.userId, canApproveQuote: actor.canApproveQuote }, filter),
        this.store.expiringContracts(tenantId, scope, filter),
        this.store.dueActivities(tenantId, actor.userId, filter),
        this.store.overdueReceivables(tenantId, scope, filter),
      ]);

    const sales = (raw: DashboardPeriodFigures) =>
      salesFigures({ quantity: 0, revenue: raw.revenue, vatAmount: 0, costAmount: raw.costAmount, orderCount: raw.newOrders });
    const current = sales(figures.current);
    const before = sales(figures.previous);
    const winRate = (raw: DashboardPeriodFigures) => percentOf(raw.won, raw.won + raw.lost);
    const byStage = new Map(stages.map((row) => [row.stage, row]));
    const pipeline = OPEN_OPPORTUNITY_STAGES.map(
      (stage) => byStage.get(stage) ?? { stage, count: 0, value: 0, weightedValue: 0 },
    );

    return {
      period,
      range,
      previous,
      asOf: today,
      scope: dashboardScopeLevel(scope),
      kpis: {
        revenue: metric(current.revenue, before.revenue),
        profit: metric(current.profit, before.profit),
        marginPercent: rate(current.marginPercent, before.marginPercent),
        newOrders: metric(figures.current.newOrders, figures.previous.newOrders),
        winRate: { ...rate(winRate(figures.current), winRate(figures.previous)), won: figures.current.won, lost: figures.current.lost },
        pipeline: {
          count: pipeline.reduce((sum, row) => sum + row.count, 0),
          value: roundVnd(pipeline.reduce((sum, row) => sum + row.value, 0)),
          weightedValue: roundVnd(pipeline.reduce((sum, row) => sum + row.weightedValue, 0)),
        },
        receivables: {
          balance: roundVnd(snapshot.receivableBalance),
          overdue: roundVnd(snapshot.receivableOverdue),
          overdueCustomers: snapshot.overdueCustomers,
        },
        pendingQuotes: { count: snapshot.pendingQuotes, value: roundVnd(snapshot.pendingQuoteValue) },
      },
      trend: buildTrend(range, daily),
      pipeline,
      topCustomers,
      topProducts,
      attention: {
        lateDeliveries: late,
        pendingQuotes: quotes,
        expiringContracts: contracts,
        activities,
        overdueReceivables: receivables,
      },
      contractExpiringDays,
    };
  }
}
