# Thay đổi 21/8

## I/ Core
- Xoá nút truy cập CRM
- Bổ sung quyền sử dụng module của từng user
- “Thao tác nhanh” chưa thao tác được
- Page “báo cáo” và “cài đặt” thiếu

## II/ Module: 
- Tất cả các module đều có 1 trang dashboard khi truy cập(các mục trong dashboard được admin tuỳ chọn, ví dụ dev chuẩn bị 10 thẻ, và admin sẽ chọn 5 trong 10 thẻ đó, trong mục cài đặt của module), đồng thời thanh navigate dời sang cạnh trái

### 1/ Kho:
- Gộp thiết bị và vật tư thành vật tư.
- Thêm mục phụ tùng (tùy chọn) và tài liệu đính kèm theo từng vật tư
- Thêm trường đơn vị trong mục thuộc tính thiết bị
- Thêm mục tình trạng, giá, bảo hành ở trang liệt kê
- Các thuộc tính (đơn vị, thông số...) các trạng thái tình trạng, giá, bảo hành đều được admin tuỳ chỉnh hay bật/tắt ở mục cấu hình

### 2/ Bảo trì
- Sửa lỗi thông tin công việc không get từ kho (khi kho có thay đổi các bước bảo trì thì cập nhật ở module bảo trì thiết bị (vật tư))
- “Tần suất” tại ma trận bảo trì động được tạo sửa xoá bởi admin trong thẻ cấu hình module
- Tại ma trận bảo trì, ở mỗi thiết bị có thêm nút thêm thiết bị(chọn theo tên), xóa thiết bị, và nút thực hiện bảo trì (tạo work order bảo trì lập tức)
- Xóa nút Chạy scheduler

### 3/ Quy trình
- Thêm nhóm cho quy trình tại ma trận (các nhóm này để tạo tự động 5 nhóm nhưng admin có thể bật tắt tính năng này và thay đổi (thêm/xóa nhóm) → Thêm filter khi tạo workorder/giao diện workspace. Quy trình nháp phải có nhóm mới được công bố
- Khi workorder được tạo theo yêu cầu thiết bị thì fetch data các bước bảo trì theo kho.
- Ở work order có E. Thì việc phân rã E thành các E(x), cho phép chủ role E lựa chọn thiết bị/công cụ (vật tư) được fetch từ kho để xem số lượng thiết bị, xem số lượng vật tư. Nếu đủ thì khi nhấn “lưu”, quy trình mượn/xuất kho ngay lập tức được kích hoạt(quy trình nào do người chủ E chọn). nếu không đủ thì nhấn “thiếu”, chọn quy trình mua mới(cũng do người chủ E chọn). Các role khác ngoài E thì chủ role cũng có quyền chọn vật tư với logic tương tự
- Cập nhật UI tiến trình hoàn thành khi workorder quay lại bằng C hoặc A thì sai, đồng thời mặc định thì khi chưa có ai thao tác ở từng bước sẽ trống (không có phần xanh)
- Cập nhật UI trao đổi theo luồng, tách “Trao đổi” thành “trao đổi” và “Lịch sử thao tác” tổ chứa cả 2 theo luồng, loop nếu có C, A. Nhằm trực quan khi giám sát
- UI ma trận thay đổi:
  - Xóa mục “cả đơn vị”
  - Đơn vị trưởng có màu nền ở khác member
  - Khi admin gắn role S vào khối đơn vị, thì tất cả thành viên đơn vị đó đều để S, các role khác thì mặc định gắn cho đơn vị trưởng
  - Admin có mọi quyền thực hiện mọi role, lịch sử thao tác ghi thao tác bởi admin
