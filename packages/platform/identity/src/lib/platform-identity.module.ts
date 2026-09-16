import { Module } from '@nestjs/common';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { TenantDeletionService } from '@enterprise-platform/platform-tenancy/deletion';
import { TenantDeletionController } from './tenant-deletion.controller.js';
import { PlatformAccessController } from './platform-access.controller.js';
import { PlatformIdentityController } from './platform-identity.controller.js';
import { PlatformIdentityService } from './platform-identity.service.js';

@Module({
  controllers: [PlatformIdentityController, PlatformAccessController, TenantDeletionController],
  providers: [PlatformIdentityService, {
    provide: TenantDeletionService,
    useFactory: () => new TenantDeletionService(createPostgresPool(process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform', {
      max: 4, application_name: 'enterprise-platform:tenant-deletion-api',
    })),
  }],
  exports: [PlatformIdentityService],
})
export class PlatformIdentityModule {}
