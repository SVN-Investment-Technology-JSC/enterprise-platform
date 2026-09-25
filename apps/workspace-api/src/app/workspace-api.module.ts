import { WorkspaceModule } from '@enterprise-platform/module-workspace';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { WorkspaceAccessGuard } from './workspace-access.guard';

@Module({
  imports: [WorkspaceModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: WorkspaceAccessGuard }],
})
export class WorkspaceApiModule {}
