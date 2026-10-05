import { PostgresPoolRegistry } from '@enterprise-platform/adapter-database';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HrmAccessGuard } from './infrastructure/hrm-access.guard.js';
import { HrmPayrollSodController } from './presentation/hrm-payroll-sod.controller.js';
import { HrmApprovalPolicyService } from './infrastructure/hrm-approval-policy.js';
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
import { HrmProfileDocumentController } from './presentation/hrm-profile-document.controller.js';
import { HrmCapabilitiesController } from './presentation/hrm-capabilities.controller.js';
import { HrmApprovalPolicySettingsController } from './presentation/hrm-approval-policy-settings.controller.js';
import { HrmOperationsController } from './presentation/hrm-operations.controller.js';
import { HrmDependentController } from './presentation/hrm-dependent.controller.js';
import { HrmContractController } from './presentation/hrm-contract.controller.js';
import { HrmPersonnelDecisionController } from './presentation/hrm-personnel-decision.controller.js';

import { HrmProcedureBridgeService } from './infrastructure/hrm-procedure-bridge.service.js';
import { OrgHrmBridgeConsumer } from './infrastructure/org-hrm-bridge.consumer.js';

@Module({
  imports: [PlatformIdentityModule],
  controllers: [
    HrmPersonnelDecisionController,
    HrmPayrollSodController,
    HrmContractController,
    HrmDependentController,
    HrmCapabilitiesController,
    HrmOperationsController,
    HrmApprovalPolicySettingsController,
    HrmAttachmentController,
    HrmProfileDocumentController,
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
    HrmApprovalPolicyService,
    { provide: APP_GUARD, useClass: HrmAccessGuard },
    HrmProcedureBridgeService,
    OrgHrmBridgeConsumer,
  ],
  exports: [HrmContextService, HrmApprovalPolicyService, HrmProcedureBridgeService, OrgHrmBridgeConsumer],
})
export class ModuleHrmModule {}
