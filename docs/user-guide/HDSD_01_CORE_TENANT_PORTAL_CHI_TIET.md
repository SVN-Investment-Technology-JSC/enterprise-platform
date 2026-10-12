# HƯỚNG DẪN SỬ DỤNG — 01. CORE & TENANT PORTAL

> Phạm vi: Dashboard, Ứng dụng, Sơ đồ tổ chức và Người dùng; tham chiếu ảnh 01–07. Hoàn tất phần này trước khi vận hành Kho, Bảo trì và Quy trình.

## 1. Mục tiêu và điều kiện sử dụng

Core là nơi quản trị nền tảng doanh nghiệp: kiểm tra thuê bao/module, xây dựng sơ đồ tổ chức, bổ nhiệm nhân sự và quản lý tài khoản. Các nút tạo, sửa, vô hiệu hóa và xóa chỉ hiện với tài khoản có quyền quản trị tenant.

| Thành phần chung | Cách dùng | Lưu ý |
|---|---|---|
| Hộp chọn có tìm kiếm | Gõ tên/mã, dùng `↑`/`↓`, `Enter` để chọn | Dùng cho Sơ đồ, Node cha, Chức danh, Người dùng, Vai trò. |
| Trường có `*` | Nhập/chọn trước khi lưu | Hệ thống báo lỗi nếu để trống. |
| Checkbox | Nhấp để bật/tắt | Kiểm tra kỹ tác động trước khi chọn sơ đồ/vị trí chính. |
| `Lưu thay đổi` | Ghi dữ liệu biểu mẫu | Chỉ lưu khi dữ liệu hợp lệ. |
| `Hủy` hoặc nút đóng | Hủy dữ liệu chưa lưu | Không tác động đến dữ liệu hiện có. |
| Menu ba chấm | Thao tác cho từng dòng | Luôn kiểm tra đúng tên bản ghi. |

## 2. Dashboard Tenant Portal

![Màn hình Dashboard](./images/screen_01.png)

### Mục đích

Dashboard là điểm bắt đầu của quản trị viên: theo dõi số tài khoản hoạt động, module đã bật, gói dịch vụ và điều hướng nhanh đến từng phân hệ.

| Thành phần | Loại UI | Mục đích | Kết quả khi thao tác |
|---|---|---|---|
| **Người dùng hoạt động** | Thẻ chỉ số | Tổng tài khoản được phép đăng nhập | Mở danh sách Người dùng để kiểm tra. |
| **Module đã bật** | Thẻ chỉ số | Số phân hệ sẵn sàng sử dụng | Mở danh mục Ứng dụng. |
| **Gói hiện tại** | Thẻ chỉ số | Gói SaaS của tenant | Đối chiếu phạm vi tính năng được cấp. |
| **Đăng ký** | Nhãn trạng thái | Hiệu lực thuê bao | Theo dõi tình trạng sử dụng dịch vụ. |
| `Mở →` CRM / Inventory / Maintenance / Procedure Engine | Button | Vào phân hệ tương ứng | Chuyển vùng làm việc nếu module đang Active. |
| `Xem tất cả →` | Link | Xem toàn bộ module | Mở trang Ứng dụng. |
| `+ Thêm người dùng` | Button | Tạo nhanh tài khoản nhân sự | Mở form tạo người dùng. |
| `Quản lý vai trò` | Button | Quản trị vai trò/phân quyền | Mở cấu hình khi có quyền. |
| `Cài đặt công ty` | Button | Quản lý thông tin tenant | Mở khu vực cài đặt doanh nghiệp. |

### Quy trình kiểm tra đầu ngày

1. Kiểm tra nhãn **Đăng ký** đang hoạt động.
2. Đối chiếu số **Người dùng hoạt động** nếu vừa có thay đổi nhân sự.
3. Kiểm tra module cần dùng đã được bật.
4. Nhấn `Mở →` trên thẻ module cần làm việc.

## 3. Ứng dụng doanh nghiệp

![Danh mục ứng dụng](./images/screen_02.png)

Màn hình này dùng để tìm module, kiểm tra module đang khả dụng hoặc đề nghị kích hoạt module mới.

| Thành phần | Loại UI | Hướng dẫn |
|---|---|---|
| Ô tìm kiếm ứng dụng | Input | Gõ toàn bộ/một phần tên để lọc thẻ ứng dụng. |
| Nhãn `Active` | Nhãn trạng thái | Module có thể mở và sử dụng theo quyền tài khoản. |
| `Mở ứng dụng →` | Button | Đi vào module có trạng thái Active. |
| Ứng dụng khác | Danh sách thẻ | Hiển thị module chưa đăng ký hoặc tạm dừng. |
| `Yêu cầu kích hoạt` | Button | Gửi yêu cầu đến đầu mối quản trị dịch vụ SaaS. |

### Kích hoạt module

1. Tìm module trong danh sách **Ứng dụng khác**.
2. Xác nhận module chưa có trạng thái Active.
3. Nhấn `Yêu cầu kích hoạt`.
4. Chờ đầu mối quản trị kích hoạt; sau đó người dùng vẫn cần được cấp quyền phù hợp để truy cập.

## 4. Sơ đồ tổ chức

![Cây sơ đồ tổ chức](./images/screen_03.png)

### Trình tự thiết lập khuyến nghị

1. Tạo sơ đồ tổ chức.
2. Rà soát hoặc bổ sung loại node.
3. Tạo node từ cấp cao xuống: Pháp nhân → Khối → Phòng ban → Bộ phận → Chức danh.
4. Lưu vị trí hiển thị trên canvas.
5. Bổ nhiệm người dùng vào chức danh.

| Thành phần | Loại UI | Cách dùng | Kết quả |
|---|---|---|---|
| Thẻ **Số sơ đồ tổ chức** | Thẻ chỉ số | Theo dõi số mô hình đang lưu | Kiểm soát phạm vi cấu hình. |
| Thẻ **Node đang dùng** | Thẻ chỉ số | Theo dõi số đơn vị/chức danh | Chỉ hiển thị. |
| Thẻ **Bổ nhiệm hiệu lực** | Thẻ chỉ số | Theo dõi số bổ nhiệm còn hiệu lực | Đối chiếu mức độ hoàn thiện nhân sự. |
| Tab `Cây tổ chức` | Tab | Quay lại canvas | Hiển thị quan hệ cha–con. |
| Tab `Loại node` | Tab | Quản lý danh mục cấp tổ chức | Mở registry loại node. |
| Tab `Bổ nhiệm` | Tab | Gán người vào chức danh | Mở danh sách bổ nhiệm. |
| `+ Thêm sơ đồ` | Button | Khởi tạo mô hình mới | Mở form sơ đồ. |
| `+ Thêm node` | Button | Bổ sung đơn vị/chức danh | Mở form node. |
| `Lưu vị trí các node` | Button | Nhấn sau khi sắp xếp node | Lưu tọa độ canvas. |
| `Sửa` | Button | Cập nhật sơ đồ đang chọn | Mở form chỉnh sửa. |
| Zoom `+`, `-`, Reset | Icon button | Phóng/thu/cân góc nhìn | Không đổi cấu trúc dữ liệu. |

### Tạo hoặc cập nhật sơ đồ

![Tạo/cập nhật sơ đồ và node](./images/screen_04.png)

1. Nhấn `+ Thêm sơ đồ`; dùng `Sửa` nếu cập nhật sơ đồ hiện có.
2. Nhập tên hiển thị và mã duy nhất, ví dụ `COMPANY-MAIN`.
3. Nhập mô tả về phạm vi/pháp nhân áp dụng.
4. Chọn **Đặt làm sơ đồ chính** chỉ nếu đây là sơ đồ chuẩn đang dùng.
5. Chọn trạng thái, sau đó nhấn `Lưu thay đổi`.

| Trường | Loại | Bắt buộc | Hướng dẫn |
|---|---|---:|---|
| Tên sơ đồ | Input | Có | Tên dễ nhận biết của mô hình tổ chức. |
| Mã sơ đồ | Input | Có | Mã duy nhất; nên dùng chữ in hoa và dấu gạch nối. |
| Mô tả | Textarea | Không | Ghi phạm vi hoặc lưu ý quản trị. |
| Đặt làm sơ đồ chính | Checkbox | Không | Chọn cho sơ đồ làm nguồn tổ chức hiện hành. |
| Trạng thái | Hộp chọn | Có | Hoạt động hoặc tạm dừng theo chính sách nội bộ. |

### Tạo hoặc cập nhật node

1. Chọn sơ đồ cần bổ sung và nhấn `+ Thêm node`.
2. Chọn **Node cha**; dùng **Node gốc** nếu đây là cấp cao nhất.
3. Chọn loại node, nhập tên, mã, thứ tự và trạng thái.
4. Nhấn `Lưu thay đổi`, kiểm tra node xuất hiện đúng nhánh.

| Trường | Loại | Bắt buộc | Ý nghĩa |
|---|---|---:|---|
| Sơ đồ | Hộp chọn có tìm kiếm | Có | Sơ đồ chứa node. |
| Node cha | Hộp chọn có tìm kiếm | Có | Đơn vị cấp trên hoặc Node gốc. |
| Loại node | Hộp chọn có tìm kiếm | Có | Bản chất tổ chức/chức danh. |
| Tên node | Input | Có | Tên hiển thị trên cây. |
| Mã node | Input | Có | Mã quản trị nội bộ. |
| Thứ tự | Number input | Không | Thứ tự giữa các node cùng cấp. |
| Trạng thái | Hộp chọn | Có | Hiệu lực của node. |

> Không đổi node cha hoặc vô hiệu hóa node đang là nguồn phân quyền/quy trình nếu chưa đánh giá người dùng, bổ nhiệm và hồ sơ liên quan.

## 5. Danh mục loại node

![Quản lý loại node](./images/screen_05.png)

| Mã | Tên gợi ý | Nhóm |
|---|---|---|
| `COMPANY` | Pháp nhân | Đơn vị |
| `BOARD` | Ban lãnh đạo | Đơn vị |
| `DIVISION` | Khối | Đơn vị |
| `DEPARTMENT` | Phòng ban | Đơn vị |
| `CENTER` | Trung tâm | Đơn vị |
| `REPRESENTATIVE` | Văn phòng đại diện | Đơn vị |
| `SECTION` | Bộ phận | Đơn vị |
| `POSITION` | Chức danh | Chức danh |

### Thêm hoặc cập nhật loại node

1. Vào tab **Loại node**, nhấn `+ Thêm loại node`, hoặc mở menu ba chấm ở dòng muốn sửa.
2. Nhập **Tên loại node**, **Mã loại**, chọn **Nhóm**.
3. Đánh dấu **Đang sử dụng** nếu loại node được phép chọn khi tạo node; chọn trạng thái phù hợp.
4. Nhấn `Lưu thay đổi`.

| Thành phần | Loại UI | Ý nghĩa |
|---|---|---|
| Tên loại node, Mã loại | Input | Tên hiển thị và mã danh mục. Tránh đổi mã đang được sử dụng. |
| Nhóm | Hộp chọn | Phân loại thành Đơn vị hoặc Chức danh. |
| Đang sử dụng | Checkbox | Cho phép/ngừng cho phép loại node trong form tạo node. |
| Trạng thái | Hộp chọn | Kiểm soát hiệu lực danh mục. |
| Menu ba chấm | Action menu | Cập nhật đúng loại node trên dòng được chọn. |

## 6. Bổ nhiệm người dùng

![Quản lý bổ nhiệm](./images/screen_06.png)

Tạo bổ nhiệm sau khi đã có tài khoản người dùng và node thuộc nhóm Chức danh. Bổ nhiệm là dữ liệu nguồn để quy trình và phân công xác định người giữ vai trò.

### Quy trình bổ nhiệm

1. Mở tab **Bổ nhiệm**, nhấn `+ Bổ nhiệm người dùng`.
2. Chọn **Chức danh** và **Người dùng**.
3. Nhập **Từ ngày**; nhập **Đến ngày** nếu có thời hạn.
4. Đánh dấu **Vị trí chính** nếu đây là vai trò chính của nhân sự.
5. Thêm ghi chú/số quyết định khi cần và lưu.

| Trường | Loại | Bắt buộc | Hướng dẫn |
|---|---|---:|---|
| Chức danh | Hộp chọn có tìm kiếm | Có | Chỉ chọn node thuộc nhóm Chức danh. |
| Người dùng | Hộp chọn có tìm kiếm | Có | Chọn tài khoản đang hoạt động. |
| Từ ngày / Đến ngày | DatePicker | Từ ngày: Có | Xác định khoảng hiệu lực. |
| Vị trí chính | Checkbox | Không | Dùng khi nhân sự kiêm nhiệm nhiều vai trò. |
| Ghi chú | Textarea | Không | Lưu số quyết định hoặc lý do điều chuyển. |
| Menu chỉnh sửa/kết thúc | Action menu | — | Cập nhật hiệu lực theo chính sách nội bộ. |

## 7. Quản lý người dùng

![Quản trị người dùng](./images/screen_07.png)

### Tra cứu và thao tác

| Thành phần | Loại UI | Hướng dẫn |
|---|---|---|
| Thẻ Tổng số / Hoạt động / Vô hiệu hóa | Thẻ chỉ số | Theo dõi cơ cấu trạng thái tài khoản. |
| Ô tìm kiếm nhân viên | Input tìm kiếm | Nhập họ tên hoặc email để lọc. |
| Lọc Trạng thái, Lọc Vai trò | Hộp chọn có tìm kiếm | Thu hẹp danh sách theo điều kiện. |
| `+ Thêm người dùng` | Button | Mở biểu mẫu tạo tài khoản. |
| Menu thao tác | Action menu | Chỉnh sửa, vô hiệu hóa hoặc xóa theo quyền. |

### Tạo người dùng mới

1. Nhấn `+ Thêm người dùng`.
2. Nhập họ tên đầy đủ và email doanh nghiệp; email dùng để đăng nhập.
3. Nhập mật khẩu khởi tạo tối thiểu **6 ký tự**.
4. Chọn vai trò theo đúng trách nhiệm công việc và trạng thái **Hoạt động** nếu cần truy cập ngay.
5. Lưu, sau đó tìm lại bằng email để xác nhận đã tạo đúng.

| Trường | Loại | Bắt buộc | Lưu ý |
|---|---|---:|---|
| Họ và tên | Input | Có | Tên nhận diện trong trao đổi/báo cáo. |
| Email | Email input | Có | Đúng định dạng và không trùng tài khoản hiện có. |
| Mật khẩu khởi tạo | Password input | Có | Tối thiểu 6 ký tự, không gửi qua kênh không an toàn. |
| Vai trò | Hộp chọn có tìm kiếm | Có | Quyết định phạm vi quyền. |
| Trạng thái | Hộp chọn | Có | Hoạt động cho phép đăng nhập; Vô hiệu hóa chặn truy cập. |

### Vô hiệu hóa, chỉnh sửa và xóa

- Dùng **Chỉnh sửa** khi cần thay đổi tên, vai trò hoặc trạng thái.
- Dùng **Vô hiệu hóa** khi nhân sự tạm thời không được truy cập; đây là phương án giữ lịch sử nghiệp vụ.
- Chỉ **Xóa** tài khoản tạo nhầm khi chính sách lưu trữ cho phép; kiểm tra kỹ tên/email trước khi xác nhận.

## 8. Kiểm tra nhanh và xử lý sự cố

| Vấn đề | Cách xử lý |
|---|---|
| Không thấy module | Vào **Ứng dụng**, kiểm tra trạng thái Active; nếu chưa bật, gửi yêu cầu kích hoạt. |
| Không thấy nút thêm/sửa/xóa | Nhờ Tenant Admin kiểm tra vai trò và quyền. |
| Không thể lưu form | Rà soát trường bắt buộc, mã trùng, email và trạng thái lựa chọn. |
| Không chọn được người để bổ nhiệm | Kiểm tra tài khoản đang hoạt động và node Chức danh đã tồn tại. |
| Quy trình không tìm được chức danh/phòng ban | Rà soát node, loại node và hiệu lực bổ nhiệm trong Core. |

## 9. Checklist bàn giao vận hành

- [ ] Sơ đồ tổ chức chính đang hoạt động.
- [ ] Đơn vị/chức danh có tên và mã thống nhất.
- [ ] Vị trí node trên canvas đã được lưu.
- [ ] Người dùng cần thiết đã được tạo và cấp vai trò.
- [ ] Các bổ nhiệm có hiệu lực đã được khai báo.
- [ ] Module nghiệp vụ cần triển khai có trạng thái Active.
