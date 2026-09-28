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
import { HrmTimeSettingsController } from './presentation/hrm-time-settings.controller.js';
import { HrmPayrollSettingsController } from './presentation/hrm-payroll-settings.controller.js';
import { HrmProfileCorrectionController } from './presentation/hrm-profile-correction.controller.js';
import { HrmAttachmentController } from './presentation/hrm-attachment.controller.js';
import { HrmCapabilitiesController } from './presentation/hrm-capabilities.controller.js';
import { HrmOperationsController } from './presentation/hrm-operations.controller.js';
import { HrmDependentController } from './presentation/hrm-dependent.controller.js';
import { HrmContractController } from './presentation/hrm-contract.controller.js';

import { HrmProcedureBridgeService } from './infrastructure/hrm-procedure-bridge.service.js';

@Module({
  imports: [PlatformIdentityModule],
  controllers: [
    HrmContractController,
    HrmDependentController,
    HrmCapabilitiesController,
    HrmOperationsController,
    HrmAttachmentController,
    HrmTimeSettingsController,
    HrmPayrollSettingsController,
    HrmProfileCorrectionController,
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
    HrmProcedureBridgeService,
  ],
  exports: [HrmContextService, HrmProcedureBridgeService],
})
export class ModuleHrmModule {}
