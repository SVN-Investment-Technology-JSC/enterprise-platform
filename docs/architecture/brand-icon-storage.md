# Lưu trữ icon thương hiệu (Brand Studio)

Icon thương hiệu SVNDTS do Brand Studio (`/platform/brand-studio`) thiết kế được lưu trên MinIO; DB platform chỉ giữ
khoá object và vài trường tra cứu. Code ở `packages/platform/brand` (`@enterprise-platform/platform-brand`), nạp vào
`apps/api`; kiểu dùng chung với giao diện ở `packages/shared/brand-icon/src/lib/api-types.ts`.

## Kiến trúc

```
Brand Studio (web) ──/api/platform/v1/brand──> nginx ──> apps/api ── BrandController
                                                                        │
                                                          BrandIconService (nghiệp vụ)
                                                           │                      │
                                                    BrandStore (cổng)     BrandObjectStore (cổng)
                                                     PgBrandStore           S3ObjectStorage (adapter-storage)
                                                           │                      │
                                              Postgres platform             MinIO (bucket S3_BUCKET)
                                              schema brand_schema           tiền tố platform/brand/
```

- Server là nơi duy nhất dựng SVG: client chỉ gửi mô hình `IconDocument`, server chuẩn hoá (`normalizeDocument`) rồi
  gọi `generateSvg`. Không có đường nhận SVG thô.
- Dùng lại `S3ObjectStorage` và các biến `S3_*` như các phân hệ. Adapter được thêm cổng đọc `ObjectStorageReadPort`
  (`getObject`, có giới hạn `maxBytes`) cùng `ObjectNotFoundError`, `ObjectTooLargeError`.

## Khoá object

Nằm ngoài `tenants/` nên xoá tenant (chỉ purge `tenants/<tenantId>/`) không đụng tới.

| Khoá | Nội dung |
|---|---|
| `platform/brand/icons/<id>/v<N>/spec.json` | Tài liệu `IconDocument` đã chuẩn hoá, nguồn để mở lại sửa (`status` luôn `draft`) |
| `platform/brand/icons/<id>/v<N>/icon.svg` | SVG chế độ màu thương hiệu, ghi cứng màu theo bảng màu hiện hành lúc lưu |
| `platform/brand/icons/<id>/v<N>/icon.mono.svg` | SVG chế độ `currentColor` |
| `platform/brand/standards/v<N>.json` | `{ schema, palette, rules }` |

Mỗi lần lưu là phiên bản mới; object đã ghi không bao giờ bị ghi đè hay sửa. `<id>` luôn qua mẫu
`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` trước khi dựng khoá, nên không thoát được khỏi tiền tố.

## Bảng (`brand_schema`, migration `migrations/platform/0010-brand-icon-storage.sql`)

DB không chứa path, màu hay hình; chỉ khoá object, mã băm và các trường tra cứu.

- `icons`: `id` (text, khoá chính, do client tạo), `slug` (duy nhất, dẫn từ tên lúc tạo, không đổi khi đổi tên),
  `name`, `category`, `status` (`draft`/`published`/`archived`), `tags`, `current_version`, `published_version`,
  `created_by`, `created_at`, `updated_at`. Ràng buộc: `status = 'published'` khi và chỉ khi `published_version` có
  giá trị và không vượt `current_version`.
- `icon_versions`: một dòng mỗi lần lưu: `icon_id`, `version` (duy nhất theo `icon_id`), `spec_key`, `svg_key`,
  `mono_svg_key` (đều phải bắt đầu bằng `platform/brand/icons/`), `spec_sha256`, `size_bytes`, `standards_version`
  (phiên bản bảng màu đã dùng dựng `icon.svg`; 0 là mặc định), `note`, `created_by`, `created_at`.
- `standards`: một dòng (`id = 1`) trỏ tới phiên bản hiện hành của bảng màu và quy chuẩn. `current_version = 0` là chưa
  lưu lần nào, API trả `DEFAULT_PALETTE` và `DEFAULT_RULES`. Các phiên bản cũ chỉ còn dưới dạng object.

So với thiết kế ban đầu: thêm `icons.published_version` và `icon_versions.standards_version`, và gộp
`standards_versions` vào `standards` (lịch sử đã có ở object và `audit_schema.audit_logs`).

## API (`/api/platform/v1/brand`)

Mọi API quản trị chỉ cho platform-admin (kiểm ở server qua `PlatformIdentityService.verifyAccessToken`, cookie
`ep_access` hoặc Bearer). Request ghi cần thêm `x-csrf-token` bằng cookie `ep_csrf`. Lỗi trả về
`{ statusCode, code, message }` với `message` tiếng Việt; mã lỗi ở `BRAND_ERROR_CODES`.

| Phương thức và đường dẫn | Việc |
|---|---|
| `GET icons?status=draft,published` | Danh sách tóm tắt (mặc định mọi trạng thái) |
| `GET icons/:id` | Tóm tắt và danh sách phiên bản, mới nhất trước |
| `GET icons/:id/spec?version=` | `{ document, version, specSha256, iconStatus }`; không có `version` là bản mới nhất |
| `POST icons` `{ document, note? }` | Tạo icon ở phiên bản 1 (201) |
| `PUT icons/:id` `{ document, baseVersion, note? }` | Lưu phiên bản mới |
| `POST icons/:id/publish`, `/unpublish` | Phát hành phiên bản hiện hành, hoặc gỡ |
| `DELETE icons/:id`, `POST icons/:id/restore` | Lưu trữ (không xoá object), khôi phục về nháp |
| `GET icons/:id/svg?v=<N>&mode=brand\|mono` | SVG dựng sẵn; bản đã phát hành đọc công khai |
| `GET standards`, `PUT standards` `{ palette, rules, baseVersion }` | Bảng màu và quy chuẩn |

Quy tắc đáng chú ý:

- `PUT icons/:id`: `baseVersion` lệch bản hiện hành thì `409 BRAND_ICON_VERSION_CONFLICT` kèm `currentVersion`. Nếu nội
  dung (không tính `status`, `createdAt`, `updatedAt`) trùng `spec_sha256` của bản hiện hành và cùng phiên bản quy
  chuẩn thì không tạo phiên bản, trả bản hiện hành với `unchanged: true` (kể cả khi `baseVersion` cũ, để gửi lại sau
  khi mất phản hồi không báo xung đột).
- Phát hành ghim `published_version = current_version`; lưu thêm bản mới không làm bản công khai đổi cho tới khi phát
  hành lại (`hasUnpublishedChanges`). Icon còn lỗi nặng theo `checkCompliance` (chưa có hình hiển thị) bị chặn
  `422 BRAND_ICON_NOT_PUBLISHABLE`; cảnh báo thì không chặn. Icon đã lưu trữ phải khôi phục trước.
- `PUT standards`: màu sai khoá hoặc sai mã bị từ chối (không lặng lẽ thay bằng bảng màu mặc định). Đổi bảng màu không
  viết lại SVG cũ; lưu lại icon (dù nội dung cũ) sẽ dựng phiên bản mới với bảng màu mới.
- Giới hạn: tài liệu sau chuẩn hoá tối đa 512 KB (`413`), tối đa `LIMITS.maxIcons` icon, thân JSON tối đa 1 MB
  (`apps/api/src/main.ts`, mặc định của Express là 100 KB).

## Luồng ghi

1. Kiểm quyền, CSRF; `normalizeDocument` làm sạch và giới hạn đầu vào (trả null thì `400 BRAND_ICON_INVALID`).
2. Đọc quy chuẩn hiện hành (có bộ nhớ đệm theo phiên bản vì object bất biến), dựng `spec.json`, `icon.svg`,
   `icon.mono.svg`, tính sha256 của JSON ổn định (khoá đã sắp thứ tự).
3. Mở giao dịch DB và khoá hàng icon (`SELECT ... FOR UPDATE`); tạo mới thì chèn hàng icon trước. Kiểm
   `baseVersion` và sha.
4. Ghi ba object tuần tự dưới khoá phiên bản mới, rồi chèn `icon_versions`, cập nhật `icons`, ghi
   `audit_schema.audit_logs`, chốt giao dịch.

Thứ tự này (khoá hàng trước, ghi object trong lúc giữ khoá, chốt sau cùng) khác với "ghi object rồi mới mở giao dịch"
vì hai người lưu cùng lúc sẽ ghi cùng một khoá `v<N+1>`: người thua sẽ ghi đè rồi khi dọn lại xoá mất object của người
thắng. Giữ khoá hàng thì mỗi số phiên bản chỉ có một người ghi. Hệ quả: một kết nối DB và khoá hàng của đúng icon đó
được giữ trong lúc ghi object (vài chục mili giây); người chờ khoá quá 10 giây nhận `409 BRAND_ICON_BUSY`.

Lỗi trước khi hoàn tất công việc thì hoàn tác giao dịch và xoá các object vừa ghi (cố gắng, không che lỗi gốc). Lỗi ở
bước chốt giao dịch thì giữ nguyên object, vì không rõ đã chốt chưa; dư một object mồ côi còn hơn mất dữ liệu đã chốt.
DB không bao giờ trỏ tới object chưa ghi.

## Luồng đọc SVG

- Bản đang phát hành (icon `published`, phiên bản không vượt `published_version`) đọc công khai, không kiểm tra phiên.
  Đặt `BRAND_ICON_PUBLIC_READ=false` (mặc định `true`) thì mọi người phải đăng nhập.
- Bản nháp, bản lưu trữ và phiên bản mới hơn bản phát hành chỉ platform-admin đọc được; khách và người dùng tenant nhận
  `404` như icon không tồn tại. Không có `v`: bản đang phát hành nếu có, nếu không (chỉ quản trị) là bản mới nhất.
- Máy chủ đọc object qua địa chỉ nội bộ (`S3_INTERNAL_ENDPOINT`) rồi trả về; không phát URL ký sẵn.
- Header: `Content-Type: image/svg+xml`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, `Content-Disposition: inline`,
  `ETag` suy ra từ `spec_sha256`, chế độ và phiên bản quy chuẩn (nên `If-None-Match` trả 304 mà không đọc MinIO).
  `Cache-Control`: có `v` thì `public, max-age=31536000, immutable` (bản công khai) hoặc `private, ...` (bản nháp);
  không có `v` thì `public, max-age=300` hoặc `private, no-cache`. Bản công khai đã được cache theo `v` sẽ không bị thu
  hồi khi gỡ phát hành.

## Quyết định bảo mật

- Kiểm quyền ở API, không dựa vào giao diện. Nhật ký kiểm toán cho mọi thay đổi (`platform.brand-icon.*`,
  `platform.brand-standards.updated`).
- Không nhận SVG thô; SVG sinh ra chỉ chứa thuộc tính từ mô hình đã chuẩn hoá (màu qua danh sách trắng, số bị chặn
  khoảng, tên icon trong chú thích được lọc `<`, `>`, `--`). CSP và `nosniff` là lớp phòng thủ thứ hai.
- Mã icon và phiên bản được kiểm trước khi dựng khoá object hay truy vấn; ràng buộc `CHECK` ở DB chặn khoá không nằm
  dưới `platform/brand/`.
- Lỗi lạ chỉ ghi vào nhật ký máy chủ, client nhận thông điệp chung (không lộ chuỗi kết nối hay chi tiết kho).
  Mất kết nối DB trả `503 BRAND_DATABASE_UNAVAILABLE`, kho không dùng được trả `503 BRAND_STORAGE_UNAVAILABLE`.

## Vận hành

- Migration `0010-brand-icon-storage` được `apps/migrator` chạy cùng các migration platform khác; chạy lại được.
- Biến môi trường: `PLATFORM_DATABASE_URL`; `S3_INTERNAL_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY` (service `api` đã có qua `tenant-deletion-environment` trong compose); tuỳ chọn
  `BRAND_ICON_PUBLIC_READ`. Nginx đã proxy `/api/platform/`, không cần cấu hình thêm.
- Sao lưu cả hai nơi: schema `brand_schema` và tiền tố `platform/brand/` của bucket. Đừng đặt lifecycle xoá hoặc hết hạn
  cho tiền tố này.
- Object mồ côi (dọn lỗi hoặc lỗi lúc chốt giao dịch) vô hại và không có dòng DB trỏ tới; dọn tay bằng cách so
  `platform/brand/icons/<id>/v<N>/` với `icon_versions`.
- Test: `pnpm nx test platform-brand` (kho và DB giả). Test với Postgres thật tự bỏ qua trừ khi đặt
  `BRAND_TEST_DATABASE_URL` (database trống dùng riêng cho test):
  `BRAND_TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/brand_test pnpm nx test platform-brand`.
