# Kế Hoạch Bổ Sung: Hướng Dẫn Chi Tiết Từng Button, Select Box & Trích Xuất Ảnh Minh Họa Từ PDF

Tài liệu này nâng cấp bản kế hoạch biên soạn tài liệu HDSD theo yêu cầu cụ thể:
1. **Chi tiết hóa từng nút bấm (Button), hộp chọn (Select Box/Combobox), ô nhập liệu (Input)** trong từng giao diện.
2. **Trích xuất trực tiếp toàn bộ 85 trang ảnh từ file PDF** gốc (`Screens of the SaaS system modules.pdf`), đặc biệt là các trang **đã có khoanh tròn viền đỏ** để làm ảnh minh họa trực quan đối chiếu.

---

## 1. Phương Án Xử Lý Hình Ảnh Trực Tiếp Từ PDF

- **Nguồn ảnh**: Trích xuất độ nét cao (PNG/JPG) từng trang từ `Screens of the SaaS system modules.pdf`.
- **Thư mục lưu trữ ảnh**: `docs/user-guide/images/`
  - Đặt tên chuẩn hóa dễ tra cứu: `screen_01_core_dashboard.png`, `screen_13_inventory_select_devices.png`, `screen_48_maint_popconfirm_remove.png`, `screen_80_proc_rcsi_matrix.png`, v.v.
- **Tận dụng các ảnh có chú thích khoanh vùng đỏ**:
  - File PDF gốc đã có rất nhiều trang khoanh vùng đỏ trọng tâm (Ví dụ: Trang 9-11 khoanh cụm cây thiết bị, Trang 13 khoanh checkbox chọn nhiều, Trang 14-16 khoanh nút gỡ vật tư & chọn Work Order, Trang 22 khoanh thêm thông số mới, Trang 24 khoanh nút ghi nhận sự cố, Trang 29 khoanh hàng đầu việc mới, Trang 31-33 khoanh khu vực yêu cầu cấp phát & nút xử lý, Trang 35 & 37 khoanh nút Thêm/Xuất/Nhập, Trang 41 khoanh tab Kiểm kê, Trang 48 khoanh popconfirm gỡ thiết bị, v.v.).
  - Các hình ảnh này sẽ được nhúng trực tiếp ngay trước/sau phần giải thích bảng nút bấm để người dùng đối chiếu vị trí tức thì.

---

## 2. Quy Chuẩn Đặc Tả "Button - Select Box - Input" (UI Elements Specification)

Mỗi màn hình/popup trong tài liệu sẽ có **Bảng đặc tả thành phần tương tác (UI Elements Table)** chuẩn hóa:

| Tên phần tử | Loại UI (Type) | Vị trí trên ảnh | Ý nghĩa / Chức năng | Hành động của hệ thống khi click/chọn |
|---|---|---|---|---|
| **[Tên Nút / Trường]** | `Button` / `SearchableSelect` / `Input` / `Checkbox` / `Switch` / `Popconfirm` | Tọa độ / Khu vực khoanh đỏ | Giải thích trường dùng để làm gì | Mở Drawer / Mở Popup / Lưu / Điều hướng / Tải file |

---

## 3. Khung Chi Tiết Các Màn Hình Chứa Khoanh Vùng Đỏ & Nút Bấm Trọng Yếu

### A. Core Platform (Tenant Portal)
- **Dashboard (Trang 1)**:
  - Button `Mở ->`: Chuyển trực tiếp sang phân hệ tương ứng.
  - Button `+ Thêm người dùng`, `Quản lý vai trò`, `Cài đặt công ty`.
- **Cây sơ đồ tổ chức (Trang 3 - 6)**:
  - Button `+ Thêm sơ đồ`, `+ Thêm node`, `Lưu vị trí các node`, `Sửa`.
  - Form tạo node: `Select Box Sơ đồ`, `Select Box Node cha` (hoặc Node gốc), `Select Box Loại node` (COMPANY, BOARD, DIVISION, DEPARTMENT, POSITION...), `Input Tên node`, `Input Mã node`, `Input Thứ tự`.
  - Tab Bổ nhiệm: Button `+ Bổ nhiệm người dùng`, `Select Box Chức danh`, `Select Box Người dùng`, DatePicker `Từ ngày - Đến ngày`, Checkbox `Vị trí chính`.
- **Quản lý người dùng (Trang 7)**:
  - Button `+ Thêm người dùng`, Action `Chỉnh sửa`, `Vô hiệu hóa`, `Xóa người dùng`.

---

### B. Phân Hệ Nhà Kho & Cây Tài Sản (Inventory)
- **Cây thiết bị vận hành (Trang 8 - 11 [Có khoanh vùng đỏ])**:
  - Button `Dạng bảng`: Chuyển sang màn hình Data Table danh mục.
  - Button `Thu`: Thu gọn toàn bộ cây.
  - Button `+ Gốc`: Tạo node thiết bị cấp cao nhất.
  - Input `Tìm theo mã hoặc tên thiết bị... (Phím ↑↓ điều hướng)`.
  - Icon `+` và `-` trực tiếp trên từng nhánh node: Mở rộng/Thu gọn cấp con.
- **Xem thiết bị dạng bảng & Thao tác hàng loạt (Trang 12 - 14 [Khoanh đỏ Checkbox & Nút Gỡ hàng loạt])**:
  - Checkbox chọn từng dòng / Checkbox chọn tất cả.
  - Button đỏ nổi bật `Gỡ X thiết bị đã chọn` (Trang 13).
  - Form popup `Tháo dỡ / Gỡ thiết bị hàng loạt` (Trang 14):
    - `Select Box Áp dụng kho chung cho tất cả các dòng`.
    - `Select Box Kho tiếp nhận *` trên từng dòng thiết bị.
    - Input `Ghi chú tháo dỡ` (lý do).
    - Button `Xác nhận tháo dỡ (X thiết bị)`.
- **Lắp đặt vật tư vào thiết bị (Trang 15 [Khoanh đỏ nút + trên node])**:
  - Click icon `+` trên node `te (TE#1)` -> Mở popup "Lắp vật tư vào thiết bị".
  - `SearchableSelect Vật tư cần lắp *`: Gõ mã hoặc tên vật tư trong kho.
  - `Select Box Xuất từ kho *`: Hiển thị số lượng khả dụng (VD: Kho Dự phòng Miền Nam - Khả dụng: 115 Cái).
  - Input `Số lượng *`.
  - Textarea `Ghi chú lắp đặt`.
  - Button `Xác nhận xuất kho & lắp`.
- **Tháo dỡ đơn lẻ & Mở Work Order (Trang 16 [Khoanh đỏ nút - trên node & Select Box Work Order])**:
  - Click icon `-` trên node -> Mở popup "Tháo dỡ / Thanh lý".
  - `Select Box Kho tiếp nhận *`.
  - `Select Box Quy trình liên kết mở Work Order (không bắt buộc)`: Tự động khởi tạo Work Order bên module Quy trình khi tháo dỡ (VD: *QT-KIEM-KE*, *QT-HD-KH*, *QT-BAO-GIA*).
  - Button `Xác nhận nhập về kho`.
- **Kéo thả điều chuyển node (Trang 17 [Khoanh đỏ vị trí kéo thả])**:
  - Hướng dẫn thao tác Drag & Drop trực quan nhánh cáp/thiết bị từ vị trí cha này sang vị trí cha khác.
- **Chi tiết thiết bị & QR Code (Trang 18 - 23 [Khoanh đỏ các nút Thao tác & Tab])**:
  - Button `Chỉnh sửa`: Mở form sửa nhanh tên, trạng thái, độ quan trọng (Trang 19).
  - Button `+ Thêm thiết bị con`: Tạo nhánh phụ thuộc.
  - Button `In mã QR`: Mở popup xem trước tem nhãn chuẩn 50×30mm -> Nút `In ra máy in tem` (Trang 20).
  - Tab `Tổng quan tham số` -> Button `Chỉnh sửa`: Form thêm dòng thông số kỹ thuật mới (Trang 21 - 22 [Khoanh đỏ nút + Thêm thông số mới & ô Input VD]).
  - Tab `Tài liệu` -> Button `Choose File`: Quản lý hồ sơ đính kèm (Trang 23).
  - Tab `Lịch sử vận hành - sự cố` -> Button `+ Ghi nhận sự cố` (Trang 24 [Khoanh đỏ nút]):
    - Form ghi nhận: Radio chọn mức ưu tiên (`P4 - Thấp`, `P3 - Trung bình`, `P2 - Cao`, `P1 - Khẩn cấp`).
    - `Select Box Phân loại sự cố`, Input `Tiêu đề`, Textarea `Mô tả chi tiết`.
    - Checkbox `Đồng bộ sang Module Bảo trì (CMMS)` (Trang 25).
  - Tab `Phụ tùng (BOM)` (Trang 26): Button `Lưu phụ tùng (BOM)`, Checkbox `Trọng yếu`.
  - Tab `Kế hoạch bảo trì` & Mẫu đầu việc (Trang 27 - 29 [Khoanh đỏ nút Chỉnh sửa & Dòng đầu việc mới]): Khai báo các bước T1, T2... và thời lượng phút.
- **Nghiệp vụ Kho & Tiếp nhận Yêu cầu Cấp phát (Trang 30 - 41 [Khoanh đỏ cụm xử lý phiếu & tab Kiểm kê])**:
  - Tab `Kho & Danh mục` (Trang 31 - 33):
    - Cụm cảnh báo: `Nhu cầu cấp phát vật tư từ Quy trình (Bảng kê CSV)`.
    - Button `Xem chi tiết v` (Trang 32 [Khoanh đỏ]).
    - Button `Tải bảng kê CSV`, Button `Kiểm tra tồn kho`, Button `Xử lý phiếu yêu cầu (X vật tư)` (Trang 33 [Khoanh đỏ]).
    - Các action trên từng dòng: Button `Soi kho`, `Xuất kho món này`, `Chuyển kho`, `Tách kho xuất`, `Đề xuất mua sắm`.
  - Button `+ Xuất/nhập kho` (Trang 35, 37 [Khoanh đỏ]):
    - Mở popup: Tab `Nhập kho`, Tab `Xuất kho`, Tab `Điều chuyển kho` (Trang 34, 36).
    - `Select Box Kho xuất/nhập/nguồn/đích`, Input `Số hóa đơn/lệnh`, Upload chứng từ.
  - Button `+ Thêm vật tư` (Trang 37 [Khoanh đỏ]):
    - Popup `Thêm vật tư mới` (Trang 38): Input `Mã SKU`, Input `Tên vật tư`, `Select Box Đơn vị tính`, Input `Min/Max stock`.
    - Radio `Phương thức quản lý định danh`: *Theo Sê-ri (SN)*, *Theo Lô (Lot/Batch)*, *Thông thường*.
  - Tab `Vị trí & Kho` và `Kiểm kê` (Trang 40 - 41 [Khoanh đỏ tab Kiểm kê]):
    - Button `Đổi vị trí kệ` (Bin Location).
    - Tab `Kiểm kê`: Button `Xác nhận số đếm` (Spot Count kiểm đếm nhanh tại chỗ).

---

### C. Phân Hệ Bảo Trì Phòng Ngừa (Maintenance)
- **Ma trận Bảo trì (Trang 44 - 49 [Khoanh đỏ nhiều thành phần])**:
  - Input `Tìm trên ma trận (MBA-01, MC-901...)`.
  - Button `+ Thêm thiết bị từ Kho (Gõ tên / mã...)` -> Mở popup tìm chọn từ Kho (Trang 45).
  - `Select Box Tất cả đơn vị`, `Select Box Mức ưu tiên`.
  - Các ô Checkbox tần suất trên từng dòng: `Ngày`, `Tuần`, `Tháng`, `Quý`, `Năm`.
  - `Select Box Luồng thực thi khi tạo lệnh` (ví dụ: *BT_DK_TB - Q*, *EXEC_QT_MSTB*).
  - Button `Bảo trì ngay`: Kích hoạt đột xuất ngoài chu kỳ.
  - Button `Gỡ` -> Mở **Popconfirm xác nhận gỡ thiết bị** (Trang 48 [Khoanh đỏ]): Button `Gỡ thiết bị` / `Hủy`.
  - Click vào tên thiết bị -> Mở **Drawer chi tiết bên phải** (Trang 46, 47, 49 [Khoanh đỏ Panel]):
    - Tab `1. Đầu việc (Kho)`: Danh sách các bước kiểm tra nạp từ Inventory.
    - Tab `2. Lịch sử bảo trì`: Xem các lần can thiệp trước đó.
    - Link `Sửa trong Kho ->` (Trang 49).
- **Lập lịch bảo trì & Phiếu phát sinh (Trang 50 - 53)**:
  - Button `+ Tạo lịch bảo trì` (Trang 50) -> Form popup tạo lịch (Trang 51).
  - Tab `Phiếu phát sinh` (Trang 52): Button đỏ `Tạo sự cố` -> Form popup `Tạo sự cố báo trì` (Trang 53).
- **Lịch sử bảo trì & Nghiệm thu (Trang 54 - 56)**:
  - Click dòng lịch sử -> Mở **Drawer ghi nhận & đóng hồ sơ** (Trang 55):
    - Textarea `Nội dung thực hiện & Đánh giá kết quả *`.
    - Upload `Tệp đính kèm / Biên bản nghiệm thu & Ảnh hiện trường`.
    - Button xanh nổi bật `Đánh dấu hoàn thành`.
    - Drawer hiển thị kết quả sau khi hoàn thành (Trang 56).
- **Cài đặt module Bảo trì (Trang 57 - 58)**:
  - Tab `Thẻ tổng quan`: Checkbox bật/tắt và sắp xếp vị trí các thẻ Dashboard.
  - Tab `Tần suất bảo trì`: Checkbox, Input số lượng, Select Box đơn vị (Ngày, Tuần, Tháng...).

---

### D. Động Cơ Quy Trình & Ma Trận RCSI (Procedure Engine)
- **Bàn làm việc Workspace (Trang 62 - 77)**:
  - Button `+ Tạo đơn / Yêu cầu Mới` (Trang 62) -> Popup mở hồ sơ mới (Trang 63): Input tiêu đề, `Select Box Áp dụng quy trình *`, DatePicker bắt đầu/kết thúc, Checkbox `Áp lịch theo giờ tính SLA`, `Select Box Người quản lý hồ sơ`, Thêm người theo dõi.
  - Bảng hồ sơ: Click dòng -> Mở chi tiết xử lý:
    - Cụm nút xử lý (Trang 64): Button xanh `Phê duyệt & Gửi X tệp`, Button `Trả lại`, Button đỏ `Từ chối`.
    - Button `Chọn thiết bị` -> Popup chọn tài sản gắn vào hồ sơ (Trang 65).
    - Tab `Công việc con`: Button `Chỉnh sửa công việc phân rã` -> Popup sửa công việc con: Radio `Tuần tự / Song song`, Input tỷ trọng %, `Select Box Người phụ trách`, Input vật tư liên quan (Trang 66 - 67).
    - Tab `Trao đổi`: Ô soạn thảo bình luận, nút `@mention`, Button `Gửi tin nhắn` (Trang 68).
    - Tab `Lịch sử`: Lược sử phân nhóm theo từng phiên duyệt (Trang 69).
    - Tab `Vật tư`: Button `+ Vật tư` -> Popup `Xin vật tư cho bước hiện tại`: Chọn vật tư, số lượng, `Select Box Quy trình mượn/xuất kho vật tư`, `Select Box Gắn vào công việc con`, Button `Xác nhận tạo đơn` (Trang 70 - 71).
    - Tab `Liên kết`: Button `+ Liên kết hồ sơ` -> Popup liên kết thủ công (Trang 72 - 73).
    - Tab `Đính kèm`: Button `+ Tải tệp lên` -> Popup kéo thả file, gắn vào bước, đánh dấu làm minh chứng hoàn thành (Trang 74 - 75).
    - Drawer chi tiết bước: Phân vai RCSI, thời hạn SLA (Trang 76).
    - Action `Hủy hồ sơ`: Mở Popconfirm xác nhận hủy kèm lý do bắt buộc (Trang 77).
- **Bộ thiết kế Quy trình & Ma trận RCSI (Trang 78 - 82)**:
  - Danh mục quy trình: Button `+ Thêm mới` -> Popup tạo quy trình (Trang 79).
  - Bảng thiết kế ma trận RCSI (Trang 80):
    - Cột: Phòng ban / Chức danh lấy từ Sơ đồ tổ chức.
    - Dòng: Các bước quy trình (Bước 1, Bước 2...).
    - Click ô giao điểm để gán vai trò: **S** (Submit), **R** (Review), **E** (Executor), **C** (Check), **A** (Approve), **I** (Inform).
    - Input `SLA` (giờ/ngày) cho từng bước.
    - Button `+ Thêm bước`.
  - Quản lý trạng thái:
    - Button `Công bố`: Popconfirm xác nhận công bố quy trình ra sử dụng (Trang 81).
    - Button `Sửa`: Popconfirm đưa quy trình về bản nháp để sửa (Trang 81).
    - Button `Xóa`: Popconfirm xóa quy trình; **Cơ chế tự động chặn xóa** khi quy trình đã có hồ sơ đang chạy (Trang 82).
- **Cài đặt Quy trình (Trang 83 - 85)**:
  - Tab `Thẻ tổng quan`: Bật/tắt thẻ Dashboard.
  - Tab `Nhóm quy trình`: Button `+ Thêm nhóm` -> Popup thêm nhóm (Tên, Mã, Bật/Tắt, Đặt mặc định) (Trang 84 - 85).

---

## 4. Kế Hoạch Triển Khai

1. **Bước 1: Trích xuất toàn bộ ảnh từ PDF**
   - Chạy script trích xuất toàn bộ 85 trang PDF thành ảnh PNG chất lượng cao vào `docs/user-guide/images/screen_01.png` đến `screen_85.png`.
2. **Bước 2: Soạn thảo chi tiết từng tài liệu**
   - Nhúng trực tiếp ảnh minh họa tương ứng với từng phần.
   - Lập bảng đặc tả chi tiết từng Button, Select Box, Input, Checkbox.
   - Viết kịch bản luồng thao tác người dùng (Step-by-step) có tham chiếu số ảnh.
