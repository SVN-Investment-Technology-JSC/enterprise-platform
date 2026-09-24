# Phân quyền thao tác trong module

## Nguyên tắc

Một người dùng chỉ được thao tác khi tenant có module đang kích hoạt, role cho phép vào module và có quyền thao tác tương ứng. Quyền của nhiều role cộng dồn; bỏ quyền ở một role không thu hồi quyền vẫn được cấp bởi role khác.

Core quản lý danh mục action, permission và role. Module kiểm tra action ở API và áp dụng luật nghiệp vụ riêng. Với Procedure, việc sửa ma trận RACI khác với việc thực hiện một bước trong hồ sơ.

## Danh mục hỗ trợ

| Module | Action | Phạm vi |
|---|---|---|
| Inventory | `inventory.read` | Đọc dữ liệu kho, vật tư, tài sản |
| Inventory | `inventory.transaction.write` | Nhập/xuất/chuyển kho, tạo/giải phóng giữ chỗ; cần thêm `inventory.read` |
| Inventory | `inventory.manage` | Quản lý danh mục, tài sản, cấu hình, tài liệu, sê-ri, lắp/tháo vật tư; bao gồm quyền đọc và giao dịch |
| Maintenance | `maintenance.read` | Đọc lịch, ma trận, hồ sơ bảo trì |
| Maintenance | `maintenance.occurrence.manage` | Tạo sự cố, hoàn tất đợt, quản lý tệp hồ sơ; cần thêm `maintenance.read` |
| Maintenance | `maintenance.manage` | Quản lý lịch, ma trận, chạy lịch, cấu hình; bao gồm quyền đọc và xử lý đợt |
| Procedure | `procedure.definition.manage` | Tạo/sửa định nghĩa, phân vai RACI, nhóm, cấu hình và đưa về nháp |
| Procedure | `procedure.definition.publish` | Công bố/lưu trữ; xem được bản nháp nhưng không mặc nhiên sửa RACI |
| Procedure | `procedure.instance.create` | Khởi tạo hồ sơ; còn phải được phân vai S ở bước đầu, trừ người có quyền override |
| Procedure | `procedure.instance.override` | Can thiệp vượt phân vai RACI và xóa hồ sơ; không tự cấp quyền sửa/công bố/khởi tạo |

Xóa định nghĩa quy trình cần cả `procedure.definition.manage` và `procedure.instance.override`, đồng thời tuân thủ ràng buộc nghiệp vụ hiện có. Quyền override nhạy cảm, không cấp cho nhân viên thông thường. Không có action mới cho từng vai R/A/C/S/I/E: module tự xác định hành động từ phân công và trạng thái hồ sơ.

Tenant admin có toàn bộ action được hỗ trợ, nhưng vẫn chịu điều kiện tenant/module đang kích hoạt. Module access đơn thuần không cấp thêm action. Riêng Procedure, người có module access có thể xem định nghĩa đã công bố và xử lý hồ sơ trong phạm vi RACI của mình mà không cần quyền thiết kế.

## Hướng dẫn thao tác

### 1. Nạp phiên bản mới

1. Nếu đang chạy môi trường dev: dừng lệnh `pnpm dev` hiện tại bằng Ctrl+C.
2. Tại thư mục gốc, chạy `pnpm nx run contracts-identity:build`, sau đó `pnpm dev`.
3. Tải lại trang và đăng nhập bằng **tenant admin**, không dùng tài khoản Platform Superadmin.

Đợt bổ sung action module không thay đổi schema hoặc migration đã áp dụng. Nếu tenant đã chạy migration RBAC trước đó thì không cần chạy lại `db:provision` cho thay đổi này. Chưa áp dụng migration RBAC thì xem quy trình migration chuyên biệt trong `tenant-dynamic-rbac.md` trước.

### 2. Nhân viên xử lý Procedure nhưng không sửa RACI

1. Vào **Vai trò & phân quyền** (`/authorization`) → tab **Permission** → **Tạo permission**.
2. Đặt tên `Khởi tạo hồ sơ quy trình`, chọn `procedure.instance.create` → **Lưu**. Nếu nhân viên chỉ xử lý hồ sơ được giao và không khởi tạo, bỏ qua permission này.
3. Sang tab **Vai trò** → **Tạo vai trò**, đặt tên `Nhân viên quy trình`.
4. Chọn module Quy trình/Procedure Engine và permission vừa tạo. Không chọn quyền thiết kế, công bố hoặc override → **Lưu**.
5. Vào **Người dùng** (`/users`) → **Vai trò** tại người cần gán → chọn `Nhân viên quy trình` → **Lưu vai trò**. Kiểm tra và gỡ role khác đang cấp quyền rộng hơn nếu mục tiêu là hạn chế người này; không gỡ admin cuối cùng.
6. Trong Procedure, người có quyền thiết kế phân vai RACI cho người dùng/chức danh/đơn vị tương ứng; người có quyền công bố công bố định nghĩa. Nhân viên cần vai S ở bước đầu nếu được khởi tạo.
7. Mở cửa sổ trình duyệt riêng, đăng nhập nhân viên → vào Procedure. Không có nút thêm/sửa/công bố RACI; vẫn xem quy trình đã công bố và thực hiện hành động đúng vai ở hồ sơ.
8. Thử tạo hồ sơ: chỉ thành công nếu có `procedure.instance.create` và đúng vai S. Việc tự gọi API sửa định nghĩa vẫn bị từ chối 403.

### 3. Các role thường dùng

| Role mẫu | Module access | Action nên chọn |
|---|---|---|
| Nhân viên chỉ xem kho | Inventory | `inventory.read` |
| Nhân viên nhập/xuất kho | Inventory | `inventory.read`, `inventory.transaction.write` |
| Quản lý kho | Inventory | `inventory.manage` |
| Kỹ thuật viên bảo trì | Maintenance | `maintenance.read`, `maintenance.occurrence.manage` |
| Quản lý bảo trì | Maintenance | `maintenance.manage` |
| Người thiết kế quy trình | Procedure Engine | `procedure.definition.manage` |
| Người công bố quy trình | Procedure Engine | `procedure.definition.publish` |

Tạo một permission gồm các action trong bảng, gắn vào role cùng module access, rồi gán role cho người dùng. Một người có thể giữ nhiều role. Không cần tạo user mới để thử phân quyền.

### 4. Kiểm tra thu hồi

1. Đăng nhập nhân viên, thực hiện một thao tác được phép để kiểm tra đường cấp quyền.
2. Ở phiên admin, gỡ permission/action hoặc gỡ role khỏi người dùng.
3. Ở phiên nhân viên, tải lại màn hình và thử lại: nút phù hợp bị ẩn/vô hiệu hóa; API kiểm tra lại quyền ở request tiếp theo.

Cache được dùng qua nhiều request nhưng mỗi lần xác thực đọc revision/user-active. Thay đổi role/permission làm revision tăng và loại kết quả quyền cũ, kể cả qua replica khác. Request đang thực thi trước thời điểm thu hồi không bị hủy giữa chừng. Giao diện đang mở cần tải lại để nhận capability mới.

## Lưu ý triển khai và phạm vi

- User cũ với `legacy-tenant-user` chỉ giữ module access, không tự nhận quyền ghi. Admin phải gán role phù hợp, đặc biệt bổ sung quyền đọc Inventory/Maintenance.
- Màn giao dịch Inventory có thao tác hỗn hợp: tạo mã vật tư, khai sê-ri lúc nhập và xuất lắp đặt cần `inventory.manage`. Giao diện kiểm tra trước khi ghi phiếu để tránh nhập kho xong mới phát hiện thiếu quyền khai sê-ri.
- Capability Inventory lấy từ `GET /api/inventory/v1/capabilities`; Procedure/Maintenance lấy từ workspace. Cờ UI không thay thế kiểm tra quyền server.
- Các phần Inventory đang dùng dữ liệu cục bộ trước đợt này (lô hàng, kiểm kê, một phần nhật ký sự cố) được giới hạn thao tác trên UI; chưa chuyển thành API/lưu trữ backend. Không xem dữ liệu cục bộ là dữ liệu đã được phân tách và bảo vệ bằng RBAC server. Việc chuyển các chức năng này sang backend là phạm vi riêng.
- Tích hợp service-to-service vẫn dùng cơ chế định danh dịch vụ và kiểm tra tenant/module hiện có; không biến capability của user thành token dịch vụ.
- Không triển khai thêm package/quota, không thay đổi phân công RACI có sẵn, không tự gán role vào dữ liệu thật và không commit mã nguồn.

## Kiểm thử

- Identity: cấp/gỡ action module, độc lập module access, quyền quản lý bao hàm quyền con, cache/revision, PostgreSQL nhiều tenant và replica.
- Procedure: quyền thiết kế/công bố/khởi tạo tách biệt, giữ điều kiện vai S và quyền xóa hồ sơ.
- API guards: từ chối sửa khi chỉ đọc, cho phép thao tác hẹp, không dùng quyền quản trị cũ trong JWT để vượt kết quả quyền mới.
- Giao diện: danh mục permission mở rộng, capability điều khiển nút; test Procedure kiểm tra người chỉ đọc, người công bố và quyền tạo hồ sơ.
- Test dùng fixture/DB kiểm thử tạm; cần UAT bằng tài khoản và dữ liệu nghiệp vụ thực tế trước khi triển khai công ty.

Kết quả: 125 test qua (47 Identity có PostgreSQL integration, 40 Procedure application/domain, 15 API guards/API, 8 UI Inventory/Procedure và 15 Core web). Typecheck các phần thay đổi qua; lint không có lỗi, còn cảnh báo trong code hiện hữu. Không chạy lại bộ Chromium hoặc production build toàn hệ thống trong đợt bổ sung module này.

React Doctor đã kiểm tra Core và ba feature UI. Lỗi hook có điều kiện mới phát hiện tại SerialPanel được sửa. Còn cảnh báo độ phức tạp/hiệu năng; một báo lỗi `no-impure-state-updater` tại Inventory được đối chiếu là nhận diện nhầm: callback truyền vào hàm xử lý sự kiện `perform`, được gọi trực tiếp bằng `await run()`, không phải callback của React state setter. Không tắt hoặc suppress rule.
