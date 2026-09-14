import { PlatformIdentityModule } from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { PlatformDataImportController } from './platform-data-import.controller.js';
import { PlatformDataImportService } from './platform-data-import.service.js';

@Module({
  imports: [PlatformIdentityModule],
  controllers: [PlatformDataImportController],
  providers: [PlatformDataImportService],
  exports: [PlatformDataImportService],
})
export class PlatformDataImportModule {}
