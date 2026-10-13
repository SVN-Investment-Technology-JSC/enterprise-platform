import type { HrmAttendanceMonitor } from '@enterprise-platform/contracts-hrm';
import type { HrmAction } from '@enterprise-platform/contracts-identity';
import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../infrastructure/hrm-access.guard.js';
import {
  loadAttendanceMonitor,
  loadTeamEmployeeIds,
} from '../infrastructure/hrm-attendance-monitor.js';
import { HrmContextService } from '../infrastructure/hrm-context.service.js';
import { HrmMissingSchemaInterceptor } from '../infrastructure/hrm-missing-schema.interceptor.js';
import { todayInVietnam } from '../infrastructure/hrm-timesheet-month.js';
import { requireDate } from '../infrastructure/hrm-validation.js';

/** Quyền xem chấm công toàn công ty (nhân sự, chấm công viên, người chốt lương). */
const VIEW_ALL: readonly HrmAction[] = ['hrm.attendance.read', 'hrm.timesheet.read'];
/** Quyền duyệt: người có một trong các quyền này được xem cấp dưới của mình theo sơ đồ tổ chức. */
const MANAGER: readonly HrmAction[] = [
  'hrm.leave.approve',
  'hrm.ot.approve',
  'hrm.trip.approve',
  'hrm.shift.approve',
  'hrm.attendance.approve',
  'hrm.custom.approve',
  'hrm.advance.approve',
];

/**
 * Giám sát chấm công theo ngày. Phạm vi do server quyết định: có quyền xem chấm công/bảng công thì thấy toàn công ty;
 * người quản lý (có quyền duyệt) chỉ thấy cấp dưới theo sơ đồ tổ chức; người khác bị từ chối.
 */
@UseInterceptors(HrmMissingSchemaInterceptor)
@Controller('v1')
export class HrmAttendanceMonitorController {
  constructor(private readonly ctx: HrmContextService) {}

  @RequirePermission('hrm.read')
  @Get('attendance-monitor')
  async monitor(
    @Req() req: Request,
    @Query('date') dateParam?: string,
  ): Promise<{ data: HrmAttendanceMonitor }> {
    const date = dateParam ? requireDate(dateParam, 'date') : todayInVietnam();
    const context = await this.ctx.getContext(req, 'hrm.read');
    const { pool, tenantId } = context;
    if (VIEW_ALL.some((p) => this.ctx.has(context, p)))
      return {
        data: await loadAttendanceMonitor(pool, tenantId, {
          date,
          employeeIds: null,
          scope: 'ALL',
        }),
      };
    if (!MANAGER.some((p) => this.ctx.has(context, p)))
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'Bạn không có quyền xem giám sát chấm công',
      });
    const own = await this.ctx.resolveEmployee(pool, tenantId, context.principal.userId);
    const team = await loadTeamEmployeeIds(pool, tenantId, own.employeeId);
    return {
      data: await loadAttendanceMonitor(pool, tenantId, {
        date,
        employeeIds: team,
        scope: 'TEAM',
      }),
    };
  }
}
