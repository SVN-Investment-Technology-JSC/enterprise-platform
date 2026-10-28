# HƯỚNG DẪN SỬ DỤNG — BÁN HÀNG: NHÂN VIÊN KINH DOANH

> Phạm vi: Khách hàng, Lead, Cơ hội, Hoạt động, Báo giá và Đơn bán. Quyền cần có: `crm.read`, `crm.opportunity.write`, `crm.quote.write`, `crm.order.write`. Bạn thấy bản ghi do mình phụ trách; trưởng nhóm thấy thêm bản ghi của cấp dưới. Xem quy ước chung ở [README](./README.md).

## 1. Khách hàng

### 1.1. Danh sách

| Thành phần | Loại | Hướng dẫn |
|---|---|---|
| `Thêm khách hàng` | Button | Mở form tạo khách mới. |
| `Tìm theo mã, tên, mã số thuế…` | Ô tìm kiếm | Lọc theo mã, tên hoặc MST. |
| `Mọi người phụ trách`, `Tất cả nhóm`, `Mọi phân loại` | Bộ lọc | Lọc theo người phụ trách, nhóm khách, phân loại. |
| Cột `Mã`, `Tên khách hàng`, `Phân loại`, `Nhóm`, `Tỉnh/thành`, `Liên hệ chính`, `Người phụ trách` | Bảng | Nhấp một dòng để mở hồ sơ. |

### 1.2. Tạo, sửa khách hàng

| Trường | Ghi chú |
|---|---|
| `Mã khách hàng` | `Tự sinh nếu để trống` theo tiền tố và số chữ số quản trị bán hàng đã cấu hình. |
| `Tên khách hàng` `*` | Bắt buộc. |
| `Mã số thuế` | Gồm 10 số hoặc 10 số-3 số, ví dụ `0101234567` hoặc `0101234567-001`. |
| `Phân loại` | `Khách hàng tiềm năng`, `Khách hàng`, `Ngừng giao dịch`. |
| `Nhóm khách hàng` | Quyết định bảng giá nhóm và chính sách theo nhóm khi tính giá. |
| `Người phụ trách` | `Mặc định là bạn`. |
| `Ngành`, `Khu vực`, `Tỉnh/thành`, `Địa chỉ`, `Điện thoại`, `Ghi chú` | Khu vực dùng cho báo cáo theo khu vực. |
| `Thời hạn thanh toán (ngày)` | Dùng tính hạn của khoản nợ khi giao hàng. |
| `Hạn mức tín dụng (đồng)` | Thường do quản trị bán hàng hoặc kế toán đặt; vượt hạn mức khi xác nhận đơn sẽ bị đưa đi duyệt hoặc bị chặn. |

Nếu MST trùng với khách đã có, form hiện danh sách khách trùng. Kiểm tra lại; chỉ bấm `Vẫn lưu` khi chắc chắn đây là khách khác (ví dụ chi nhánh).

### 1.3. Hồ sơ khách hàng

Hồ sơ có các phần `Thông tin`, `Người liên hệ`, `Cơ hội`, `Hoạt động`, `Dòng thời gian`.

- `Thêm người liên hệ`, `Sửa người liên hệ`, `Xoá`: người liên hệ đầu tiên là liên hệ chính. Xoá liên hệ chính thì `Người liên hệ cũ nhất còn lại sẽ thành người liên hệ chính.`
- `Dòng thời gian` gom mọi sự kiện của khách: tạo, chuyển giai đoạn cơ hội, hoạt động, báo giá, hợp đồng, đơn, công nợ, bảo hành. Bấm `Xem thêm` để tải tiếp.

## 2. Lead

| Thành phần | Hướng dẫn |
|---|---|
| `Thêm lead` | Nhập `Tên lead (công ty hoặc cá nhân)` `*`, `Mã số thuế`, `Người liên hệ`, `Điện thoại`, `Nguồn` (ví dụ: Sự kiện, Website, Giới thiệu), `Nhu cầu`, `Người phụ trách`, `Ghi chú`. |
| Bộ lọc `Mọi trạng thái` | `Mới`, `Đang chăm sóc`, `Không tiềm năng`, `Đã chuyển đổi`. |
| `Chuyển đổi` | Mở hộp `Chuyển thành khách hàng và cơ hội`. |

Khi chuyển đổi, nhập `Tên cơ hội`, `Giá trị dự kiến (đồng)`, `Ngày chốt dự kiến`. Hệ thống tạo khách hàng (hoặc gắn vào khách có cùng mã số thuế) và một cơ hội ở giai đoạn `Mới`. Lead chuyển sang `Đã chuyển đổi` và không chuyển đổi lần hai.

## 3. Cơ hội

### 3.1. Kanban và dạng bảng

- Chọn `Kanban` hoặc `Dạng bảng` ở thanh `Cách xem`.
- Kanban có một cột cho mỗi giai đoạn: `Mới`, `Đã liên hệ`, `Khảo sát nhu cầu`, `Báo giá`, `Đàm phán`, `Thắng`, `Thua`. Kéo thẻ sang cột khác để chuyển giai đoạn.
- Dạng bảng có thêm bộ lọc `Mọi giai đoạn`; cột `Giá trị dự kiến`, `Xác suất`, `Ngày chốt`, `Người phụ trách`.

### 3.2. Quy tắc chuyển giai đoạn

| Quy tắc | Chi tiết |
|---|---|
| Đi từng bước | Giai đoạn mở chỉ tiến hoặc lùi đúng một bước theo thứ tự Mới → Đã liên hệ → Khảo sát nhu cầu → Báo giá → Đàm phán. Kéo nhảy cóc bị từ chối. |
| Sang `Báo giá` | Hệ thống tự tạo báo giá nháp cho cơ hội nếu chưa có. |
| Sang `Thắng` | Chỉ từ `Đàm phán`, và cơ hội phải có báo giá ở trạng thái `Khách chấp nhận`. |
| Sang `Thua` | Từ mọi giai đoạn mở; hộp `Chuyển cơ hội sang Thua` bắt buộc `Lý do thua`, bấm `Xác nhận thua`. Báo giá chưa kết thúc của cơ hội chuyển `Khách từ chối`. |
| Trạng thái cuối | `Thắng`, `Thua` không chuyển đi đâu được nữa. |

`Thêm cơ hội`: chọn `Khách hàng` `*`, nhập `Tên cơ hội` `*`, `Giá trị dự kiến (đồng)`, `Xác suất thắng (%)` (số nguyên 0–100), `Ngân sách khách (đồng)`, `Ngày chốt dự kiến`, `Nhu cầu`, `Người phụ trách`.

## 4. Hoạt động

| Thành phần | Hướng dẫn |
|---|---|
| `Thêm hoạt động` | `Loại` (`Gọi điện`, `Email`, `Gặp mặt`, `Công việc`), `Tiêu đề` `*`, `Khách hàng / cơ hội`, `Hạn`, `Người được giao`, `Mô tả`. |
| `Hoàn tất` | Mở hộp `Hoàn tất hoạt động`, ghi `Kết quả`. Trạng thái sang `Hoàn tất`. |
| Bộ lọc | `Mọi trạng thái` (`Đang mở`, `Hoàn tất`, `Đã huỷ`), `Mọi người được giao`. |

Người được giao nhận thông báo trước hạn (số phút do quản trị cấu hình) và khi quá hạn. Hoạt động hiện cả trên hồ sơ khách và trên cơ hội.

## 5. Báo giá

### 5.1. Lập báo giá

1. Vào `Báo giá` → `Lập báo giá`.
2. Chọn `Cơ hội` (khách hàng và người phụ trách lấy theo cơ hội) hoặc `Không gắn cơ hội` rồi chọn `Hoặc khách hàng`.
3. `Hiệu lực đến`: bỏ trống là 30 ngày kể từ hôm nay. Nhập `Ghi chú` nếu cần.
4. Mở báo giá vừa tạo, bấm `Thêm dòng` để chọn mặt hàng từ danh mục Kho. Hộp chọn hiện `Mã`, `Tên`, `ĐVT`, `Giá vốn BQ`, `Tồn khả dụng` để tham khảo.

### 5.2. Giá được tính thế nào

| Bước | Quy tắc |
|---|---|
| Đơn giá gốc | Lấy theo thứ tự: giá hợp đồng còn hiệu lực của khách → bảng giá của nhóm khách → bảng giá chuẩn. Cột `Nguồn giá` hiện `Hợp đồng`, `Bảng giá nhóm`, `Bảng giá chuẩn` hoặc `Nhập tay`. |
| Chiết khấu | Chính sách độc quyền có ưu tiên cao nhất loại mọi chính sách khác. Nếu không có, cộng các chính sách kiểu `Cộng dồn` với mức cao nhất trong các chính sách kiểu `Lấy mức cao nhất`. Tổng là phần trăm trên giá gốc và bị cắt ở trần chiết khấu (mặc định 10%). Cột `Chính sách đã áp` cho biết chính sách nào. |
| Làm tròn | Tiền làm tròn đến đồng theo từng dòng; VAT tính trên thành tiền sau chiết khấu của dòng; tổng bằng cộng các dòng. |
| Vận chuyển | `Phí vận chuyển thu khách (VND)` là một dòng dịch vụ có `Thuế suất vận chuyển (%)` riêng; `Chi phí vận chuyển bên bán chịu (VND)` trừ vào lợi nhuận (bỏ trống là bằng phí thu khách). |
| Ngày tính giá | Bỏ trống là tính theo ngày hôm nay. |

Trên một dòng, bạn có thể `Ghi đè đơn giá sau CK` hoặc `Ghi đè chiết khấu (%)`, không ghi đè cả hai. Mọi dòng có ghi đè đều phải duyệt.

Cột `Giá vốn BQ`, `Biên` là ước tính theo giá vốn bình quân hiện tại của Kho. Bấm `Tính lại giá` để cập nhật theo bảng giá, chính sách và giá vốn mới nhất.

### 5.3. Gửi duyệt và ngưỡng duyệt

Bấm `Gửi duyệt` khi phiên bản ở `Nháp`. Hệ thống tự xét:

- Không có lý do cần duyệt: phiên bản sang thẳng `Đã duyệt`.
- Có ít nhất một lý do: phiên bản sang `Chờ duyệt`, cấp trên (hoặc quy trình duyệt) nhận thông báo.

Lý do cần duyệt:

| Lý do | Ví dụ thông báo |
|---|---|
| Chiết khấu một dòng vượt hạn mức theo vai trò người gửi | `Dòng 2 (QA-KHO-CAP): Chiết khấu vượt hạn mức vai trò nhân viên (8% > 5%).` |
| Chiết khấu bình quân cả báo giá vượt hạn mức | `Chiết khấu bình quân cả báo giá vượt hạn mức ...` |
| Biên lợi nhuận dưới mức tối thiểu | `Biên lợi nhuận dưới mức tối thiểu (...)` |
| Có ghi đè giá hoặc chiết khấu | `Dòng n (...): Có ghi đè giá hoặc chiết khấu.` |
| Hàng tồn kho chưa có giá vốn | `Kho chưa có giá vốn ước tính, không tính được biên lợi nhuận.` |

Đúng bằng hạn mức thì không cần duyệt. Hạn mức mặc định: nhân viên 5%, trưởng nhóm 15%, quản lý không giới hạn; biên tối thiểu 10%. Quản trị bán hàng có thể đổi. Khi đang `Nháp`, màn báo giá đã cho biết trước các lý do sẽ cần duyệt.

Nếu báo giá được duyệt qua Quy trình, phần thông báo trên báo giá hiện mã hồ sơ và trạng thái (`đang tạo hồ sơ.`, `đang chờ người duyệt trên Quy trình.`, `đã có kết quả.`).

### 5.4. Phiên bản báo giá

| Trạng thái | Thao tác tiếp |
|---|---|
| `Nháp` | `Thêm dòng`, `Hiệu lực, vận chuyển`, `Tính lại giá`, `Gửi duyệt`. Chỉ phiên bản hiện tại ở Nháp mới sửa được. |
| `Chờ duyệt` | Chờ người duyệt. |
| `Từ chối duyệt` | Xem `Lý do`; bấm `Sửa (tạo phiên bản mới)`. |
| `Đã duyệt` | `Đánh dấu đã gửi khách` hoặc `Sửa (tạo phiên bản mới)`. |
| `Đã gửi khách` | `Khách chấp nhận`, `Khách từ chối` (bắt buộc lý do) hoặc `Sửa (tạo phiên bản mới)`. |
| `Khách chấp nhận`, `Khách từ chối`, `Hết hạn`, `Đã thay thế` | Trạng thái cuối. |

Bấm `Sửa (tạo phiên bản mới)` thì hộp `Sửa báo giá?` báo: phiên bản cũ chuyển `Đã thay thế` và giữ nguyên để đối chiếu; bạn sửa trên phiên bản mới ở `Nháp` và phải duyệt lại nếu vượt ngưỡng. Bấm `Tạo phiên bản mới` để đồng ý.

- Chọn phiên bản trong hộp chọn phiên bản để xem bản cũ (chỉ đọc).
- `So sánh phiên bản` hiện các dòng `Thêm`, `Bỏ`, `Đổi` giữa hai phiên bản và chênh lệch tổng.
- Báo giá quá `Hiệu lực đến` mà chưa có kết quả tự chuyển `Hết hạn`.

### 5.5. Chuyển thành hợp đồng và đơn

Khi phiên bản ở `Khách chấp nhận`, bấm `Chuyển thành hợp đồng, đơn`. Hộp `Chuyển thành hợp đồng và đơn?` giải thích: tạo hợp đồng mua bán, đơn bán (Nháp) cùng dòng, giá của phiên bản khách chấp nhận và một đợt giao mặc định. Mỗi báo giá chỉ chuyển một lần; lần sau nút đổi thành `Mở đơn bán`.

## 6. Đơn bán

### 6.1. Lập đơn

`Đơn bán` → `Lập đơn bán`:

- `Từ hợp đồng`: đơn dùng giá khung và khách của hợp đồng; hoặc `Không gắn hợp đồng` rồi chọn `Hoặc khách hàng` (đơn trực tiếp).
- `Mã kho giữ hàng`: bỏ trống với đơn từ hợp đồng thì dùng kho của hợp đồng.
- `Ngày giao dự kiến`, `Địa chỉ giao`, `Ghi chú`.

Dòng hàng thêm ở màn chi tiết đơn bằng `Thêm dòng đơn`; giá tính theo bảng giá, chính sách như báo giá. Đơn tạo từ báo giá giữ nguyên dòng và giá của báo giá.

Danh sách đơn có bộ lọc trạng thái, người phụ trách và ô `chỉ đơn giao trễ`; cột `Còn phải thu` lấy từ sổ công nợ.

### 6.2. Xác nhận đơn và giữ hàng

Bấm `Xác nhận đơn`. Hộp `Xác nhận đơn?` nhắc: hàng tồn kho được giữ ở Kho cho mọi dòng; thiếu tồn thì không giữ dòng nào và báo dòng thiếu.

| Quy tắc | Chi tiết |
|---|---|
| Giữ tất cả hoặc không | Chỉ cần một dòng thiếu tồn khả dụng là cả đơn không được giữ; đơn vẫn ở `Nháp` và màn hình liệt kê dòng thiếu. |
| Dịch vụ | Dòng dịch vụ không giữ hàng, không xuất kho. |
| Đơn từ hợp đồng | Dòng dùng phần hàng hợp đồng đã giữ trước khi giữ thêm. |
| Hạn giữ | Mặc định 7 ngày từ lúc xác nhận (quản trị có thể đổi). Đơn có ngày giao dự kiến thì giữ tới ngày đó cộng 2 ngày. |
| Hết hạn giữ | Kho nhả phần giữ; người phụ trách nhận thông báo `Phần giữ hàng hết hạn`. Hàng đã nhả có thể bị đơn khác lấy. |
| Hạn mức công nợ | Nếu dư nợ cộng giá trị đơn vượt hạn mức của khách: đơn sang `Chờ duyệt hạn mức` (hoặc bị chặn, tuỳ cấu hình). Duyệt xong hệ thống mới giữ hàng; từ chối thì đơn về `Nháp` kèm lý do. |

### 6.3. Kế hoạch giao và yêu cầu xuất kho

1. Trong `Kế hoạch giao`, bấm `Thêm đợt giao`, chọn dòng và số lượng (`Đơn ..., còn lập được ...`), `Ngày giao dự kiến`, `Kho xuất` (bỏ trống là kho của đơn; khác kho giữ hàng thì xuất từ tồn khả dụng của kho đó).
2. Tổng số lượng các đợt không vượt số lượng dòng đơn.
3. Bấm `Yêu cầu xuất kho` trên đợt. Hộp `Yêu cầu xuất kho?` báo: Kho nhận chứng từ xuất nháp theo đơn bán cho các dòng hàng tồn kho của đợt; dòng dịch vụ không gửi Kho. Bấm `Yêu cầu xuất`.
4. Thủ kho chọn lô, serial rồi ghi sổ trên màn Kho. Khi Kho ghi sổ, đợt sang `Đã xuất kho`, đơn cập nhật số đã giao, `Serial đã giao`, `Giá vốn thực tế`.

Trạng thái đợt giao: `Kế hoạch`, `Đã yêu cầu xuất`, `Đã xuất kho`, `Đã huỷ`, `Đã đảo chứng từ`.

Giao từng phần được phép: đơn chuyển `Đang giao`, `Đã giao một phần`, rồi `Đã giao đủ` theo kết quả ghi sổ của Kho. Đợt quá ngày dự kiến mà chưa xuất bị đánh dấu trễ và người phụ trách nhận cảnh báo.

### 6.4. Đóng, huỷ đơn

| Nút | Khi nào | Kết quả |
|---|---|---|
| `Huỷ đơn` | Đơn chưa xuất kho; bắt buộc `Lý do huỷ` | Đơn sang `Huỷ`, phần giữ còn lại được nhả. |
| `Đóng đơn` | Muốn kết thúc đơn bằng tay; bắt buộc lý do (ví dụ: xoá nợ bằng điều chỉnh) | Đơn sang `Hoàn tất`. |
| Tự hoàn tất | Đã giao đủ và còn phải thu bằng 0 | Đơn tự sang `Hoàn tất`. |

Phần `Công nợ của đơn` trên chi tiết đơn hiện số đã ghi nợ, đã thu, còn phải thu và yêu cầu duyệt vượt hạn mức gần nhất.
