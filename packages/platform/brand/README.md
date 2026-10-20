# platform-brand

Lưu trữ icon thương hiệu SVNDTS cho Brand Studio của Platform: tài liệu icon, SVG dựng sẵn và bảng màu/quy chuẩn
nằm trên MinIO; DB platform (`brand_schema`) chỉ giữ khoá object và vài trường tra cứu.

Kiến trúc, khoá object, bảng, API và cách vận hành: [docs/architecture/brand-icon-storage.md](../../../docs/architecture/brand-icon-storage.md).

- `PlatformBrandModule` được nạp trong `apps/api`; controller ở `platform/v1/brand`.
- `BrandIconService` chứa nghiệp vụ, chỉ phụ thuộc hai cổng: `BrandStore` (Postgres, `PgBrandStore`) và
  `BrandObjectStore` (S3/MinIO, `createS3BrandObjectStore`). Test dùng bản giả của hai cổng này.
- Kiểu dùng chung với giao diện web nằm ở `packages/shared/brand-icon/src/lib/api-types.ts`.

Chạy test: `pnpm nx test platform-brand`. Test tích hợp với Postgres thật chỉ chạy khi đặt
`BRAND_TEST_DATABASE_URL` (một database trống, dùng riêng cho test).
