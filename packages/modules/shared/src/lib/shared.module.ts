import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { CompanyDocumentService } from './application/company-document.service.js';
import { FilingService } from './application/filing.service.js';
import { FolderAccessService } from './application/folder-access.js';
import { FolderSharingService } from './application/folder-sharing.service.js';
import { ORGANIZATION_READER, type OrganizationReader } from './application/organization.port.js';
import {
  PLATFORM_LIMITS_READER,
  type PlatformLimitsReader,
} from './application/platform-limits.port.js';
import { SHARED_STORE, type SharedStore } from './application/shared-store.port.js';
import { StorageQuotaService } from './application/storage-quota.service.js';
import { StorageSettingsService } from './application/storage-settings.service.js';
import { HttpOrganizationReader } from './infrastructure/http-organization-reader.js';
import { HttpPlatformLimits } from './infrastructure/http-platform-limits.js';
import { PostgresSharedStore } from './infrastructure/postgres-shared-store.js';
import { TenantStorageRouter } from './infrastructure/tenant-storage-router.js';
import { SharedFilesController } from './presentation/shared-files.controller.js';
import { SharedController } from './presentation/shared.controller.js';

/**
 * Composition root của Hệ dùng chung.
 *
 * Dựng tường minh bằng `useFactory` như `WorkspaceModule`: các lớp là lớp
 * thường, không gắn `@Injectable`. Export hai registry để guard của app đăng
 * ký database của tenant sau mỗi access-decision.
 */
@Module({
  controllers: [SharedController, SharedFilesController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: PostgresSharedStore,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresSharedStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: SHARED_STORE, useExisting: PostgresSharedStore },
    {
      // Một thực thể cho cả app: bộ nhớ đệm hạn mức 60 giây nằm trong nó.
      provide: PLATFORM_LIMITS_READER,
      useFactory: () => new HttpPlatformLimits(),
    },
    {
      provide: StorageQuotaService,
      useFactory: (store: SharedStore, limits: PlatformLimitsReader) =>
        new StorageQuotaService(store, limits),
      inject: [SHARED_STORE, PLATFORM_LIMITS_READER],
    },
    {
      // Một thực thể cho cả app: bản sao 60 giây của sơ đồ tổ chức nằm trong nó.
      provide: ORGANIZATION_READER,
      useFactory: () => new HttpOrganizationReader(),
    },
    {
      provide: FolderAccessService,
      useFactory: (store: SharedStore, organization: OrganizationReader) =>
        new FolderAccessService(store, organization),
      inject: [SHARED_STORE, ORGANIZATION_READER],
    },
    {
      provide: FolderSharingService,
      useFactory: (store: SharedStore, access: FolderAccessService, organization: OrganizationReader) =>
        new FolderSharingService(store, access, organization),
      inject: [SHARED_STORE, FolderAccessService, ORGANIZATION_READER],
    },
    {
      // Một thực thể cho cả app: bộ nhớ đệm cấu hình kho ngoài 30 giây nằm trong nó.
      // Kho của nền tảng dựng từ biến môi trường; kho ngoài theo cấu hình của từng tenant.
      provide: TenantStorageRouter,
      useFactory: (store: SharedStore) => new TenantStorageRouter(store),
      inject: [SHARED_STORE],
    },
    {
      provide: CompanyDocumentService,
      useFactory: (
        store: SharedStore,
        quota: StorageQuotaService,
        access: FolderAccessService,
        storages: TenantStorageRouter,
      ) => new CompanyDocumentService(store, quota, access, storages),
      inject: [SHARED_STORE, StorageQuotaService, FolderAccessService, TenantStorageRouter],
    },
    {
      // Lưu tệp của phân hệ khác (Văn thư) vào kho, qua route nội bộ.
      provide: FilingService,
      useFactory: (store: SharedStore, quota: StorageQuotaService, storages: TenantStorageRouter) =>
        new FilingService(store, quota, storages),
      inject: [SHARED_STORE, StorageQuotaService, TenantStorageRouter],
    },
    {
      provide: StorageSettingsService,
      useFactory: (store: SharedStore, storages: TenantStorageRouter) => new StorageSettingsService(store, storages),
      inject: [SHARED_STORE, TenantStorageRouter],
    },
  ],
  exports: [
    TenantStorageRouter,
    CompanyDocumentService,
    FolderSharingService,
    StorageQuotaService,
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
  ],
})
export class SharedModule {}
