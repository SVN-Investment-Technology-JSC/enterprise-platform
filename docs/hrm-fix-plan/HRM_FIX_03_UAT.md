# HRM_FIX_03 - FIX-C-13: Kiểm thử chấp nhận người dùng (UAT) kỳ lương mẫu

Mục tiêu: HR, kế toán và quản trị cùng chạy một kỳ lương mẫu trên dữ liệu thật của tenant, so khớp kết quả hệ thống với bảng tính tay, trước khi tin cậy cấu hình sau các bản sửa FIX-C-01..C-12.

## 1. Điều kiện tiên quyết

| # | Điều kiện | Cách kiểm tra | Đạt |
|---|---|---|---|
| 1 | Đã sao lưu DB tenant và chạy migration 0021, 0022, 0024, 0026 | Migrator báo thành công; bảng `schema_migrations` có đủ 4 phiên bản | |
| 2 | Chỉ còn 1 bản ghi chính sách ATTENDANCE ACTIVE | Truy vấn `policies` theo `policy_type='ATTENDANCE'`; index `ux_hrm_policies_one_active_per_type` tồn tại | |
| 3 | Công thức lương v1 đang ACTIVE, không có khoảng trống hiệu lực | Màn Cấu hình lương hiển thị timeline phiên bản liên tục | |
| 4 | Lịch nghỉ lễ của năm UAT đã nhập và HR xác nhận | Tab Lịch làm / OFF / lễ không còn banner cảnh báo | |
| 5 | Dữ liệu QA03 đã dọn (HRM_FIX_03_CLEANUP.sql) | Không còn mã bắt đầu bằng QA03 | |
| 6 | Vai trò mẫu HRM đã tạo; người tính, người chốt, kế toán là 3 tài khoản khác nhau | Màn Phân quyền HRM | |
| 7 | SoD lương BẬT | `GET /v1/payroll-sod-settings` trả cả hai cờ true | |

## 2. Nhân viên mẫu

Chọn 3 nhân viên đại diện, ghi số liệu gốc trước khi chạy.

| Mã | Đặc điểm | Lý do chọn |
|---|---|---|
| NV-A | Lương cố định, làm đủ công, không OT | Trường hợp cơ sở |
| NV-B | Có OT ngày thường, đêm và ngày lễ, có đi muộn trong dung sai | Kiểm tra hệ số OT và làm tròn |
| NV-C | Nghỉ phép có lương, nghỉ không lương, vào làm giữa kỳ | Kiểm tra công chuẩn, phép, tính theo tỷ lệ |

## 3. Các bước thực hiện

| Bước | Người thực hiện | Thao tác | Kết quả mong đợi |
|---|---|---|---|
| 1 | HR | Chốt công kỳ UAT | Bảng công khóa, không còn ngày thiếu dữ liệu |
| 2 | HR | Đối chiếu số công của 3 NV với bảng công tay | Khớp từng ngày |
| 3 | Quản trị | Dùng "Tính thử" công thức hiện hành cho 3 NV | Ra kết quả nháp, không ghi DB |
| 4 | Kế toán | Tự tính tay lương 3 NV theo công thức đã duyệt | Có bảng tính tay |
| 5 | Người tính | Chạy tính lương kỳ UAT | Kỳ ở trạng thái đã tính; ghi `calculated_by` |
| 6 | Người tính | Thử tự chốt lương | Bị chặn 403 SEGREGATION_OF_DUTIES |
| 7 | Người chốt | Chốt lương | Thành công nếu khác người tính |
| 8 | Người chốt | Thử phát hành phiếu lương | Bị chặn nếu cùng người chốt (theo cờ SoD) |
| 9 | Người phát hành | Phát hành phiếu lương | Phiếu của NV hiển thị đúng |
| 10 | Kế toán | Ghi nhận chi trả | Thành công nếu khác người chốt |
| 11 | Quản trị | Chạy đối soát số dư phép | Không có chênh lệch, hoặc chênh lệch đã giải thích |

## 4. Bảng so sánh kết quả

| Khoản | NV | Tay tính | Hệ thống | Chênh lệch | Đạt |
|---|---|---|---|---|---|
| Công thực tế | A | | | | |
| Lương cơ bản theo công | A | | | | |
| Công thực tế | B | | | | |
| Giờ OT theo hệ số | B | | | | |
| Tiền OT | B | | | | |
| Khấu trừ đi muộn | B | | | | |
| Công chuẩn tháng | C | | | | |
| Lương theo tỷ lệ (vào giữa kỳ) | C | | | | |
| Phép có lương / không lương | C | | | | |
| Tổng thực lĩnh | A, B, C | | | | |

Dung sai chấp nhận: 0 đồng cho từng khoản đã làm tròn theo quy tắc công thức.

## 5. Bảng sai lệch

| # | Khoản | Nguyên nhân nghi ngờ | Người xử lý | Trạng thái |
|---|---|---|---|---|
| | | | | |

## 6. Ký xác nhận

| Vai trò | Họ tên | Ngày | Kết luận (Đạt / Không đạt) | Ký |
|---|---|---|---|---|
| Trưởng nhóm HR | | | | |
| Kế toán trưởng | | | | |
| Quản trị hệ thống | | | | |

Kỳ UAT chỉ được coi là đạt khi cả 3 bên cùng ký Đạt và bảng sai lệch không còn mục mở.
