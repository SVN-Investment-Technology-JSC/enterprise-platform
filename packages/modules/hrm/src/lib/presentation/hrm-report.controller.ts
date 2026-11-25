import { HRM_REPORT_KINDS, type HrmReportKind } from '@enterprise-platform/contracts-hrm';
import { BadRequestException, Controller, Get, Param, Query, Req, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import { loadReport, loadReportOptions, parseReportFilters } from '../infrastructure/hrm-reports.js';

/**
 * Báo cáo HRM (trang Báo cáo). Người có `hrm.report.view` xem báo cáo của toàn tenant; bộ lọc phòng ban, nhân viên, khoảng
 * ngày do giao diện chọn. Chỉ đọc: file Excel được tạo ở trình duyệt từ dữ liệu và các cột đã chọn.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmReportController {
  constructor(private readonly ctx: HrmContextService) {}

  /** Lựa chọn cho bộ lọc: phòng ban, nhân viên, loại phép. Khai trước `reports/:kind` để không bị coi là loại báo cáo. */
  @Get('reports/filter-options')
  @RequirePermission('hrm.report.view')
  async options(@Req() req: Request) {
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.report.view');
    return { data: await loadReportOptions(pool, tenantId), meta: { requestId: req.headers['x-request-id'] as string } };
  }

  @Get('reports/:kind')
  @RequirePermission('hrm.report.view')
  async report(
    @Req() req: Request,
    @Param('kind') kind: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentIds') departmentIds?: string,
    @Query('employeeIds') employeeIds?: string,
    @Query('statuses') statuses?: string,
    @Query('requestKinds') requestKinds?: string,
    @Query('leaveTypeIds') leaveTypeIds?: string,
  ) {
    if (!HRM_REPORT_KINDS.includes(kind as HrmReportKind)) throw new BadRequestException('Loại báo cáo không hợp lệ');
    const { pool, tenantId } = await this.ctx.getContext(req, 'hrm.report.view');
    const filters = parseReportFilters({ from, to, departmentIds, employeeIds, statuses, requestKinds, leaveTypeIds });
    const data = await loadReport(pool, tenantId, kind as HrmReportKind, filters);
    return { data, meta: { requestId: req.headers['x-request-id'] as string } };
  }
}
