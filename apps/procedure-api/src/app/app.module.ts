import { ProcedureEngineModule } from '@enterprise-platform/module-procedure-engine';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProcedureAccessGuard } from './procedure-access.guard';
import { ProcedureIntegrationController } from './procedure-integration.controller';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';
import { TenantInventoryCatalogClient } from './tenant-inventory-catalog.client';

@Module({
  imports: [ProcedureEngineModule],
  controllers: [AppController, ProcedureIntegrationController],
  providers: [
    AppService,
    TenantOrganizationContextClient,
    TenantInventoryCatalogClient,
    { provide: APP_GUARD, useClass: ProcedureAccessGuard },
  ],
})
export class AppModule {}
