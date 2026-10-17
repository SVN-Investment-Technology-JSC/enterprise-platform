---
name: erp-module
description: Dùng khi thêm phân hệ mới, thêm màn hình, API hay bảng dữ liệu vào phân hệ có sẵn, hoặc cần biết code của một phân hệ nằm ở đâu và tầng nào được import tầng nào.
---

# Phân hệ ERP

## Một phân hệ gồm những gì

| Đường dẫn | Vai trò | Tag Nx |
|---|---|---|
| `apps/<m>-api` | NestJS: `main.ts` (global prefix `api/<m>`), `<m>-api.module.ts`, `HealthController`, guard quyền | `type:app` |
| `apps/<m>-web` | Next.js với `basePath: '/modules/<m>'`; chỉ render màn hình của feature | `type:app` |
| `packages/modules/<m>` | Nghiệp vụ phía server: `src/lib/{domain,application,infrastructure,presentation}` | `type:module` |
| `packages/contracts/<m>` | Kiểu request/response, hằng số, sự kiện dùng chung giữa web và API | `type:contract` |
| `packages/features/<m>` | Màn hình React của phân hệ | `type:feature` |
| `migrations/tenant/<m>` | Schema `<m>_schema` trong DB của tenant | |

Cấu hình Nx nằm trong trường `"nx"` của `package.json` từng project (tên và tag `type:*`, `scope:<m>`); repo không dùng
`project.json`. Import giữa các project đi qua tên package (`@enterprise-platform/...`) và bị
`@nx/enforce-module-boundaries` kiểm theo tag: feature chỉ import feature, contract, shared; contract chỉ import
contract, shared. Giao diện không bao giờ import `packages/modules`.

## Các tầng trong `packages/modules/<m>`

- `domain`: kiểu và luật nghiệp vụ thuần, không NestJS, không DB.
- `application`: service cho từng thao tác; kiểm quyền theo actor; khai báo port (interface) cho DB hay API ngoài.
- `infrastructure`: hiện thực port (store Postgres, client HTTP, ghi outbox).
- `presentation`: controller `@Controller('v1')`; chỉ đọc request, gọi service, đổi lỗi nghiệp vụ thành HTTP.

Chiều import: `presentation` → `application` → `domain`; `infrastructure` → `application`, `domain`. `domain` và
`application` không import `infrastructure` hay `presentation`. Mẫu gọn: `packages/modules/shared`.

## Giao diện

- Bọc màn hình trong `ModuleShell` với `appearance="light"` (`packages/features/module-shell`); không tự dựng sidebar
  hay thanh trên.
- Gọi API bằng `authFetch` của `@enterprise-platform/shared-ui`, đường dẫn `/api/<m>/v1/...`.
- Dùng component của `@enterprise-platform/shared-ui` (`SearchableSelect`, `Popconfirm`, `MinimalPopupForm`...). Xem skill `ui-design`.
- Ẩn hiện theo `capabilities` do API trả về; quyền thật kiểm ở API (skill `erp-permissions`).

## Thêm màn hình hoặc API vào phân hệ có sẵn

1. Kiểu request/response vào `packages/contracts/<m>`.
2. Service ở `application`, store ở `infrastructure`, controller ở `presentation`; đăng ký trong `<m>.module.ts`.
3. Quyền theo skill `erp-permissions`; đổi schema theo `erp-migrations`; báo phân hệ khác theo `erp-events`.
4. Màn hình ở `packages/features/<m>`.
5. Test cạnh code (`*.spec.ts`): service với port giả; guard hoặc controller khi có quyền mới.

## Thêm phân hệ mới

Làm theo commit `63201a36` (phân hệ Hệ dùng chung); xem danh sách file bằng `git show --stat 63201a36`. Ngoài code của
chính phân hệ, cần sửa:

1. Quyền: `TENANT_PERMISSION_ACTIONS` và `MODULE_ACTION_PREFIX` trong contracts-identity. Thêm vào
   `MODULES_WITH_ADMISSION_PROBE` nếu phân hệ cho vào bằng `module.access`.
2. Danh mục phân hệ: bản ghi seed `module_registry_schema.modules` và kiểu `module_key` của `ProvisioningJob` trong
   `apps/migrator/src/main.ts`.
3. Migration: thư mục `migrations/tenant/<m>`, `TENANT_MODULE_MIGRATIONS`, và `MODULE_DIRECTORIES` trong spec.
4. Gateway: route `/api/<m>/` và `/modules/<m>/` trong `infrastructure/nginx/nginx.conf` và `nginx.docker.conf`, trang
   `<m>-maintenance.html`, và dòng chép trang đó trong `infrastructure/nginx/Dockerfile`.
5. Triển khai: `tools/deployment/services.json` (kèm `runtimeCheck.nodeModules` nếu cần),
   `infrastructure/docker/compose.coolify.yml`, `infrastructure/docker/compose.full.yml`.
6. Chạy local: cổng trong `tools/dev-gateway.mjs`, `tools/dev-health.mjs`, script `dev:<m>` trong `package.json`.
7. Màn chính: thẻ ứng dụng trong `apps/web/src/app/(tenant)/applications/enterprise-applications.tsx`, màu trong
   `module-tint.ts`, bật cho tenant ở `apps/web/src/app/platform/tenants/[tenantId]/tenant-entitlements.tsx`.
8. `pnpm install` (lockfile) và `pnpm nx sync` (reference trong `tsconfig.json`).

## Thao tác cho Trợ lý Savina

Gói `@enterprise-platform/contracts-assistant` mới có chuẩn khai báo (`defineAssistantActions`). Phần khung ERP mở popup
theo khai báo chưa làm, nên chưa phân hệ nào cần khai báo.

## Kiểm trước khi mở PR

```bash
pnpm nx affected -t lint typecheck test --base=origin/dev/release
pnpm nx sync:check
```
