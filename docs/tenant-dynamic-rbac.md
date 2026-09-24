# Phân quyền động Tenant Portal

## Phạm vi

- Tenant admin quản lý role, permission và gán nhiều role cho một người dùng.
- Permission là nhóm hành động Core/module được backend hỗ trợ; không phải mã quyền tùy ý do client khai báo.
- Core hỗ trợ `read/create/update/delete` cho `core.users` và `core.organization`.
- Role cấp riêng quyền vào module và quyền thao tác trong module. Quyền xử lý từng hồ sơ theo RACI bên trong Procedure giữ nguyên.
- Chưa triển khai package, quota quy trình, quota user, deny rule, role lồng nhau hoặc phân quyền theo từng bản ghi.

## Mô hình và quy tắc

```text
User ── user_roles ── Role ── role_permissions ── Permission ── actionKeys
                       └── role_modules ── moduleKey

Request → kiểm tra session/tenant → lấy revision hiện tại
        → cache quyền theo tenant + user + revision
        → kiểm tra action Core hoặc quyền module + entitlement
        → thực thi nghiệp vụ
```

Hướng dẫn áp dụng và danh mục quyền module: [Phân quyền Inventory, Maintenance, Procedure](./tenant-module-permissions.md).

Quyền hiệu lực là hợp các role, không có deny. Người dùng mới chưa có role thì không có quyền Core/module. Chỉ role hệ thống `tenant-admin` được quản trị phân quyền; không thể tự tạo permission `tenant.manage`, `platform.manage` hoặc wildcard.

Role hệ thống không được sửa/xóa. Role còn người dùng hoặc permission còn role sử dụng phải gỡ liên kết trước khi xóa. Không cho phép thu hồi/vô hiệu hóa admin đang hoạt động cuối cùng; các thao tác ghi phân quyền và tài khoản được tuần tự hóa trong transaction của từng tenant. Người chỉ có quyền sửa user không được sửa tài khoản có role admin, kể cả admin đang bị vô hiệu hóa.

Role/permission/assignment nằm trong DB riêng của tenant. Tenant lấy từ session, không lấy từ body. Các thao tác ghi qua portal kiểm tra CSRF. Nhật ký thay đổi role, permission và gán role lưu tại `core_schema.authorization_audit`, gồm trước/sau và không lưu mật khẩu.

## Cache qua nhiều request

- Cache trong bộ nhớ mỗi API instance: tối đa 2.000 cặp tenant/user, TTL 30 giây; tối đa 64 quyết định module trên mỗi entry.
- Mỗi request vẫn đọc revision và trạng thái user từ DB; thay đổi role, permission, assignment hoặc user tăng revision bằng trigger.
- Khi revision khác, bỏ kết quả cũ và tính lại. Các instance dùng chung revision trong DB nên không phụ thuộc thông báo invalidation.
- Session, trạng thái tenant và entitlement không dùng lại từ cache RBAC. Sau khi transaction thu hồi quyền commit, request mới phải kiểm tra quyền mới. Request đang xử lý trước đó không bị hủy hồi tố.
- Đây không phải cache toàn bộ phản hồi xác thực: vẫn có truy vấn DB mỗi request, nhưng tránh lặp các phép join tổng hợp quyền.

## API

Tiền tố: `/api/platform/v1`. Các API phân quyền dưới đây chỉ dành cho tenant admin.

| Endpoint | Method | Kết quả / dữ liệu ghi |
|---|---|---|
| `/tenant-permission-actions` | GET | Danh mục action Core |
| `/tenant-permissions` | GET, POST | Danh sách hoặc tạo `{ name, description, actionKeys }` |
| `/tenant-permissions/:id` | GET, PATCH, DELETE | Chi tiết, cập nhật, xóa permission |
| `/tenant-roles` | GET, POST | Danh sách hoặc tạo `{ name, description, permissionIds, moduleKeys }` |
| `/tenant-roles/:id` | GET, PATCH, DELETE | Chi tiết, cập nhật, xóa role |
| `/tenant-users/:id/roles` | GET, PUT | Xem/thay toàn bộ `{ roleIds }`; mảng rỗng thu hồi toàn bộ role |

API user và organization hiện có kiểm tra action tương ứng. Không gán role bằng trường `systemRole` trong API tạo/sửa user của portal. API gán role membership cũ bị chặn để tránh tồn tại đường cập nhật khác.

Lỗi chính: `400` dữ liệu không hợp lệ; `401` phiên/user không hoạt động; `403` thiếu quyền/CSRF; `404` không tìm thấy trong tenant; `409` trùng tên, còn liên kết, role hệ thống hoặc mất admin cuối cùng.

## Giao diện

- `/authorization`: danh sách–chi tiết, tab Vai trò/Permission, tìm kiếm, lọc, phân trang, popup tạo/sửa và xác nhận xóa tại nút.
- `/users`: popup gán nhiều role, xem quyền tổng hợp; CRUD user hiển thị theo quyền được cấp.
- Menu, trang organization và các thao tác liên quan kiểm tra quyền hiển thị; backend vẫn là nơi quyết định cho phép.
- Giữ component, màu và bố cục hiện tại của hệ thống; áp dụng SearchableSelect, Dialog và Popconfirm theo skill UI. Tham chiếu Stitch qua MCP, không thay đổi dự án Stitch.

## Cập nhật DB và chạy thử

Luồng migration: `0005-tenant-rbac-legacy-compat.sql` → `0005-tenant-rbac.sql` trong `migrations/tenant/core`. Không thay đổi checksum của migration RBAC gốc.

1. Sao lưu DB và xác nhận `.env`/biến môi trường trỏ đúng môi trường cần triển khai.
2. Chạy từ thư mục gốc: `pnpm nx run migrator:rbac-migrate`.
3. Build/khởi động API và web theo quy trình hiện có, đăng nhập Tenant Portal bằng admin và kiểm tra `/authorization`.

Target chuyên biệt chỉ chạy registry migration và RBAC cho DB tenant active/disabled có cấu hình DB active; không chạy seed hoặc cleanup CRM. Migration dừng khi không kết nối/resolve được DB. Tenant tạo mới được áp dụng RBAC trong provisioning.

DB chưa có RBAC được backfill một lần: tài khoản `tenant-admin` cũ nhận role admin, người dùng thường cũ nhận `legacy-tenant-user` để giữ quyền truy cập module nhưng không nhận quyền quản trị Core. Admin cần chuyển các user chuyển tiếp sang role phù hợp. Role chuyển tiếp không được gán mới. Chạy lại migration không phục hồi role đã thu hồi. Phiên tenant membership kiểu cũ cần đăng nhập lại bằng luồng Tenant Portal.

### Nâng cấp schema RBAC cũ (`code` / `permission_key`)

- Migration tương thích chạy trước RBAC, đổi `roles.code` thành `key`, chuẩn hóa `role_permissions.permission_id`; giữ ID role, liên kết user–role và thời điểm gán. Không backfill lại từ `users.system_role` khi đã có bảng gán role cũ, kể cả user đang không được gán role.
- Lưu bản chụp roles, role_permissions, role_modules, user_roles tại `core_schema.rbac_legacy_archive` trước khi chuyển đổi. Bản chụp dùng để đối chiếu/khôi phục có kiểm soát, không phải thao tác rollback tự động.
- Các action Core được hỗ trợ ánh xạ một-một sang permission. Quyền tương thích cũ của hai role hệ thống (`*`, `tenant.manage`, quyền module cũ) được giữ trong bản chụp; quyền hiệu lực mới của hai role này theo quy tắc hệ thống và module access, không biến wildcard thành permission tùy biến.
- Gặp role disabled, quyền tùy biến không có ánh xạ, tên trùng không phân biệt hoa thường, không có admin hoạt động hoặc schema trộn lẫn: dừng và báo lỗi để rà soát, không tự bật role hay nâng quyền. Không xóa/reset DB.
- DB mới hoặc DB đã có `permission_id` bỏ qua bước chuyển đổi. Chạy lại không nhân bản bản chụp hoặc phục hồi quyền đã thu hồi.
- Sau khi sao lưu và kiểm tra môi trường, chạy `pnpm nx run migrator:rbac-migrate` để chỉ cập nhật RBAC. `pnpm db:provision` cũng chạy bước tương thích, nhưng còn chạy các bước provision/seed/cleanup hiện hữu ngoài RBAC.

**Migration chưa được áp dụng vào dữ liệu tenant hiện có trong lần triển khai mã nguồn này.** Kiểm thử PostgreSQL dùng DB tạm độc lập, được dọn sau khi chạy.

## Kiểm thử

```powershell
pnpm nx run-many -t test lint typecheck -p platform-identity platform-data-import contracts-identity web web-e2e migrator api
pnpm nx run-many -t build -p api web migrator
pnpm nx run web-e2e:e2e-rbac
```

Để chạy integration test DB, đặt `RBAC_TEST_ADMIN_URL` tới PostgreSQL local dành cho kiểm thử có quyền tạo DB, rồi chạy `pnpm nx run platform-identity:test --skipNxCache`. Test tự tạo/xóa DB tên `rbac_test_<uuid>`; không sửa DB tenant hiện có. Không đưa mật khẩu thật vào tài liệu hoặc commit.

Các tình huống bao phủ: CRUD/gán/thu hồi, hợp quyền, cache và revision, phân tách tenant, chống nâng quyền, liên kết đang dùng, chạy lại migration và đồng thời thu hồi admin cuối cùng. Test giao diện chạy Chromium với API fixture riêng: tạo permission → role → gán user → sửa → thu hồi/xóa; user chỉ đọc và bố cục mobile. Đây là kiểm thử UI với fixture, không thay thế UAT toàn hệ thống bằng phiên đăng nhập thật và API/DB thật.

Kết quả kiểm tra mã nguồn: 43 test identity (có PostgreSQL integration, thêm 4 test nâng cấp schema cũ), 5 test data-import, 2 test API, 15 test web và 3 test Chromium qua. Test nâng cấp tái hiện lỗi `42703`, giữ 45 liên kết gán role, kiểm tra CRUD sau nâng cấp, chạy lại an toàn, ánh xạ Core và từ chối dữ liệu chưa hỗ trợ. Build API/web/migrator và typecheck qua; lint không có lỗi, còn 2 cảnh báo từ code có sẵn. React Doctor không có lỗi, còn 13 cảnh báo về độ phức tạp component/tra cứu mảng; chưa mở rộng thành đợt refactor ngoài phạm vi chức năng.
