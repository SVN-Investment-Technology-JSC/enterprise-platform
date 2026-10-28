import type {
  ConversionReport,
  ConversionReportQuery,
  ReceivableReport,
  ReceivableReportQuery,
  SalesAlertList,
  SalesAlertQuery,
  SalesReport,
  SalesReportQuery,
} from '@enterprise-platform/contracts-crm';
import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { SalesReportService } from '../application/sales-report.service.js';
import { crmActor, runCrm, type CrmRequest } from './crm-http.js';

/**
 * Báo cáo Bán hàng (GĐ7): chỉ đọc. Guard bảo đảm `crm.read`; service kiểm
 * `crm.report.read` và áp phạm vi dữ liệu của người xem (Q11). Xuất Excel làm ở
 * giao diện từ đúng dữ liệu các route này trả về (TC-SEC-07).
 */
@Controller('v1/reports')
export class ReportsController {
  constructor(@Inject(SalesReportService) private readonly reports: SalesReportService) {}

  @Get('sales')
  sales(@Req() request: CrmRequest, @Query() query: SalesReportQuery): Promise<SalesReport> {
    return runCrm(() => this.reports.sales(crmActor(request), query));
  }

  @Get('conversion')
  conversion(@Req() request: CrmRequest, @Query() query: ConversionReportQuery): Promise<ConversionReport> {
    return runCrm(() => this.reports.conversion(crmActor(request), query));
  }

  @Get('alerts')
  alerts(@Req() request: CrmRequest, @Query() query: SalesAlertQuery): Promise<SalesAlertList> {
    return runCrm(() => this.reports.alerts(crmActor(request), query));
  }

  @Get('receivables')
  receivables(@Req() request: CrmRequest, @Query() query: ReceivableReportQuery): Promise<ReceivableReport> {
    return runCrm(() => this.reports.receivables(crmActor(request), query));
  }
}
