---
name: erp-permissions
description: Dùng khi thêm API hoặc route cần phân quyền, thêm action quyền mới, viết hoặc sửa guard của phân hệ, ẩn hiện nút theo quyền, hoặc gọi API nội bộ giữa các service ERP.
---

# Phân quyền

## Mô hình

- **Danh mục action** là `TENANT_PERMISSION_ACTIONS` trong `packages/contracts/identity/src/lib/tenant-authorization.ts`.
  Khoá có dạng `<tiền tố>.<đối tượng>.<động từ>`, kèm `group` và `label` tiếng Việt. Màn Phân quyền và identity service
  đọc thẳng danh sách này, nên action thêm vào đây là gán được cho vai trò.
- **Tiền tố theo phân hệ** nằm ở `MODULE_ACTION_PREFIX`; ví dụ `procedure-engine` dùng tiền tố `procedure`. Người có bất
  kỳ action nào của phân hệ thì vào được phân hệ đó (`tenantModulesForActions`). Tenant có được dùng phân hệ hay không
  là do gói đăng ký quyết định.
- **Quyền bao hàm** khai trong `TENANT_ACTION_IMPLIES`, ví dụ `*.manage` kéo theo `*.read` và quyền ghi. Quyền xoá được
  cấp đích danh, không đi theo `manage`. Kiểm bằng `tenantActionHeld(held, action)`, đừng tự so chuỗi.
- **Quản trị tenant** có mọi quyền nghiệp vụ (`isTenantAdmin`, `hasTenantAction`).
- **Quyền không nằm trong JWT.** API hỏi Platform ở mỗi request qua `ModuleAccess.decision(principal, action)`.

## Guard của phân hệ

Mỗi `apps/<phân hệ>-api` có một `APP_GUARD` dựa trên `ModuleAccess` (`packages/platform/module-access`). Mẫu gọn nhất là
`apps/shared-api/src/app/shared-access.guard.ts`:

1. `isHealthCheck`: cho qua.
2. `isInternal` (đường dẫn có `/v1/internal/`): xác thực service bằng `authorizeService` (header `x-service-token` và
   `x-tenant-id`), không dùng phiên người dùng. Phân hệ không có route nội bộ thì từ chối.
3. `requireCsrfForMutation`: request ghi phải có header `x-csrf-token` bằng cookie `ep_csrf`.
4. `tenantUser` rồi `decision(principal, '<tiền tố>.read')`; không được phép thì trả 403.
5. Dựng actor của phân hệ với các cờ như `canManage`, `canWrite...` (tính bằng `tenantActionHeld`). Tầng application
   kiểm cờ theo đúng thao tác.

HRM theo cách khác: mỗi route khai `@RequirePermission('hrm....')` hoặc `@HrmPublicRoute()`. `HRM_ACCESS_GUARD_MODE` mặc
định là `audit`: route quên khai báo chỉ bị ghi WARN chứ không bị chặn. Vì vậy mọi route HRM mới phải có decorator.

## Luật cứng

- Kiểm quyền ở API. Giao diện chỉ ẩn hoặc hiện theo `capabilities` do API trả về (ví dụ `GET /v1/status`); ẩn nút không
  phải là phân quyền.
- Dùng khoá quyền đã có. Chỉ thêm action khi nghiệp vụ thật sự cần cấp riêng, và chỉ thêm vào
  `TENANT_PERMISSION_ACTIONS`, không tạo danh sách quyền thứ hai.
- Gọi API từ trình duyệt bằng `authFetch` của `@enterprise-platform/shared-ui`; nó gắn cookie và CSRF.
- Lấy dữ liệu của phân hệ khác qua API của phân hệ đó, qua route `/v1/internal/` (giữa các service), hoặc qua sự kiện.
  Không ghi vào schema của phân hệ khác. Ranh giới Core–HRM xem ở `docs/core-hrm-ranh-gioi.md`.
- Lỗi trả về có dạng `{ statusCode, code, message }`, trong đó `message` là câu tiếng Việt người dùng đọc được.

## Thêm action mới

1. Thêm `{ key, group, label }` vào `TENANT_PERMISSION_ACTIONS`, đúng tiền tố của phân hệ.
2. Nếu action này là quyền quản lý bao hàm quyền khác thì cập nhật `TENANT_ACTION_IMPLIES`.
3. Dùng action trong guard hoặc tầng application, và trả về cờ tương ứng trong `capabilities` để giao diện ẩn hiện.
4. Viết test cho cả hai trường hợp: có quyền và không có quyền. Mẫu: `apps/workspace-api/src/app/workspace-access.guard.spec.ts`
   và `packages/modules/hrm/src/lib/infrastructure/hrm-access.guard.spec.ts`.
