import { createPostgresPool } from '@enterprise-platform/adapter-database';
import {
  S3ObjectStorage,
  tenantStorageOptions,
} from '@enterprise-platform/adapter-storage';
import {
  PlatformIdentityModule,
  PlatformIdentityService,
} from '@enterprise-platform/platform-identity';
import { Module } from '@nestjs/common';
import { BRAND_AUTHENTICATOR, BrandController } from './brand.controller.js';
import { BrandIconService } from './brand-icon.service.js';
import {
  createS3BrandObjectStore,
  type BrandObjectStore,
} from './brand-object-store.js';
import type { BrandStore } from './brand-store.js';
import { PgBrandStore } from './pg-brand-store.js';

const BRAND_STORE = 'BRAND_STORE';
const BRAND_OBJECTS = 'BRAND_OBJECTS';

/**
 * Lưu trữ icon thương hiệu: dữ liệu trên MinIO, DB platform chỉ giữ khoá object (xem
 * `docs/architecture/brand-icon-storage.md`). Đọc SVG đã phát hành công khai được tắt bằng
 * `BRAND_ICON_PUBLIC_READ=false`.
 */
@Module({
  imports: [PlatformIdentityModule],
  controllers: [BrandController],
  providers: [
    { provide: BRAND_AUTHENTICATOR, useExisting: PlatformIdentityService },
    {
      provide: BRAND_STORE,
      useFactory: (): BrandStore =>
        new PgBrandStore(
          createPostgresPool(
            process.env.PLATFORM_DATABASE_URL ??
              'postgresql://platform:platform@localhost:55432/platform',
            { max: 3, application_name: 'enterprise-platform:brand-api' },
          ),
        ),
    },
    {
      provide: BRAND_OBJECTS,
      // Cùng kho và cùng biến môi trường S3_* với các phân hệ; chỉ khác tiền tố khoá (`platform/brand/`).
      useFactory: (): BrandObjectStore =>
        createS3BrandObjectStore(new S3ObjectStorage(tenantStorageOptions())),
    },
    {
      provide: BrandIconService,
      useFactory: (store: BrandStore, objects: BrandObjectStore) =>
        new BrandIconService(store, objects, {
          publicRead: () => process.env.BRAND_ICON_PUBLIC_READ !== 'false',
        }),
      inject: [BRAND_STORE, BRAND_OBJECTS],
    },
  ],
  exports: [BrandIconService],
})
export class PlatformBrandModule {}
