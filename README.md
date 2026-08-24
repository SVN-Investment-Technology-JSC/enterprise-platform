# Enterprise Platform

Nx + pnpm monorepo cho nền tảng SaaS modular monolith, với một Platform DB và một PostgreSQL database riêng cho mỗi tenant.

## Cấu trúc hiện tại

```text
apps/
  api/          Platform Core + CRM API (không phụ thuộc các module triển khai riêng)
  web/          Platform Admin + Tenant Portal Next.js
  procedure-api/ NestJS composition root riêng cho Procedure
  procedure-web/ Next.js App Router riêng, basePath /modules/procedure
  maintenance-api/ NestJS composition root, scheduler và API riêng cho Maintenance
  maintenance-web/ Next.js App Router riêng, basePath /modules/maintenance
  inventory-api/ NestJS composition root và API riêng cho Inventory
  inventory-web/ Next.js App Router riêng, basePath /modules/inventory
  worker/       Background jobs và event consumers
  migrator/     Điều phối migration Platform DB và tenant DB

packages/
  platform/     Identity, tenancy, authorization, entitlement, module registry
  modules/      Procedure Engine, Maintenance, Inventory và CRM; không import lẫn nhau
  features/     UI feature packages cho Procedure Engine, Maintenance và Inventory
  contracts/    Public contracts/events, không chứa implementation
  adapters/     Port dùng chung cho database và hạ tầng kỹ thuật
  shared/       Kernel tối thiểu, không chứa business logic
```

Các module mới được tạo thành pnpm workspace package độc lập dưới `packages/modules/<name>`. Plugin là một loại dependency được Nx cho phép nếu được bổ sung sau này, nhưng hiện chưa có package plugin trong workspace. Không tạo package rỗng trước khi có use case thực tế.

## Quy tắc phụ thuộc

Nx tags và ESLint đang thực thi các hướng phụ thuộc chính:

```text
apps -> platform | modules | features | plugins | contracts | adapters | shared
modules -> platform | contracts | adapters | shared
features -> features | contracts | shared
platform -> platform | contracts | adapters | shared
contracts -> contracts | shared
adapters -> adapters | contracts | shared
shared -> shared
```

Một business module không được import trực tiếp module khác. Giao tiếp liên module đi qua contract, port, internal API hoặc event. Nx còn giới hạn theo scope: Procedure Engine, Maintenance và CRM không được phụ thuộc chéo; Inventory là module độc lập và được các module khác gọi qua API/contract. Trong mỗi package, hướng phụ thuộc là `presentation -> application -> domain`; infrastructure triển khai các port và được nối tại composition root.

## Dedicated DB per tenant

`platform-tenancy` sở hữu request context; Platform DB chỉ lưu `secretRef`, không lưu password tenant database. Adapter PostgreSQL dùng bounded pool, idle TTL và tuyệt đối không fallback sang database tenant khác.

`apps/migrator` chạy Platform migration và tenant migration theo provisioning job. Entitlement chỉ chuyển sang `active` sau khi migration module thành công. Tenant DB có `core_schema` và `integration_schema` dùng chung; mỗi module sở hữu schema riêng: Procedure dùng `procedure_schema`, Maintenance dùng `maintenance_schema`, Inventory dùng `inventory_schema`, CRM dùng `crm_schema`.

Organization (loại đơn vị, đơn vị, vị trí và membership) nằm trong tenant core schema. Các module đọc ngữ cảnh tổ chức qua internal API của Platform Core thay vì kết nối trực tiếp hoặc sao chép dữ liệu tổ chức vào schema riêng.

## Identity và triển khai độc lập

Platform Core ký JWT RS256 15 phút và xoay opaque refresh token 30 ngày. Principal là union `platform-admin | tenant-user`; các API module xác minh JWKS rồi gọi internal access-decision API để lấy quyền và tenant database. Quyết định được cache tối đa 30 giây và fail closed khi Platform Core không phản hồi.

Nginx giữ một origin: `/api/auth`, `/api/platform`, `/api/crm` đi Platform API; `/api/procedure`, `/api/maintenance` và `/api/inventory` đi các API module tương ứng. `/modules/procedure`, `/modules/maintenance` và `/modules/inventory` đi ba Next app độc lập. Procedure và Maintenance có health check/fallback bảo trì riêng; một module dừng không làm Platform, CRM hoặc module còn lại ngừng phục vụ.

## Chạy toàn bộ hệ thống bằng Docker

Đây là cách khuyến nghị để một thành viên mới chạy project sau khi clone. Máy chỉ cần Git và Docker Desktop (Windows/macOS) hoặc Docker Engine kèm Docker Compose v2 (Linux); không cần cài Node.js, pnpm, PostgreSQL, RabbitMQ hoặc MinIO trên host.

Compose full-stack chạy các deployment sau trong cùng một Docker network:

```text
gateway (http://localhost:8080)
├─ web
├─ procedure-web
├─ maintenance-web
├─ inventory-web
├─ api
├─ procedure-api
├─ maintenance-api
└─ inventory-api

worker
migrator (one-shot)
platform-db
tenant-db (một PostgreSQL instance, tạo database riêng cho từng tenant)
rabbitmq
minio
minio-init (one-shot)
```

`migrator` chỉ kết thúc thành công sau khi migration và dữ liệu seed hoàn tất. Các API/worker chỉ được khởi động sau bước này. Hai container `migrator` và `minio-init` hiển thị `Exited (0)` sau khi chạy là trạng thái bình thường.

### 1. Clone và tạo cấu hình local

```powershell
git clone <repository-url> enterprise-platform
Set-Location enterprise-platform
Copy-Item .env.docker.example .env.docker
```

Linux/macOS:

```bash
git clone <repository-url> enterprise-platform
cd enterprise-platform
cp .env.docker.example .env.docker
```

`.env.docker` đã được Git ignore. Các giá trị mặc định chỉ dành cho máy development và có thể chạy ngay; nên đổi password/token trong file này nếu máy được nhiều người truy cập. Không commit `.env.docker` và không dùng các giá trị mẫu cho staging/production.

Các password database dùng trong connection URL nên là chuỗi URL-safe. Nếu dùng ký tự đặc biệt như `@`, `:`, `/` hoặc `%`, phải URL-encode phần password trong connection URL tương ứng.

### 2. Build và khởi động

PowerShell:

```powershell
docker compose `
  --env-file .env.docker `
  -f infrastructure/docker/compose.full.yml `
  up --build --wait
```

Linux/macOS:

```bash
docker compose \
  --env-file .env.docker \
  -f infrastructure/docker/compose.full.yml \
  up --build --wait
```

Lần build đầu tiên sẽ tải Node, PostgreSQL, RabbitMQ và MinIO images. Những lần sau Docker BuildKit và pnpm store cache sẽ tái sử dụng dependency nếu lockfile không thay đổi.

Sau khi lệnh hoàn tất, mở:

| Thành phần | URL |
|---|---|
| Gateway / trang chủ | `http://localhost:8080` |
| Platform Admin login | `http://localhost:8080/platform/login` |
| Tenant login | `http://localhost:8080/tenant/login` |
| Procedure Engine | `http://localhost:8080/modules/procedure` |
| Maintenance | `http://localhost:8080/modules/maintenance` |
| Inventory | `http://localhost:8080/modules/inventory` |
| Procedure health | `http://localhost:8080/api/procedure/health/ready` |
| Maintenance health | `http://localhost:8080/api/maintenance/health/ready` |
| Inventory health | `http://localhost:8080/api/inventory/health/ready` |

Tài khoản seed:

| Portal | Email | Password |
|---|---|---|
| Platform Admin | `superadmin@platform.local` | Giá trị `SEED_SUPERADMIN_PASSWORD` |

Không có tenant hoặc tenant admin mẫu. Sau khi đăng nhập bằng Platform Admin, tạo tenant và tài khoản quản trị tenant qua luồng quản trị Platform.

### 3. Kiểm tra trạng thái và log

Để tránh lặp lại toàn bộ tham số, các ví dụ dưới đây dùng biến PowerShell:

```powershell
$compose = @('--env-file', '.env.docker', '-f', 'infrastructure/docker/compose.full.yml')
docker compose @compose ps
docker compose @compose logs -f gateway api procedure-api maintenance-api worker
```

Linux/macOS dùng trực tiếp:

```bash
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml ps
docker compose --env-file .env.docker -f infrastructure/docker/compose.full.yml \
  logs -f gateway api procedure-api maintenance-api worker
```

Xem log một plugin:

```powershell
docker compose @compose logs -f procedure-api procedure-web
```

Kiểm tra database mà không cần expose cổng PostgreSQL ra host:

```powershell
docker compose @compose exec platform-db psql -U platform -d platform
docker compose @compose exec tenant-db psql -U tenant -d postgres
```

### 4. Cập nhật source sau khi có commit mới

```powershell
git pull
docker compose @compose up --build --wait
```

Compose chỉ rebuild layer thay đổi, giữ nguyên named volumes và tự chạy lại migrator idempotent. Không cần chạy `pnpm install` hoặc migration trên máy host.

Nếu stack đang chạy và chỉ sửa Inventory:

```powershell
docker compose @compose up --build --wait inventory-api inventory-web
```

Gateway không cần restart; Docker DNS sẽ tiếp tục định tuyến sang container Inventory mới.

Nếu thay đổi environment hoặc Compose, dùng `up` như trên thay vì `docker compose restart`, vì `restart` không áp dụng cấu hình mới.

### 5. Dừng, chạy lại và reset dữ liệu

Dừng và xóa container/network nhưng giữ database, RabbitMQ và MinIO volumes:

```powershell
docker compose @compose down
```

Khởi động lại với dữ liệu cũ:

```powershell
docker compose @compose up --build --wait
```

Reset hoàn toàn dữ liệu local:

```powershell
docker compose @compose down --volumes
docker compose @compose up --build --wait
```

`down --volumes` xóa toàn bộ Platform DB, toàn bộ database tenant trong `tenant-db`, RabbitMQ và MinIO data của Compose full-stack. Chỉ dùng khi chắc chắn muốn tạo lại dữ liệu seed từ đầu.

### 6. Lỗi thường gặp

- Cổng `8080` đã được dùng: đổi `GATEWAY_PORT` trong `.env.docker`, ví dụ `GATEWAY_PORT=18080`.
- Một image build lỗi: chạy lại với log rõ hơn bằng `docker compose --progress=plain @compose build <service>`.
- API chưa khởi động: kiểm tra `docker compose @compose logs migrator`; API chỉ chạy khi migrator trả exit code `0`.
- Đổi database password sau khi volume đã được tạo: PostgreSQL không tự đổi password của database hiện hữu theo environment mới. Hoặc đổi bằng SQL, hoặc reset volume local bằng `down --volumes`.
- Login qua HTTP local: `AUTH_COOKIE_SECURE=false`. Khi triển khai HTTPS thật phải đặt `AUTH_COOKIE_SECURE=true`.
- Docker thiếu tài nguyên khi build nhiều Next/Nx app: tăng memory cho Docker Desktop rồi build lại; không cần xóa volume dữ liệu.

### Compose development trên host

[compose.local.yml](infrastructure/docker/compose.local.yml) vẫn dành cho lập trình có hot-reload: database/RabbitMQ/MinIO/Nginx chạy bằng Docker, còn Web/API/Worker chạy bằng `pnpm dev` trên host. Không chạy `compose.local.yml` và `compose.full.yml` cùng cổng `8080` tại cùng một thời điểm.

Compose full-stack là cấu hình onboarding/local integration, chưa phải cấu hình production. Production cần TLS, secret manager, persistent RS256 key pair, backup database, image registry và chính sách resource/observability riêng.

## CI/CD production

GitHub Actions dùng Nx để kiểm tra project bị ảnh hưởng trên pull request. Khi merge vào `main`, workflow build/push image lên GHCR rồi gọi Coolify deploy webhook; Coolify chạy Compose production chỉ bằng các image đã publish. Xem hướng dẫn cấu hình đầy đủ tại [docs/ci-cd.md](docs/ci-cd.md).

## Next.js frontend

`apps/web` dùng TypeScript, ESLint, App Router, Turbopack, thư mục `src/` và alias `@/*`. `typedRoutes` được bật để kiểm tra tĩnh các đường dẫn nội bộ. `outputFileTracingRoot` trỏ về monorepo root để không bỏ sót workspace dependencies. Linux container/CI đặt `NEXT_BUILD_OUTPUT=standalone` để sinh production bundle tối thiểu; build cục bộ trên Windows giữ output mặc định vì pnpm symlink có thể yêu cầu đặc quyền hệ điều hành.

Trình duyệt chỉ gọi cùng origin. Trong local development, các Next app rewrite sang API của Platform hoặc module tương ứng; production dùng Nginx. Các module không có trang login riêng và nhận cookie SSO của Platform qua cùng origin.

Giữ `src/app` chủ yếu cho routing, layout, loading và error boundaries. UI dùng chung đặt ngoài route tree; UI gắn với một bounded context được tách theo feature khi use case xuất hiện. Các vùng `(platform)` và `(tenant)` chỉ nên được tạo cùng lúc với guard/layout thật, tránh sinh route quản trị công khai dạng placeholder.

## Phát triển trực tiếp trên host với pnpm

Phần này dành cho thành viên cần hot-reload và đã cài Node.js 24 cùng pnpm 10. Nếu chỉ muốn chạy toàn bộ hệ thống, dùng hướng dẫn Docker ở trên.

### Lệnh thường dùng

Yêu cầu Node.js 24 và pnpm 10.

```powershell
pnpm install
pnpm nx show projects
pnpm nx graph
pnpm infra:up
pnpm db:provision
pnpm dev
pnpm dev:api
pnpm dev:procedure-api
pnpm dev:procedure
pnpm dev:web
pnpm dev:procedure-web
pnpm dev:maintenance
pnpm dev:maintenance-api
pnpm dev:maintenance-web
pnpm dev:inventory
pnpm dev:inventory-api
pnpm dev:inventory-web
pnpm dev:worker
pnpm dev:status
pnpm check
pnpm check:affected
pnpm nx e2e api-e2e
pnpm nx e2e procedure-api-e2e
pnpm nx e2e maintenance-api-e2e
pnpm nx e2e web-e2e
pnpm nx e2e procedure-web-e2e
pnpm nx e2e maintenance-web-e2e
```

Mọi lệnh Nx trong workspace nên chạy qua `pnpm nx ...`. Trước khi generate project mới, luôn chạy generator với `--dry-run` và dùng import path thuộc scope `@enterprise-platform/*`.

### Khởi tạo local

Sao chép `.env.example` thành `.env`, thay toàn bộ password/token mẫu, rồi chạy `pnpm infra:up`, `pnpm db:provision` và `pnpm dev`. Platform Web dùng cổng `3002`, Procedure Web `3003`, Maintenance Web `3004`, Inventory Web `3005`; bốn API dùng `3333`–`3336`. Nginx cung cấp single origin tại `http://localhost:8080`. Platform DB và tenant PostgreSQL instance lần lượt dùng cổng `55432` và `55433`; RabbitMQ dùng `5672/15672`, MinIO dùng `9010/9011`.

Migrator chỉ seed Platform Super Admin, roles/permissions và module registry; không tạo tenant, tenant admin hoặc dữ liệu nghiệp vụ mẫu. Tạo tenant đầu tiên từ Platform Admin. Password không nằm trong source mà chỉ lấy từ biến môi trường.
