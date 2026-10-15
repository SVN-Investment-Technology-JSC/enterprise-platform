# shared-api

API của phân hệ **Hệ dùng chung** (`/api/shared`, cổng 3342; giao diện `shared-web`
ở `/modules/shared`, cổng 3010). Phần đầu tiên là **Tài liệu công ty** — kho tài
liệu cấp công ty, tách khỏi tài liệu dự án của Workspace.

- Bảng: `shared_schema` trong DB tenant (`migrations/tenant/shared`).
- Tệp: presigned URL qua MinIO/S3, khoá `tenants/<tenantId>/shared/…`.
- Quyền: `shared.read`, `shared.document.write`, `shared.document.delete`,
  `shared.manage` (dựng thư mục gốc, chuyển thư mục, xem dung lượng).

## Hạn mức dung lượng

Một hạn mức chung cho **cả tenant**: tệp của mọi phân hệ (Tài liệu công ty,
Workspace, HRM, Quy trình, Kho, Bảo trì) cộng vào một con số. Platform giữ con
số (`GET /api/platform/internal/v1/tenant-limits/:tenantId`, service token);
phân hệ này đo dung lượng đang dùng và chặn tải lên khi vượt.

| Gói | Dung lượng | Khi vượt |
| --- | --- | --- |
| Chưa gắn gói | 50 GB | chặn tải lên |
| Tiêu Chuẩn (`standard`) | 50 GB | chặn tải lên |
| Doanh Nghiệp (`enterprise`) | 500 GB | chặn tải lên |
| Gói mua thêm | bội 100 GB, cộng dồn | — |

- Cảnh báo từ 80% (thanh trên đầu trang và trang Dung lượng).
- Gói mua thêm: bảng `subscription_schema.tenant_limit_addons` (migration platform 0009).
- Platform không trả lời được thì dùng con số đã biết gần nhất; chưa có thì 50 GB
  và **chỉ cảnh báo**, không chặn, để Platform nghỉ không làm hỏng tải lên.

Biến môi trường: như `workspace-api` (database, platform access, S3) cộng
`PLATFORM_TENANT_LIMITS_URL`.

```bash
pnpm dev:shared
```
