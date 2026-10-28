# crm-api

API của phân hệ **CRM** (`/api/crm`, cổng 3344; giao diện `crm-web` ở
`/modules/crm`, cổng 3012). Kế hoạch và danh sách việc: `docs/crm/plan_crm.md`,
`docs/crm/TASK.md`.

- Bảng: `crm_schema` trong DB tenant (`migrations/tenant/crm`).
- Code nghiệp vụ: `packages/modules/crm`; kiểu dùng chung với giao diện:
  `packages/contracts/crm`; màn hình: `packages/features/crm`.
- Guard `CrmAccessGuard`: mọi route cần `crm.read`; quyền chi tiết (lập báo giá,
  duyệt, thu tiền...) kiểm ở tầng application theo cờ của `CrmActor`. Route
  `/v1/internal/*` xác thực bằng `x-service-token` + `x-tenant-id` và chỉ nhận
  actor hệ thống không có quyền nghiệp vụ.

| Quyền | Cờ trên `CrmActor` |
| --- | --- |
| `crm.read` | vào phân hệ (phạm vi dữ liệu của mình và nhóm) |
| `crm.read.all` | `canReadAll`: thấy toàn bộ |
| `crm.opportunity.write` | `canWriteOpportunity` |
| `crm.quote.write`, `crm.quote.approve` | `canWriteQuote`, `canApproveQuote` |
| `crm.order.write`, `crm.contract.write` | `canWriteOrder`, `canWriteContract` |
| `crm.receivable.write`, `crm.warranty.write` | `canWriteReceivable`, `canWriteWarranty` |
| `crm.report.read` | `canReadReport` |
| `crm.manage` | `canManage` (kéo theo `canReadAll`) |

Quản trị tenant có mọi cờ.

## Phạm vi dữ liệu

`CrmDataScopeService.resolve(actor)` trả `{ kind: 'all' }` cho `crm.read.all`,
`crm.manage`, quản trị tenant; còn lại `{ kind: 'users', userIds }` gồm chính
mình và cấp dưới theo chuỗi "Báo cáo cho" ở Tenant Core (cùng cách tính với
HRM). Store lọc bằng `ownerScopeSql(scope, 'alias.owner_user_id', n)`; đối tượng
ngoài phạm vi trả 404. Cơ cấu tổ chức đọc từ
`TENANT_CORE_ORGANIZATION_CONTEXT_URL` (service token), giữ 60 giây; Tenant Core
lỗi mà chưa có bản nào thì trả `503 ORGANIZATION_UNAVAILABLE`, không mở rộng phạm vi.

## Nhật ký chuyển trạng thái

`writeAuditLog(client, { entityType, entityId, fromStatus, toStatus, action, actorId, reason })`
ghi vào `crm_schema.audit_log` bằng client của transaction đang đổi dữ liệu.

| Route | Ý nghĩa |
| --- | --- |
| `GET /health/live`, `GET /health/ready` | probe, không cần đăng nhập |
| `GET /v1/status` | mức sẵn sàng của schema và `capabilities` để giao diện ẩn hiện |

Biến môi trường: database, platform access (`PLATFORM_ACCESS_DECISION_URL`,
`PLATFORM_JWKS_URL`, `PLATFORM_TENANT_DATABASE_API_URL`, `INTERNAL_SERVICE_TOKEN`),
`TENANT_CORE_ORGANIZATION_CONTEXT_URL`.

Integration test (PostgreSQL cục bộ, DB tạm cho mỗi suite):

```bash
CRM_TEST_ADMIN_URL=postgresql://platform:platform@localhost:55432/postgres pnpm nx test module-crm
```
