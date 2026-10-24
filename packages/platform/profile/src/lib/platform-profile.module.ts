import { S3ObjectStorage, tenantStorageOptions } from '@enterprise-platform/adapter-storage';
import { PlatformIdentityModule, TenantCoreAccess } from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

/** Ảnh đại diện và danh bạ công ty của core (xem `ProfileService`). */
@Module({
  imports: [PlatformIdentityModule],
  controllers: [ProfileController],
  providers: [
    {
      provide: ProfileService,
      inject: [TenantCoreAccess],
      // Cùng kho và cùng biến môi trường S3_* với các phân hệ; ảnh nằm dưới `tenants/<id>/core/avatars/`
      // nên xoá tenant là xoá theo.
      useFactory: (access: TenantCoreAccess) =>
        new ProfileService(access, new S3ObjectStorage(tenantStorageOptions())),
    },
  ],
  exports: [ProfileService],
})
export class PlatformProfileModule {}
