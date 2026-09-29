# HƯỚNG DẪN SỬ DỤNG — 03. BẢO TRÌ PHÒNG NGỪA (CMMS)

> Phạm vi: Ma trận bảo trì, lịch bảo trì, phiếu phát sinh, lịch sử/nghiệm thu và cài đặt module (ảnh 44–58). Module sử dụng thiết bị, đầu việc và phụ tùng đã được khai báo trong Nhà kho & Cây tài sản.

## 1. Mục tiêu và điều kiện sử dụng

Module Bảo trì giúp lập kế hoạch bảo trì phòng ngừa, theo dõi các lần thực hiện và tạo hồ sơ cho sự cố phát sinh. Trước khi thiết lập, nên bảo đảm thiết bị, mức độ quan trọng, đầu việc và BOM trong Inventory đã chính xác.

| Quy ước | Ý nghĩa |
|---|---|
| Hộp chọn có tìm kiếm | Gõ mã/tên để tìm, chọn bằng `Enter`. |
| Tần suất | Ngày, Tuần, Tháng, Quý hoặc Năm. Một thiết bị có thể theo nhiều kế hoạch tùy cấu hình. |
| Drawer | Ngăn chi tiết bên phải, dùng để xem đầu việc/lịch sử hoặc nghiệm thu. |
| Popconfirm | Hộp xác nhận ngay tại nút; dùng cho thao tác gỡ thiết bị. |
| `*` | Trường bắt buộc, cần hoàn tất trước khi lưu/đánh dấu hoàn thành. |

### Trình tự vận hành khuyến nghị

1. Bổ sung thiết bị vào ma trận bảo trì và chọn chu kỳ/luồng xử lý.
2. Tạo lịch bảo trì định kỳ.
3. Khi đến hạn, mở hồ sơ lịch sử để ghi nhận nội dung thực hiện, bằng chứng và nghiệm thu.
4. Lập phiếu phát sinh cho sự cố ngoài kế hoạch.
5. Dùng báo cáo/lịch sử để rà soát chất lượng bảo trì và cập nhật ma trận khi cần.

## 2. Ma trận bảo trì

![Ma trận bảo trì](./images/screen_44.png)

### 2.1. Thành phần trên ma trận

| Thành phần | Loại UI | Cách dùng | Kết quả |
|---|---|---|---|
| Tìm trên ma trận | Input tìm kiếm | Nhập mã/tên, ví dụ `MBA-01` | Lọc nhanh thiết bị trong ma trận. |
| `+ Thêm thiết bị từ Kho` | Button | Tìm và chọn thiết bị từ Inventory | Bổ sung thiết bị cần theo dõi bảo trì. |
| Tất cả đơn vị | Hộp chọn có tìm kiếm | Chọn đơn vị để lọc | Chỉ hiển thị thiết bị thuộc phạm vi cần xem. |
| Mức ưu tiên | Hộp chọn có tìm kiếm | Lọc theo độ ưu tiên | Tập trung vào nhóm thiết bị quan trọng. |
| Checkbox Ngày/Tuần/Tháng/Quý/Năm | Checkbox | Chọn chu kỳ bảo trì cho từng dòng | Khai báo tần suất thực hiện. |
| Luồng thực thi khi tạo lệnh | Hộp chọn có tìm kiếm | Chọn quy trình, ví dụ `BT_DK_TB - Q` | Xác định luồng xử lý khi sinh lệnh. |
| `Bảo trì ngay` | Button | Dùng cho đợt ngoài chu kỳ | Kích hoạt bảo trì đột xuất cho thiết bị. |
| `Gỡ` | Button cảnh báo | Dừng quản lý thiết bị trong ma trận | Mở xác nhận gỡ. |
| Tên thiết bị | Link/row action | Nhấp vào tên | Mở drawer chi tiết thiết bị trong bối cảnh CMMS. |

### 2.2. Thêm thiết bị và thiết lập chu kỳ

![Chọn thiết bị từ Kho](./images/screen_45.png)

1. Nhấn `+ Thêm thiết bị từ Kho`.
2. Gõ tên hoặc mã thiết bị, chọn đúng đối tượng trong popup và xác nhận.
3. Trên dòng thiết bị mới, tích các chu kỳ cần áp dụng: **Ngày**, **Tuần**, **Tháng**, **Quý**, **Năm**.
4. Chọn **Luồng thực thi khi tạo lệnh** cho đúng loại công việc.
5. Kiểm tra đơn vị và mức ưu tiên, sau đó lưu theo thao tác của màn hình.

> Không đưa thiết bị vào ma trận chỉ để theo dõi đơn thuần. Thiết bị nên có đầu việc/kế hoạch rõ ràng để tránh sinh lệnh không thể nghiệm thu.

### 2.3. Xem chi tiết từ drawer

![Drawer chi tiết thiết bị bảo trì](./images/screen_47.png)

| Tab / liên kết | Nội dung | Cách dùng |
|---|---|---|
| `1. Đầu việc (Kho)` | Danh sách bước kiểm tra lấy từ Inventory | Rà soát đầu việc, phụ tùng và hướng dẫn kỹ thuật trước khi thực hiện. |
| `2. Lịch sử bảo trì` | Các lần can thiệp trước đó | Đối chiếu ngày thực hiện, kết quả và người xử lý. |
| `Sửa trong Kho →` | Hồ sơ thiết bị nguồn | Mở Inventory khi cần thay đổi dữ liệu kỹ thuật/cây tài sản. |

### 2.4. Bảo trì ngay và gỡ thiết bị

- Dùng `Bảo trì ngay` khi thiết bị cần được xử lý ngoài chu kỳ. Kiểm tra thiết bị và luồng thực thi trước khi tạo lệnh.
- Dùng `Gỡ` khi không còn muốn thiết bị xuất hiện trong ma trận. Hệ thống hiển thị Popconfirm; đọc tên thiết bị, nhấn `Gỡ thiết bị` để xác nhận hoặc `Hủy` để giữ nguyên.

![Xác nhận gỡ thiết bị](./images/screen_48.png)

> Gỡ khỏi ma trận không phải là xóa thiết bị khỏi Kho. Muốn thay đổi thông tin gốc hoặc cấu trúc thiết bị, dùng liên kết `Sửa trong Kho →`.

## 3. Lập lịch bảo trì và phiếu phát sinh

![Lập lịch bảo trì](./images/screen_51.png)

### 3.1. Tạo lịch bảo trì

1. Tại khu vực lịch, nhấn `+ Tạo lịch bảo trì`.
2. Chọn thiết bị/đầu việc phù hợp từ ma trận hoặc danh sách có sẵn.
3. Chọn ngày, chu kỳ, người/phòng ban phụ trách và các thông tin được yêu cầu trên form.
4. Rà soát xung đột lịch hoặc thời hạn, sau đó lưu.

| Thành phần | Loại UI | Hướng dẫn |
|---|---|---|
| `+ Tạo lịch bảo trì` | Button | Mở popup tạo lịch cho công việc phòng ngừa. |
| Thiết bị, đầu việc, người phụ trách | Hộp chọn có tìm kiếm | Chọn đúng dữ liệu nguồn và trách nhiệm thực hiện. |
| Ngày/kỳ thực hiện | DatePicker / cấu hình tần suất | Xác định thời điểm và chu kỳ công việc. |
| Lưu | Button | Ghi lịch sau khi kiểm tra nguồn lực và phạm vi. |

### 3.2. Lập phiếu phát sinh

![Tạo sự cố bảo trì](./images/screen_53.png)

Trong tab **Phiếu phát sinh**, dùng nút `Tạo sự cố` khi có bất thường không chờ đến lịch định kỳ.

1. Mở tab **Phiếu phát sinh**.
2. Nhấn `Tạo sự cố`.
3. Chọn/kiểm tra thiết bị liên quan, mô tả biểu hiện, mức ưu tiên và các thông tin bắt buộc trong popup.
4. Lưu phiếu để đưa sự cố vào luồng xử lý và theo dõi.

| Tình huống | Chức năng nên dùng |
|---|---|
| Công việc đã có lịch đến hạn | Lịch bảo trì định kỳ. |
| Hỏng hóc/bất thường cần xử lý ngay | `Tạo sự cố` tại Phiếu phát sinh. |
| Cần kiểm tra ngoài chu kỳ nhưng không nhất thiết là sự cố | `Bảo trì ngay` tại ma trận. |

## 4. Ghi nhận thực hiện và nghiệm thu

![Lịch sử bảo trì](./images/screen_54.png)

### 4.1. Mở hồ sơ và ghi nhận

1. Trong danh sách lịch sử, nhấp dòng công việc cần cập nhật.
2. Drawer bên phải mở ra; kiểm tra thiết bị, đầu việc và trạng thái.
3. Nhập **Nội dung thực hiện & Đánh giá kết quả**.
4. Tải **Tệp đính kèm / Biên bản nghiệm thu & Ảnh hiện trường** khi có.
5. Rà soát một lần cuối, sau đó nhấn `Đánh dấu hoàn thành`.

![Drawer nghiệm thu](./images/screen_55.png)

| Thành phần | Loại UI | Bắt buộc | Hướng dẫn |
|---|---|---:|---|
| Nội dung thực hiện & Đánh giá kết quả | Textarea | Có | Ghi công việc đã làm, phát hiện, kết quả và kiến nghị. |
| Tệp đính kèm / Biên bản nghiệm thu & Ảnh hiện trường | Upload | Theo quy định nội bộ | Đính kèm bằng chứng theo đúng hồ sơ và thời điểm. |
| `Đánh dấu hoàn thành` | Button xác nhận | — | Đóng công việc sau khi nội dung và bằng chứng đầy đủ. |

### 4.2. Sau khi hoàn thành

![Trạng thái sau nghiệm thu](./images/screen_56.png)

Drawer hiển thị kết quả sau khi hoàn tất để người dùng đối chiếu. Không dùng trạng thái hoàn thành nếu công việc vẫn còn lỗi, thiếu bằng chứng hoặc cần tiếp tục xử lý; cập nhật/trao đổi theo quy trình nội bộ trước khi chốt.

## 5. Cài đặt module Bảo trì

![Cài đặt Bảo trì](./images/screen_57.png)

### 5.1. Thẻ tổng quan

Trong tab **Thẻ tổng quan**, bật/tắt các thẻ trên Dashboard và sắp xếp vị trí hiển thị theo ưu tiên quản trị. Chỉ bật chỉ số mà bộ phận thực sự theo dõi để Dashboard dễ đọc.

### 5.2. Tần suất bảo trì

![Cấu hình tần suất](./images/screen_58.png)

| Thành phần | Loại UI | Hướng dẫn |
|---|---|---|
| Checkbox bật/tắt | Checkbox | Kích hoạt hoặc ngưng một cấu hình tần suất. |
| Số lượng | Number input | Nhập chu kỳ, ví dụ `2`. |
| Đơn vị | Hộp chọn có tìm kiếm | Chọn Ngày, Tuần, Tháng hoặc đơn vị hệ thống hỗ trợ. |

Ví dụ: `2` + `Tuần` nghĩa là lặp lại theo chu kỳ hai tuần. Cần thống nhất quy ước tần suất với kế hoạch bảo trì và năng lực thực hiện thực tế.

## 6. Kiểm tra nhanh và xử lý tình huống

| Vấn đề | Cách kiểm tra/xử lý |
|---|---|
| Không tìm thấy thiết bị trong ma trận | Kiểm tra thiết bị đã tồn tại trong Inventory, trạng thái/quyền truy cập và dùng `+ Thêm thiết bị từ Kho`. |
| Không có đầu việc trong drawer | Bổ sung kế hoạch/đầu việc ở hồ sơ thiết bị trong Inventory. |
| Không nên gỡ thiết bị nhưng đã mở xác nhận | Nhấn `Hủy`; không xác nhận gỡ. |
| Không đánh dấu hoàn thành được | Kiểm tra trường bắt buộc, đặc biệt nội dung thực hiện/đánh giá và bằng chứng theo yêu cầu. |
| Tạo nhầm lịch | Xử lý theo quyền/quy trình quản trị lịch, tránh đánh dấu hoàn thành một công việc chưa thực hiện. |
| Sự cố cần theo dõi liên phòng ban | Tạo Phiếu phát sinh, mô tả đủ bối cảnh và dùng luồng được cấu hình. |

## 7. Checklist bàn giao vận hành

- [ ] Thiết bị quan trọng đã có đầu việc, thông số và BOM phù hợp trong Inventory.
- [ ] Ma trận đã có đúng thiết bị, mức ưu tiên, chu kỳ và luồng thực thi.
- [ ] Người xử lý hiểu cách mở drawer và ghi nhận kết quả/bằng chứng.
- [ ] Quy tắc sử dụng Bảo trì ngay, Tạo sự cố và Gỡ thiết bị đã được thống nhất.
- [ ] Tần suất và thẻ Dashboard phản ánh nhu cầu quản trị thực tế.
