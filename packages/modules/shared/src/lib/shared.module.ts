import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { CompanyDocumentService } from './application/company-document.service.js';
import {
  PLATFORM_LIMITS_READER,
  type PlatformLimitsReader,
} from './application/platform-limits.port.js';
import { SHARED_STORE, type SharedStore } from './application/shared-store.port.js';
import { StorageQuotaService } from './application/storage-quota.service.js';
import { HttpPlatformLimits } from './infrastructure/http-platform-limits.js';
import { PostgresSharedStore } from './infrastructure/postgres-shared-store.js';
import { SharedController } from './presentation/shared.controller.js';

/**
 * Composition root của Hệ dùng chung.
 *
 * Dựng tường minh bằng `useFactory` như `WorkspaceModule`: các lớp là lớp
 * thường, không gắn `@Injectable`. Export hai registry để guard của app đăng
 * ký database của tenant sau mỗi access-decision.
 */
@Module({
  controllers: [SharedController],
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
      // Tham số thứ ba để mặc định: service tự dựng `S3ObjectStorage` từ biến môi trường.
      provide: CompanyDocumentService,
      useFactory: (store: SharedStore, quota: StorageQuotaService) =>
        new CompanyDocumentService(store, quota),
      inject: [SHARED_STORE, StorageQuotaService],
    },
  ],
  exports: [CompanyDocumentService, StorageQuotaService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class SharedModule {}
