import type { DashboardQuery, SalesDashboard } from '@enterprise-platform/contracts-crm';
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { SalesDashboardService } from '../application/sales-dashboard.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Dashboard Tổng quan: chỉ đọc, guard bảo đảm `crm.read`. Số liệu lọc theo
 * phạm vi dữ liệu của người xem ở service; không cần `crm.report.read`.
 */
@Controller('v1/dashboard')
export class DashboardController {
  constructor(@Inject(SalesDashboardService) private readonly dashboard: SalesDashboardService) {}

  @Get()
  get(@Req() request: CrmRequest, @Query() query: DashboardQuery): Promise<SalesDashboard> {
    return runCrm(() => this.dashboard.dashboard(crmActor(request), query));
  }
}
