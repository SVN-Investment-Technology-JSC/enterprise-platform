import { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { Module } from '@nestjs/common';
import { CorrespondenceService } from './application/correspondence.service.js';
import {
  CORRESPONDENCE_STORE,
  FILE_STORE,
  ORGANIZATION_READER,
  type CorrespondenceStore,
  type FileStore,
  type OrganizationReader,
} from './application/ports.js';
import { HttpFileStore } from './infrastructure/http-file-store.js';
import { HttpOrganizationReader } from './infrastructure/http-organization-reader.js';
import { PostgresCorrespondenceStore } from './infrastructure/postgres-correspondence-store.js';
import { CorrespondenceController } from './presentation/correspondence.controller.js';

/**
 * Composition root của Văn thư, dựng tường minh bằng `useFactory` như Hệ dùng chung.
 * Export hai registry để guard của app đăng ký database của tenant sau mỗi access-decision.
 */
@Module({
  controllers: [CorrespondenceController],
  providers: [
    TenantDatabaseRegistry,
    PostgresPoolRegistry,
    {
      provide: CORRESPONDENCE_STORE,
      useFactory: (references: TenantDatabaseRegistry, pools: PostgresPoolRegistry) =>
        new PostgresCorrespondenceStore(references, pools),
      inject: [TenantDatabaseRegistry, PostgresPoolRegistry],
    },
    { provide: FILE_STORE, useFactory: () => new HttpFileStore() },
    // Một thực thể cho cả app: bản sao 60 giây của sơ đồ tổ chức nằm trong nó.
    { provide: ORGANIZATION_READER, useFactory: () => new HttpOrganizationReader() },
    {
      provide: CorrespondenceService,
      useFactory: (store: CorrespondenceStore, files: FileStore, organization: OrganizationReader) =>
        new CorrespondenceService(store, files, organization),
      inject: [CORRESPONDENCE_STORE, FILE_STORE, ORGANIZATION_READER],
    },
  ],
  exports: [CorrespondenceService, TenantDatabaseRegistry, PostgresPoolRegistry],
})
export class CorrespondenceModule {}
