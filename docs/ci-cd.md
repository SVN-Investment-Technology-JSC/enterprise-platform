# CI/CD với GitHub Actions, GHCR và Coolify

Pipeline trong [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml) có hai phần tách biệt:

1. Pull request vào `main` hoặc `dev/release`: workflow luôn validate hai Compose file và deployment manifest. Khi thay đổi chạm vào source/Dockerfile/manifest/migration ảnh hưởng image, CI kiểm tra `nx sync:check`, sau đó Nx chạy `lint`, `typecheck`, `test` cho các project bị ảnh hưởng, `build` cho các thư viện bị ảnh hưởng (build của từng app không chạy lại ở đây vì Dockerfile của app đó đã build chính nó), và chỉ chạy test tích hợp DB/RabbitMQ/Valkey cho các gói có test tích hợp bị ảnh hưởng (3 task song song, giới hạn heap Node để ổn định RAM của GitHub runner). Song song với đó, GitHub Actions build thử với `push: false` các Docker image của app bị ảnh hưởng (gateway luôn được build), chỉ đọc cache (`cache-from: type=registry`) từ GHCR để không ghi đè cache của `dev/release`. Lỗi Dockerfile hoặc production packaging sẽ chặn merge. Workflow checkout toàn bộ lịch sử Git để Nx tính đúng phạm vi thay đổi.
2. Push vào `main` hoặc `dev/release`: chỉ khi thay đổi chạm vào input image, job `build-images` chạy **song song** với `validate` để build/push image Linux/amd64 vào GHCR package `enterprise-platform` với tag bất biến `<service>-sha-<commit>` (dùng GHCR registry cache `buildcache-<service>` và truyền `NX_CLOUD_ACCESS_TOKEN` vào Docker BuildKit). Chỉ service có code đổi so với image `-production` hiện tại mới được build lại. Sau khi cả `validate`, `validate-deployment` và `build-images` đều xanh, job `promote-production` mới gắn đồng loạt tag `<service>-sha-<commit>` cho service không đổi (`docker buildx imagetools create`, chạy song song) và nâng tag `<service>-production` nguyên tử cho tất cả service vừa build. Thay đổi chỉ ở Docker Compose hoặc docs không build/push image; sau merge chỉ cần bấm Deploy thủ công trong Coolify hoặc chạy workflow `Deploy production via Coolify`.
3. GitHub Actions **không tự động deploy khi merge**. Khi muốn cập nhật VPS, có thể bấm Deploy/Redeploy trực tiếp trên Coolify hoặc dùng workflow [`deploy-production.yml`](../.github/workflows/deploy-production.yml) (kích hoạt bằng nút **Run workflow** trên GitHub, đi qua bước duyệt `Required Reviewers` của environment `production`).

Input image gồm `apps/**`, `packages/**`, `migrations/**`, `.dockerignore`, các lockfile/workspace config, deployment manifest và `infrastructure/nginx/**`. Chỉ thay đổi `infrastructure/docker/**`, docs hoặc cấu hình Coolify không thuộc nhóm này sẽ bỏ qua Nx và các Docker build jobs; các Compose file vẫn luôn được kiểm tra cú pháp bằng `docker compose config`. Các Dockerfile sử dụng `HEALTHCHECK --start-period=25s --start-interval=2s` để container báo sẵn sàng nhanh hơn khi khởi động trên VPS, kết hợp tách riêng layer `node_modules` để Coolify chỉ kéo lại lớp code thay đổi.

Image gateway được build từ `infrastructure/nginx/Dockerfile`; nó đóng gói Nginx config và maintenance pages nên VPS không cần bind-mount source repository.

## Deployment manifest (Giai đoạn 1)

[`tools/deployment/services.json`](../tools/deployment/services.json) là nguồn chuẩn cho danh sách service có Docker image. GitHub Actions chạy [`tools/deployment/ci-matrix.mjs`](../tools/deployment/ci-matrix.mjs) để kiểm tra manifest và tạo matrix động cho cả Docker verification trên PR lẫn GHCR publish sau merge.

`imageRepository` là tên GHCR package dùng chung; mỗi service khai báo `id` và đường dẫn `dockerfile`. Service Node.js có thể thêm `runtimeCheck.nodeModules`: danh sách module bắt buộc phải resolve được trong image sau build. Khi thêm một service mới, thêm object tương ứng vào `services.json`, rồi chạy:

```bash
pnpm deploy:services:matrix
```

Script sẽ từ chối service trùng id, image repository sai quy ước hoặc Dockerfile không tồn tại. Giai đoạn 1 chỉ tự động hóa CI image matrix; Docker Compose production và Nginx routes vẫn được khai báo thủ công để tránh generator tác động đến networking, environment và dependency runtime.

`infrastructure/docker/compose.coolify.yml` chỉ dùng `image:`, không có `build:`. Đây là Compose production cho một Coolify Service Stack: Coolify kéo image đã được GitHub Actions tạo ra, chạy migrator one-shot trước API/web/worker, và chỉ expose gateway qua domain.

## 1. Chuẩn bị GitHub Container Registry

Sau lần workflow đầu tiên publish thành công, vào GitHub organization **SVN-Investment-Technology-JSC** > Packages để kiểm tra một package private duy nhất: `enterprise-platform`. Mỗi service có một tag `*-production` và các tag `*-sha-<commit>` (một tag cho mỗi commit đã publish; service không đổi dùng chung image với các commit trước).

Ví dụ:

```text
ghcr.io/svn-investment-technology-jsc/enterprise-platform:api-production
ghcr.io/svn-investment-technology-jsc/enterprise-platform:web-production
ghcr.io/svn-investment-technology-jsc/enterprise-platform:api-sha-<commit>
```

Các package cũ `enterprise-platform-*` không còn được workflow hoặc Compose tham chiếu. Vì VPS/Coolify chưa được cấu hình, có thể xóa chúng ngay trong GitHub Organization > Packages; không cần giữ lại để rollback.

GitHub Actions đã có quyền tối thiểu `packages: write` qua `GITHUB_TOKEN`; không tạo PAT để push image. Label OCI `org.opencontainers.image.source` cũng được gắn để liên kết image với repository.

## 2. Chuẩn bị VPS/Coolify để pull private image

Tạo GitHub classic PAT dành riêng cho VPS, chỉ cấp scope `read:packages`, và authorize SSO nếu organization yêu cầu. SSH vào VPS bằng đúng user Docker mà Coolify dùng, rồi đăng nhập một lần:

```bash
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io \
  --username YOUR_GITHUB_USERNAME --password-stdin
```

Không dùng PAT có quyền `repo`, `write:packages` hoặc quyền quản trị cho VPS. Lệnh trên chỉ ghi Docker credential trên VPS; không đưa token vào Git repository hay vào Coolify runtime variables.

## 3. Tạo Service Stack trong Coolify

1. Trong Coolify, tạo Project > Environment `production` > New Resource > Docker Compose.
2. Kết nối repository GitHub để Coolify có thể đọc file Compose. Chọn branch `dev/release` (branch mặc định hiện tại) và Compose file `infrastructure/docker/compose.coolify.yml`.
3. Tắt Git auto-deploy của resource. Deployment được thực hiện thủ công từ Coolify sau khi bạn xác nhận image `production` đã được publish.
4. Trong Domains, gán domain public cho service `gateway`, port `80`. Không gán domain/port cho bất kỳ service nào khác.
5. Không bật `Connect to Predefined Network` trừ khi database được vận hành ở stack khác; các service trong cùng stack đã giao tiếp qua DNS service name.

## 4. Khai báo biến môi trường trong Coolify

Thêm các runtime variables sau vào Service Stack. Các biến có `${VAR:?}` trong Compose là bắt buộc; Coolify sẽ chặn deployment nếu thiếu.

| Variable                   | Cách tạo / yêu cầu                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PLATFORM_DB_PASSWORD`     | Password mạnh, URL-safe.                                                                              |
| `TENANT_DB_PASSWORD`       | Password mạnh, URL-safe.                                                                              |
| `RABBITMQ_PASSWORD`        | Password mạnh, URL-safe.                                                                              |
| `MINIO_ROOT_USER`          | Tài khoản root của MinIO trong stack (chỉ MinIO dùng).                                                |
| `MINIO_ROOT_PASSWORD`      | Password MinIO mạnh.                                                                                  |
| `S3_ACCESS_KEY_ID`         | Khoá kho tệp mà các service dùng. Dùng MinIO trong stack thì đặt bằng `MINIO_ROOT_USER`.              |
| `S3_SECRET_ACCESS_KEY`     | Secret đi cùng. Dùng MinIO trong stack thì đặt bằng `MINIO_ROOT_PASSWORD`.                            |
| `S3_PUBLIC_ENDPOINT`       | Địa chỉ HTTPS của kho tệp mà trình duyệt mở (URL ký sẵn).                                             |
| `S3_INTERNAL_ENDPOINT`     | Tuỳ chọn. Địa chỉ server gọi kho; mặc định `http://minio:9000`. Kho ngoài thì đặt cùng địa chỉ công khai. |
| `S3_BUCKET`, `S3_REGION`   | Tuỳ chọn. Mặc định `enterprise-platform` / `us-east-1`; kho ngoài thì đặt theo bucket đã tạo ở nhà cung cấp. |
| `SEED_SUPERADMIN_PASSWORD` | Password ban đầu cho Platform Super Admin. Lưu ý: migrator hiện cập nhật password này mỗi lần deploy. |
| `INTERNAL_SERVICE_TOKEN`   | Random secret dài, dùng chung giữa các service.                                                       |
| `AUTH_PRIVATE_KEY`         | PEM private key RS256, multiline runtime secret.                                                      |
| `AUTH_PUBLIC_KEY`          | PEM public key RS256 tương ứng, multiline runtime secret.                                             |
| `IMAGE_TAG`                | Đặt `production`. Khi rollback, đặt `sha-<commit>`; Compose tự ghép thành tag như `api-sha-<commit>`. |

Tạo cặp RS256 một lần trên máy tin cậy, lưu vào password manager rồi dán vào Coolify dưới dạng multiline secret:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out auth-private.pem
openssl rsa -pubout -in auth-private.pem -out auth-public.pem
```

Không thay đổi cặp key tùy tiện: JWT hiện hữu sẽ không còn xác minh được. Backup volumes của PostgreSQL, RabbitMQ và MinIO trước khi vận hành production.

> **Lưu ý tạm thời về MinIO:** Compose hiện pin `quay.io/minio/minio:RELEASE.2023-10-25T06-33-25Z` để tương thích VPS không hỗ trợ CPU `x86-64-v2`. Đây chỉ là giải pháp để thử nghiệm/khởi động hệ thống; trước khi lưu dữ liệu production, hãy chuyển sang VPS CPU hiện đại và MinIO có bản vá, hoặc dùng S3 bên ngoài.

## 5. Deploy thủ công từ Coolify hoặc GitHub Actions (có duyệt)

Sau khi workflow của `main` hoặc `dev/release` thành công (cả `build-images` và `promote-production` đều xanh), kiểm tra package GHCR có đủ tag `*-production` mới rồi chọn một trong hai cách sau (hai cách kích hoạt cùng một quy trình deploy của Coolify):

1. **Bấm trên Coolify:** Vào Service Stack production trong Coolify và bấm **Deploy** hoặc **Redeploy**. Coolify sẽ pull các tag `*-production` tương ứng và chạy `migrator` trước API/web/worker.
2. **Bấm trên GitHub Actions (có `Required Reviewers`):** Vào **Actions > Deploy production via Coolify > Run workflow**, giữ `image_tag=production` (hoặc nhập `sha-<40-hex-commit>` để rollback) rồi xác nhận duyệt qua GitHub Environment `production`. Cần cấu hình các secrets trong Environment `production`:
   - `COOLIFY_PRODUCTION_WEBHOOK`: URL Deploy Webhook của Service Stack trên Coolify.
   - `COOLIFY_PRODUCTION_TOKEN`: API token của Coolify dùng cho cả webhook và cập nhật biến môi trường.
   - `COOLIFY_API_URL` và `COOLIFY_APP_UUID`: địa chỉ gốc API Coolify và UUID của resource Compose (dùng để cập nhật `IMAGE_TAG` khi rollback/ghim commit).

## 6. Dọn version image cũ trên GHCR

Workflow [`.github/workflows/ghcr-cleanup.yml`](../.github/workflows/ghcr-cleanup.yml) chạy vào 02:30 UTC mỗi Chủ nhật. Nó dọn package `enterprise-platform` theo các quy tắc an toàn sau:

- Không xóa bất kỳ tag `*-production` nào.
- Giữ 10 tag `*-sha-<commit>` mới nhất của **mỗi** service để rollback.
- Chỉ xóa version có tag SHA cũ thuộc service trong deployment manifest; không đụng tag lạ hoặc version untagged.

Trước khi dựa vào schedule, vào **Actions > Clean up old GHCR image versions > Run workflow**, giữ `dry_run=true` để xem danh sách dự kiến xóa. Sau khi kiểm tra, chạy tay lần nữa với `dry_run=false`. Có thể điều chỉnh số bản rollback giữ lại qua `retain_per_service`; mặc định là `10`.

Workflow cần `packages: write` và package `enterprise-platform` phải được link với repository. Pipeline publish đã gắn OCI source label để GitHub liên kết package tự động. Nếu cleanup báo `403`, vào Package settings > Manage Actions access và cấp repository quyền **Admin** cho package.

## 7. Kiểm tra release đầu tiên

1. Push/merge một commit vào `main` hoặc `dev/release`.
2. Trên pull request, xác nhận `PR validation complete` thành công trước khi merge. Check tổng hợp này luôn yêu cầu `Detect CI scope`, `Create deployment matrix` và `Validate deployment configuration`. Khi PR thay đổi input image, nó còn yêu cầu `Validate affected projects` và toàn bộ 11 job `Verify container …` đều thành công.
3. Nếu thay đổi có chạm vào input image, xác nhận toàn bộ các job `Build image …` và job `Promote production tags` đều thành công trên GHCR. Với thay đổi chỉ ở Compose/docs, các job này bị skip là đúng.
4. Mở Coolify, bấm Deploy/Redeploy stack production và theo dõi `migrator` hoàn tất trước khi API/web khởi động.
5. Mở domain gateway, đăng nhập bằng `superadmin@platform.local` cùng `SEED_SUPERADMIN_PASSWORD`, và tạo tenant đầu tiên từ Platform Admin.

## 8. Bảo vệ nhánh trên GitHub

Tạo branch protection rule riêng cho `main` và `dev/release` với các lựa chọn sau:

1. Bật **Require a pull request before merging**.
2. Bật **Require status checks to pass before merging** và chỉ chọn check `PR validation complete`.
3. Bật **Require branches to be up to date before merging**.

Không chọn `Build image …` hay `Promote production tags`: các job này cố ý bị bỏ qua trên pull request và chỉ chạy sau khi merge để push image lên GHCR. Không cần chọn các check `Verify container …` riêng lẻ, vì chúng đã được `PR validation complete` kiểm tra đầy đủ.

## Rollback

Để rollback image, tìm commit SHA tốt gần nhất trên Actions/GHCR, đặt `IMAGE_TAG=sha-<commit-sha>` trong Coolify, lưu và deploy lại resource. Compose sẽ pull các tag cùng release như `api-sha-<commit>`, `web-sha-<commit>` và `gateway-sha-<commit>`, nên rollback giữ được phiên bản đồng bộ. Migration trong repository phải luôn có tính tương thích ngược; không rollback schema bằng cách xóa volume hoặc sửa migration đã được áp dụng.

## Nx Cloud (tùy chọn)

Workflow đã cache `.nx/cache` qua GitHub Actions. Khi CI bắt đầu chậm hoặc có nhiều nhánh/runner, kết nối Nx Cloud để remote cache dùng được giữa các workflow và runner. Không cần Nx Cloud để pipeline hoạt động; GitHub Actions vẫn là nơi build/push/deploy.
