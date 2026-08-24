# CI/CD với GitHub Actions, GHCR và Coolify

Pipeline trong [`.github/workflows/ci-cd.yml`](../.github/workflows/ci-cd.yml) có hai phần tách biệt:

1. Pull request vào `main` hoặc `dev/release`: Nx chạy `lint`, `typecheck`, `test` và `build` cho các project bị ảnh hưởng; sau đó GitHub Actions build đầy đủ 11 Docker image với `push: false`. Lỗi Dockerfile hoặc production packaging sẽ chặn merge. Workflow checkout toàn bộ lịch sử Git để Nx tính đúng phạm vi thay đổi.
2. Push vào `main` hoặc `dev/release`: sau quality gate, GitHub Actions build/push 11 image Linux/amd64 vào một GHCR package `enterprise-platform`. Mỗi service có tag bất biến `<service>-sha-<commit>` và tag deploy `<service>-production`.
3. GitHub Actions **không tự gọi Coolify**. Khi muốn cập nhật VPS, mở Coolify và bấm Deploy/Redeploy cho stack production.

Image gateway được build từ `infrastructure/nginx/Dockerfile`; nó đóng gói Nginx config và maintenance pages nên VPS không cần bind-mount source repository.

## Deployment manifest (Giai đoạn 1)

[`tools/deployment/services.json`](../tools/deployment/services.json) là nguồn chuẩn cho danh sách service có Docker image. GitHub Actions chạy [`tools/deployment/ci-matrix.mjs`](../tools/deployment/ci-matrix.mjs) để kiểm tra manifest và tạo matrix động cho cả Docker verification trên PR lẫn GHCR publish sau merge.

`imageRepository` là tên GHCR package dùng chung; mỗi service chỉ khai báo `id` và đường dẫn `dockerfile`. Khi thêm một service mới, thêm object tương ứng vào `services.json`, rồi chạy:

```bash
pnpm deploy:services:matrix
```

Script sẽ từ chối service trùng id, image repository sai quy ước hoặc Dockerfile không tồn tại. Giai đoạn 1 chỉ tự động hóa CI image matrix; Docker Compose production và Nginx routes vẫn được khai báo thủ công để tránh generator tác động đến networking, environment và dependency runtime.

`infrastructure/docker/compose.coolify.yml` chỉ dùng `image:`, không có `build:`. Đây là Compose production cho một Coolify Service Stack: Coolify kéo image đã được GitHub Actions tạo ra, chạy migrator one-shot trước API/web/worker, và chỉ expose gateway qua domain.

## 1. Chuẩn bị GitHub Container Registry

Sau lần workflow đầu tiên publish thành công, vào GitHub organization **SVN-Investment-Technology-JSC** > Packages để kiểm tra một package private duy nhất: `enterprise-platform`. Package có 22 tag cho 11 service: mỗi service có một tag `*-production` và một tag `*-sha-<commit>`.

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
| `MINIO_ROOT_USER`          | Tài khoản MinIO production.                                                                           |
| `MINIO_ROOT_PASSWORD`      | Password MinIO mạnh.                                                                                  |
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

## 5. Deploy thủ công từ Coolify

Sau khi workflow của `main` hoặc `dev/release` thành công, kiểm tra package GHCR có đủ tag `*-production` mới rồi vào Service Stack production trong Coolify và bấm **Deploy** hoặc **Redeploy**. Coolify sẽ pull lại 11 image tag tương ứng, ví dụ `api-production`, `web-production` và `gateway-production`.

Job `deploy-production` được giữ ở dạng comment trong workflow để có thể bật tự động deploy sau này. Khi cần bật lại, uncomment job đó rồi thêm hai GitHub Actions secrets `COOLIFY_PRODUCTION_WEBHOOK` và `COOLIFY_PRODUCTION_TOKEN` theo Coolify Deploy Webhook/API token.

## 6. Dọn version image cũ trên GHCR

Workflow [`.github/workflows/ghcr-cleanup.yml`](../.github/workflows/ghcr-cleanup.yml) chạy vào 02:30 UTC mỗi Chủ nhật. Nó dọn package `enterprise-platform` theo các quy tắc an toàn sau:

- Không xóa bất kỳ tag `*-production` nào.
- Giữ 10 tag `*-sha-<commit>` mới nhất của **mỗi** service để rollback.
- Chỉ xóa version có tag SHA cũ thuộc service trong deployment manifest; không đụng tag lạ hoặc version untagged.

Trước khi dựa vào schedule, vào **Actions > Clean up old GHCR image versions > Run workflow**, giữ `dry_run=true` để xem danh sách dự kiến xóa. Sau khi kiểm tra, chạy tay lần nữa với `dry_run=false`. Có thể điều chỉnh số bản rollback giữ lại qua `retain_per_service`; mặc định là `10`.

Workflow cần `packages: write` và package `enterprise-platform` phải được link với repository. Pipeline publish đã gắn OCI source label để GitHub liên kết package tự động. Nếu cleanup báo `403`, vào Package settings > Manage Actions access và cấp repository quyền **Admin** cho package.

## 7. Kiểm tra release đầu tiên

1. Push/merge một commit vào `main` hoặc `dev/release`.
2. Trên pull request, xác nhận `PR validation complete` thành công trước khi merge. Check tổng hợp này chỉ thành công khi `Validate affected projects`, `Create deployment matrix` và toàn bộ 11 job `Verify container …` đều thành công.
3. Sau merge, xác nhận 11 matrix jobs `Build and publish …` thành công trên GHCR.
4. Mở Coolify, bấm Deploy/Redeploy stack production và theo dõi `migrator` hoàn tất trước khi API/web khởi động.
5. Mở domain gateway, đăng nhập bằng `superadmin@platform.local` cùng `SEED_SUPERADMIN_PASSWORD`, và tạo tenant đầu tiên từ Platform Admin.

## 8. Bảo vệ nhánh trên GitHub

Tạo branch protection rule riêng cho `main` và `dev/release` với các lựa chọn sau:

1. Bật **Require a pull request before merging**.
2. Bật **Require status checks to pass before merging** và chỉ chọn check `PR validation complete`.
3. Bật **Require branches to be up to date before merging**.

Không chọn `Build and publish …`: các job này cố ý bị bỏ qua trên pull request và chỉ chạy sau khi merge để push image lên GHCR. Không cần chọn 11 check `Verify container …` riêng lẻ, vì chúng đã được `PR validation complete` kiểm tra đầy đủ.

## Rollback

Để rollback image, tìm commit SHA tốt gần nhất trên Actions/GHCR, đặt `IMAGE_TAG=sha-<commit-sha>` trong Coolify, lưu và deploy lại resource. Compose sẽ pull các tag cùng release như `api-sha-<commit>`, `web-sha-<commit>` và `gateway-sha-<commit>`, nên rollback giữ được phiên bản đồng bộ. Migration trong repository phải luôn có tính tương thích ngược; không rollback schema bằng cách xóa volume hoặc sửa migration đã được áp dụng.

## Nx Cloud (tùy chọn)

Workflow đã cache `.nx/cache` qua GitHub Actions. Khi CI bắt đầu chậm hoặc có nhiều nhánh/runner, kết nối Nx Cloud để remote cache dùng được giữa các workflow và runner. Không cần Nx Cloud để pipeline hoạt động; GitHub Actions vẫn là nơi build/push/deploy.
