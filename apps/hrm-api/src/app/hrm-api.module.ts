import { HRM_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-hrm';
import { ModuleHrmModule } from '@enterprise-platform/module-hrm';
import { assistantActionsController } from '@enterprise-platform/platform-module-access';
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  imports: [ModuleHrmModule],
  controllers: [HealthController, assistantActionsController('hrm', HRM_ASSISTANT_ACTIONS)],
  providers: [],
})
export class HrmApiModule {}
