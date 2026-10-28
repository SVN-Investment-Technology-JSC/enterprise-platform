import {
  CONVERSION_STAGES,
  SALES_ALERT_KINDS,
  SALES_REPORT_DIMENSIONS,
  SALES_REPORT_MAX_ROWS,
  type ConversionReport,
  type ConversionReportQuery,
  type ConversionStage,
  type ReceivableReport,
  type ReceivableReportQuery,
  type SalesAlertList,
  type SalesAlertQuery,
  type SalesReport,
  type SalesReportQuery,
} from '@enterprise-platform/contracts-crm';
import { CrmForbiddenError } from '../domain/crm.error.js';
import { optionalEnum, optionalId, optionalText } from '../domain/fields.js';
import { addDays } from '../domain/receivables.js';
import { conversionSteps, resolvePeriod, salesFigures } from '../domain/sales-report.js';
import { roundVnd } from '../domain/pricing-engine.js';
import type { SalesSettingsStore } from './contract-store.port.js';
import type { CrmActor } from './crm-actor.js';
import type { CrmDataScopeService } from './data-scope.js';
import { vietnamToday } from './pricing.service.js';
import type { SalesReportStore } from './sales-report-store.port.js';

/** Xem báo cáo Bán hàng: `crm.report.read` (quản trị tenant luôn có). */
export function requireReportReader(actor: CrmActor): void {
  if (!actor.canReadReport && !actor.isTenantAdmin) {
    throw new CrmForbiddenError('Bạn không có quyền xem báo cáo CRM.');
  }
}

/**
 * Báo cáo Bán hàng (T7-02 đến T7-05). Mọi báo cáo cần `crm.report.read` và chỉ
 * gồm dữ liệu trong phạm vi của người xem (Q11): của tôi, cấp dưới, toàn bộ.
 * Lọc theo một người phụ trách ngoài phạm vi trả rỗng, không mở rộng phạm vi.
 */
export class SalesReportService {
  constructor(
    private readonly store: SalesReportStore,
    private readonly scopes: Pick<CrmDataScopeService, 'resolve'>,
    private readonly settings: Pick<SalesSettingsStore, 'contractExpiringDays'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private today(): string {
    return vietnamToday(this.now());
  }

  /** Doanh thu, sản lượng, lợi nhuận theo chiều (RPT-01, TC-RPT-01, TC-RPT-02, TC-RPT-08). */
  async sales(actor: CrmActor, query: SalesReportQuery): Promise<SalesReport> {
    requireReportReader(actor);
    const period = resolvePeriod(query?.from, query?.to, this.today());
    const groupBy = optionalEnum(query?.groupBy, SALES_REPORT_DIMENSIONS, 'chiều báo cáo') ?? 'owner';
    const scope = await this.scopes.resolve(actor);
    const result = await this.store.salesByDimension(
      actor.tenantId,
      scope,
      groupBy,
      {
        ...period,
        ownerUserId: optionalId(query?.ownerUserId, 'người phụ trách') ?? undefined,
        customerGroupId: optionalId(query?.customerGroupId, 'nhóm khách') ?? undefined,
        region: optionalText(query?.region, 100, 'khu vực') ?? undefined,
      },
      SALES_REPORT_MAX_ROWS,
    );
    return {
      ...period,
      groupBy,
      rows: result.rows.map((row) => ({ key: row.key, code: row.code, label: row.label ?? '', ...salesFigures(row.figures) })),
      truncated: result.truncated,
      totals: salesFigures(result.totals),
    };
  }

  /** Tỷ lệ chuyển đổi cơ hội → báo giá → hợp đồng → đơn theo kỳ, theo nhân viên (RPT-02, TC-RPT-03). */
  async conversion(actor: CrmActor, query: ConversionReportQuery): Promise<ConversionReport> {
    requireReportReader(actor);
    const period = resolvePeriod(query?.from, query?.to, this.today());
    const scope = await this.scopes.resolve(actor);
    const owners = await this.store.conversionCounts(actor.tenantId, scope, {
      ...period,
      ownerUserId: optionalId(query?.ownerUserId, 'người phụ trách') ?? undefined,
    });
    const total = Object.fromEntries(CONVERSION_STAGES.map((stage) => [stage, 0])) as Record<ConversionStage, number>;
    for (const owner of owners) for (const stage of CONVERSION_STAGES) total[stage] += owner.counts[stage];
    return {
      ...period,
      steps: conversionSteps(total),
      byOwner: [...owners]
        .sort((a, b) => b.counts.OPPORTUNITY - a.counts.OPPORTUNITY || a.ownerUserId.localeCompare(b.ownerUserId))
        .map((owner) => ({ ownerUserId: owner.ownerUserId, steps: conversionSteps(owner.counts) })),
    };
  }

  /** Báo giá chờ duyệt, hợp đồng sắp hết hạn, đơn giao trễ (RPT-03, TC-RPT-04). */
  async alerts(actor: CrmActor, query: SalesAlertQuery): Promise<SalesAlertList> {
    requireReportReader(actor);
    const today = this.today();
    const scope = await this.scopes.resolve(actor);
    const contractExpiringDays = await this.settings.contractExpiringDays(actor.tenantId);
    const items = await this.store.alerts(actor.tenantId, scope, {
      today,
      expiringUntil: addDays(today, contractExpiringDays),
      ownerUserId: optionalId(query?.ownerUserId, 'người phụ trách') ?? undefined,
      kind: optionalEnum(query?.kind, SALES_ALERT_KINDS, 'loại cảnh báo'),
    });
    return { items, contractExpiringDays };
  }

  /** Công nợ theo khách, đơn quá hạn, doanh thu chưa thu (RPT-07, TC-RPT-07). */
  async receivables(actor: CrmActor, query: ReceivableReportQuery): Promise<ReceivableReport> {
    requireReportReader(actor);
    const asOf = this.today();
    const scope = await this.scopes.resolve(actor);
    const { customers, overdueOrders } = await this.store.receivables(actor.tenantId, scope, {
      today: asOf,
      ownerUserId: optionalId(query?.ownerUserId, 'người phụ trách') ?? undefined,
      customerGroupId: optionalId(query?.customerGroupId, 'nhóm khách') ?? undefined,
      region: optionalText(query?.region, 100, 'khu vực') ?? undefined,
    });
    const sum = (pick: (row: (typeof customers)[number]) => number) => roundVnd(customers.reduce((total, row) => total + pick(row), 0));
    return {
      asOf,
      customers,
      overdueOrders,
      totals: {
        revenue: sum((row) => row.revenue),
        collected: sum((row) => row.collected),
        adjusted: sum((row) => row.adjusted),
        balance: sum((row) => row.balance),
        uncollectedRevenue: sum((row) => row.uncollectedRevenue),
        overdueAmount: sum((row) => row.overdueAmount),
      },
    };
  }
}
