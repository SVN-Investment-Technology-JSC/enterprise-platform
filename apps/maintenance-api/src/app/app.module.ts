import { MaintenanceModule } from '@enterprise-platform/module-maintenance';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { MaintenanceIntegrationController } from './maintenance-integration.controller';
import { MaintenanceAccessGuard } from './maintenance-access.guard';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';

@Module({
  imports: [MaintenanceModule],
  controllers: [AppController, MaintenanceIntegrationController],
  providers: [
    TenantOrganizationContextClient,
    { provide: APP_GUARD, useClass: MaintenanceAccessGuard },
  ],
})
export class AppModule {}
