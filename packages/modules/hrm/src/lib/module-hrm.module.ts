import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { HrmContextService } from './infrastructure/hrm-context.service.js';
import { HrmAttendanceController } from './presentation/hrm-attendance.controller.js';
import { HrmDashboardController } from './presentation/hrm-dashboard.controller.js';
import { HrmEmployeeController } from './presentation/hrm-employee.controller.js';
import { HrmLeaveController } from './presentation/hrm-leave.controller.js';
import { HrmPayrollController } from './presentation/hrm-payroll.controller.js';
import { HrmPolicyController } from './presentation/hrm-policy.controller.js';
import { HrmRequestController } from './presentation/hrm-request.controller.js';
import { HrmSalaryController } from './presentation/hrm-salary.controller.js';
import { HrmShiftController } from './presentation/hrm-shift.controller.js';
import { HrmTimesheetController } from './presentation/hrm-timesheet.controller.js';

@Module({
  imports: [PlatformIdentityModule],
  controllers: [
    HrmEmployeeController,
    HrmPolicyController,
    HrmShiftController,
    HrmAttendanceController,
    HrmLeaveController,
    HrmRequestController,
    HrmTimesheetController,
    HrmSalaryController,
    HrmPayrollController,
    HrmDashboardController,
  ],
  providers: [
    PostgresPoolRegistry,
    HrmContextService,
  ],
  exports: [HrmContextService],
})
export class ModuleHrmModule {}
