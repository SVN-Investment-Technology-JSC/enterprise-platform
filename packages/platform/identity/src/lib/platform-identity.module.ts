import { Module } from '@nestjs/common';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import { TenantDeletionService } from '@enterprise-platform/platform-tenancy/deletion';
import { TenantDeletionController } from './tenant-deletion.controller.js';
import { PlatformAccessController } from './platform-access.controller.js';
import { PlatformIdentityController } from './platform-identity.controller.js';
import { PlatformIdentityService } from './platform-identity.service.js';
import { TenantLimitsController } from './tenant-limits.controller.js';
import { TenantLimitsService } from './tenant-limits.js';
import { TenantCoreAccess } from './tenant-core-access.js';

@Module({
  controllers: [
    PlatformIdentityController,
    PlatformAccessController,
    TenantDeletionController,
    TenantLimitsController,
  ],
  providers: [PlatformIdentityService, TenantCoreAccess, {
    provide: TenantDeletionService,
    useFactory: () => new TenantDeletionService(createPostgresPool(process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform', {
      max: 4, application_name: 'enterprise-platform:tenant-deletion-api',
    })),
  }, {
    provide: TenantLimitsService,
    useFactory: () => new TenantLimitsService(createPostgresPool(process.env.PLATFORM_DATABASE_URL ?? 'postgresql://platform:platform@localhost:55432/platform', {
      max: 2, application_name: 'enterprise-platform:tenant-limits-api',
    })),
  }],
  exports: [PlatformIdentityService, TenantCoreAccess],
})
export class PlatformIdentityModule {}
