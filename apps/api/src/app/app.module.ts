import { ModuleCrmModule } from '@enterprise-platform/module-crm';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { PlatformTenancyModule } from '@enterprise-platform/platform-tenancy';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    PlatformIdentityModule,
    PlatformTenancyModule,
    ModuleCrmModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
