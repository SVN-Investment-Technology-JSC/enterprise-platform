# shared-api

API của phân hệ **Hệ dùng chung** (`/api/shared`, cổng 3342; giao diện `shared-web`
ở `/modules/shared`, cổng 3010). Phần đầu tiên là **Tài liệu công ty** — kho tài
liệu cấp công ty, tách khỏi tài liệu dự án của Workspace.

- Bảng: `shared_schema` trong DB tenant (`migrations/tenant/shared`).
- Tệp: presigned URL qua MinIO/S3, khoá `tenants/<tenantId>/shared/…`.
- Quyền: `shared.read`, `shared.document.write`, `shared.document.delete`
  (lưu trữ, xoá, khôi phục), `shared.manage` (dựng thư mục gốc, chuyển thư mục,
  xem dung lượng, xoá vĩnh viễn).

## Xoá và Thùng rác

Xoá tài liệu hay thư mục là chuyển vào **Thùng rác** (`deleted_at`), khôi phục
được. Tệp vẫn nằm trong kho nên **vẫn tính vào dung lượng** cho tới khi xoá vĩnh
viễn. "Lưu trữ" là trạng thái riêng, không phải xoá.

| Thao tác | Quyền |
| --- | --- |
| Xoá tài liệu hay thư mục; xem, khôi phục từ Thùng rác | `shared.document.delete` (hoặc quản trị tenant) |
| Xoá thư mục gốc, khôi phục thư mục về gốc | thêm `shared.manage` |
| Xoá vĩnh viễn, dọn Thùng rác | `shared.document.delete` **và** `shared.manage` (hoặc quản trị tenant) |

- Xoá thư mục kéo cả nhánh và tài liệu bên trong vào Thùng rác một lượt
  (`deleted_batch`); khôi phục cũng cả nhánh. Thư mục còn tài liệu người khác
  đang khoá, hoặc tài liệu người xoá không được xem theo độ mật, thì không xoá được.
- Khôi phục về chỗ cũ. Chỗ đó đã có mục cùng tên thì mục khôi phục thêm hậu tố
  "(khôi phục)"; chỗ cũ không còn thì `409 FOLDER_UNAVAILABLE` và người dùng chọn
  thư mục khác (`targetFolderId`).
- Xoá vĩnh viễn xoá dòng dữ liệu (kèm phiên bản, nhật ký truy cập) rồi xoá tệp
  trong kho theo lô. Kho từ chối thì chỉ ghi log, tệp mồ côi dọn sau. Mỗi lần xoá
  ghi một dòng vào `shared_schema.purge_log` (chỉ ghi thêm).
- Không tự dọn sau một số ngày: Thùng rác chỉ vơi khi có người xoá vĩnh viễn.

| Route | Ý nghĩa |
| --- | --- |
| `DELETE /v1/documents/:id`, `DELETE /v1/folders/:id` | chuyển vào Thùng rác |
| `POST /v1/documents/:id/duplicate` | nhân bản trong cùng thư mục, tệp sao chép ngay trong kho |
| `GET /v1/trash` | các mục đang ở Thùng rác |
| `POST /v1/trash/{folders,documents}/:id/restore` | khôi phục, thân `{ targetFolderId? }` |
| `DELETE /v1/trash/{folders,documents}/:id`, `DELETE /v1/trash` | xoá vĩnh viễn một mục, dọn sạch |

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
