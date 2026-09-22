import { PlatformDataImportModule } from '@enterprise-platform/platform-data-import';
import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { PlatformTenancyModule } from '@enterprise-platform/platform-tenancy';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    PlatformIdentityModule,
    PlatformDataImportModule,
    PlatformTenancyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
