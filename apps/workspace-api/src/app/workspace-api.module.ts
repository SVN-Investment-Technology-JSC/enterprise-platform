import { WORKSPACE_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-workspace';
import { WorkspaceModule } from '@enterprise-platform/module-workspace';
import { assistantActionsController } from '@enterprise-platform/platform-module-access';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { WorkspaceAccessGuard } from './workspace-access.guard';

@Module({
  imports: [WorkspaceModule],
  controllers: [HealthController, assistantActionsController('workspace', WORKSPACE_ASSISTANT_ACTIONS)],
  providers: [{ provide: APP_GUARD, useClass: WorkspaceAccessGuard }],
})
export class WorkspaceApiModule {}
