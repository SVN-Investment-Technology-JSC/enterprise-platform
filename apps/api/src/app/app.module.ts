import { ModuleCrmModule } from '@enterprise-platform/module-crm';
import { ModuleInventoryModule } from '@enterprise-platform/module-inventory';
import { PlatformAuthorizationModule } from '@enterprise-platform/platform-authorization';
import { PlatformEntitlementModule } from '@enterprise-platform/platform-entitlement';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { PlatformModuleRegistryModule } from '@enterprise-platform/platform-module-registry';
import { PlatformTenancyModule } from '@enterprise-platform/platform-tenancy';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    PlatformIdentityModule,
    PlatformTenancyModule,
    PlatformAuthorizationModule,
    PlatformEntitlementModule,
    PlatformModuleRegistryModule,
    ModuleCrmModule,
    ModuleInventoryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
