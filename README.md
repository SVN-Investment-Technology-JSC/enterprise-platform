# Enterprise Platform

Nx + pnpm monorepo cho nền tảng SaaS modular monolith, với một Platform DB và một PostgreSQL database riêng cho mỗi tenant.

## Cấu trúc hiện tại

```text
apps/
  api/          Platform Core + CRM API (không phụ thuộc Procedure/Maintenance)
  web/          Platform Admin + Tenant Portal Next.js
  procedure-api/ NestJS composition root riêng cho Procedure
  procedure-web/ Next.js App Router riêng, basePath /modules/procedure
  maintenance-api/ NestJS composition root, scheduler và API riêng cho Maintenance
  maintenance-web/ Next.js App Router riêng, basePath /modules/maintenance
  worker/       Background jobs và event consumers
  migrator/     Điều phối migration Platform DB và tenant DB

packages/
  platform/     Identity, tenancy, authorization, entitlement, module registry
  modules/      Procedure Engine, Maintenance và CRM; không import lẫn nhau
  features/     UI feature packages được Web shell tiêu thụ
  contracts/    Public contracts/events, không chứa implementation
  adapters/     Port dùng chung cho database và hạ tầng kỹ thuật
  shared/       Kernel tối thiểu, không chứa business logic
```

Các module hoặc plugin mới được tạo thành pnpm workspace package độc lập dưới `packages/modules/<name>` hoặc `packages/plugins/<name>`. Không tạo package rỗng trước khi có use case thực tế.

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

Một business module không được import trực tiếp module khác. Giao tiếp liên module đi qua contract, port hoặc event. Trong mỗi module, hướng phụ thuộc là `presentation -> application -> domain`; infrastructure triển khai các port và được nối tại composition root.

## Dedicated DB per tenant

`platform-tenancy` sở hữu request context; Platform DB chỉ lưu `secretRef`, không lưu password tenant database. Adapter PostgreSQL dùng bounded pool, idle TTL và tuyệt đối không fallback sang database tenant khác.

`apps/migrator` chạy Platform migration và tenant migration theo provisioning job. Entitlement chỉ chuyển sang `active` sau khi migration module thành công. Procedure migration chỉ được dùng `procedure_schema` và `integration_schema`; Maintenance chỉ dùng `maintenance_schema` và `integration_schema`; CRM chỉ dùng `crm_schema`.

Platform Core sở hữu Organization (loại đơn vị, đơn vị, vị trí và membership). Procedure đọc typed organization snapshot qua internal API để phân giải RCSI; không đọc Platform DB và không sao chép cơ cấu tổ chức vào `procedure_schema`.

## Identity và triển khai độc lập

Platform Core ký JWT RS256 15 phút và xoay opaque refresh token 30 ngày. Principal là union `platform-admin | tenant-user`; Procedure và Maintenance từ chối Platform Admin, xác minh JWKS rồi gọi internal access-decision API. Quyết định được cache tối đa 30 giây và fail closed khi Platform Core không phản hồi.

Nginx giữ một origin: `/api/auth`, `/api/platform`, `/api/crm` đi Platform API; `/api/procedure` và `/api/maintenance` đi hai API plugin; `/modules/procedure` và `/modules/maintenance` đi hai Next app độc lập. Mỗi plugin có health check và fallback bảo trì riêng, nên một plugin dừng không kéo CRM, Platform hoặc plugin còn lại xuống.

## Next.js frontend

`apps/web` dùng TypeScript, ESLint, App Router, Turbopack, thư mục `src/` và alias `@/*`. `typedRoutes` được bật để kiểm tra tĩnh các đường dẫn nội bộ. `outputFileTracingRoot` trỏ về monorepo root để không bỏ sót workspace dependencies. Linux container/CI đặt `NEXT_BUILD_OUTPUT=standalone` để sinh production bundle tối thiểu; build cục bộ trên Windows giữ output mặc định vì pnpm symlink có thể yêu cầu đặc quyền hệ điều hành.

Trình duyệt chỉ gọi cùng origin. Trong local development, Next rewrite sang `API_BASE_URL`, `PROCEDURE_API_BASE_URL` và `MAINTENANCE_API_BASE_URL`; production dùng Nginx. Các plugin không có trang login riêng và nhận cookie SSO của Platform qua cùng origin.

Giữ `src/app` chủ yếu cho routing, layout, loading và error boundaries. UI dùng chung đặt ngoài route tree; UI gắn với một bounded context được tách theo feature khi use case xuất hiện. Các vùng `(platform)` và `(tenant)` chỉ nên được tạo cùng lúc với guard/layout thật, tránh sinh route quản trị công khai dạng placeholder.

## Lệnh thường dùng

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

## Khởi tạo local

Sao chép `.env.example` thành `.env`, thay toàn bộ password/token mẫu, rồi chạy `pnpm infra:up`, `pnpm db:provision` và `pnpm dev`. Platform Web dùng cổng `3002`, Procedure Web `3003`, Maintenance Web `3004`; ba API dùng `3333`–`3335`. Nginx cung cấp single origin tại `http://localhost:8080`. Bốn database local dùng cổng `55432`–`55435`, RabbitMQ dùng `5672/15672`, MinIO dùng `9010/9011`.

Ba tenant seed: DakRoSa (Procedure), An Phát (CRM), Minh Long (Procedure + CRM + Maintenance, kèm Organization và dữ liệu demo phong phú). Password không nằm trong source mà chỉ lấy từ biến môi trường.
