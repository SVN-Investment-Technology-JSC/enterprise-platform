import { PROCEDURE_ASSISTANT_ACTIONS } from '@enterprise-platform/contracts-procedure-engine';
import { ProcedureEngineModule } from '@enterprise-platform/module-procedure-engine';
import { assistantActionsController } from '@enterprise-platform/platform-module-access';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProcedureAccessGuard } from './procedure-access.guard';
import { ProcedureIntegrationController } from './procedure-integration.controller';
import { ProcedureDataImportController } from './procedure-data-import.controller';
import { TenantOrganizationContextClient } from './tenant-organization-context.client';
import { TenantInventoryCatalogClient } from './tenant-inventory-catalog.client';

@Module({
  imports: [ProcedureEngineModule],
  controllers: [
    AppController,
    ProcedureIntegrationController,
    ProcedureDataImportController,
    assistantActionsController('procedure-engine', PROCEDURE_ASSISTANT_ACTIONS),
  ],
  providers: [
    AppService,
    TenantOrganizationContextClient,
    TenantInventoryCatalogClient,
    { provide: APP_GUARD, useClass: ProcedureAccessGuard },
  ],
})
export class AppModule {}
