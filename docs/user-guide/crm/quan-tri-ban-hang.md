# HƯỚNG DẪN SỬ DỤNG — BÁN HÀNG: QUẢN TRỊ BÁN HÀNG

> Phạm vi: trang `Cấu hình` của CRM (nhóm khách, mã khách, nhắc hoạt động, giữ hàng, cảnh báo hợp đồng; bảng giá; chính sách chiết khấu; thử tính giá; ngưỡng và cách duyệt), cấu hình công nợ và kho bảo hành. Quyền cần có: `crm.manage` (hoặc quản trị tenant). `crm.manage` cho thấy toàn bộ dữ liệu nhưng không kèm quyền lập báo giá, đơn; cần gán thêm nếu bạn cũng thao tác nghiệp vụ.

## 1. Trình tự cấu hình khuyến nghị khi bật phân hệ

1. Tab `Chung`: tạo nhóm khách hàng, đặt tiền tố và số chữ số của mã khách, số phút nhắc hoạt động, số ngày giữ hàng, số ngày báo hợp đồng sắp hết hạn.
2. Tab `Bảng giá`: tạo bảng giá chuẩn, rồi bảng giá theo nhóm khách nếu có.
3. Tab `Chính sách chiết khấu`: đặt trần chiết khấu, tạo chính sách.
4. Tab `Thử tính giá`: kiểm tra vài khách và mặt hàng mẫu.
5. Tab `Duyệt báo giá`: đặt ngưỡng duyệt; chọn cách duyệt cho báo giá và cho đơn vượt hạn mức công nợ.
6. `Công nợ` → tab `Cấu hình`: cách ghi nhận nợ, xử lý khi vượt hạn mức, người nhận cảnh báo.
7. `Bảo hành` → `Kho bảo hành`: kho cách ly, kho lỗi, kho nhập lại hàng Đạt.
8. Đặt `Hạn mức tín dụng (đồng)` và `Thời hạn thanh toán (ngày)` trên hồ sơ các khách cần kiểm soát.

## 2. Tab `Chung`

### 2.1. Cấu hình chung

| Trường | Ghi chú |
|---|---|
| `Tiền tố mã khách hàng` | Mặc định `KH`, tối đa 10 ký tự. Gợi ý bên dưới hiện `Mã kế tiếp có dạng ...`. |
| `Số chữ số của mã` | Từ 3 đến 12, mặc định 6. |
| `Nhắc hoạt động trước hạn (phút)` | Mặc định 30. Người được giao nhận thông báo trước hạn và khi quá hạn. |

Bấm `Lưu cấu hình`. Đổi tiền tố chỉ ảnh hưởng mã sinh sau đó, không đổi mã đã có.

### 2.2. Hợp đồng và đơn bán

| Trường | Ghi chú |
|---|---|
| `Giữ hàng mặc định (ngày)` | Mặc định 7. Tính từ lúc xác nhận đơn; đơn có ngày giao dự kiến thì giữ tới ngày đó cộng 2 ngày. |
| `Báo hợp đồng sắp hết hạn trước (ngày)` | Mặc định 30. Người phụ trách hợp đồng nhận thông báo. |

### 2.3. Nhóm khách hàng

`Thêm nhóm khách hàng`: `Mã nhóm` `*`, `Tên nhóm` `*`, `Mô tả`. Cột `Số khách` cho biết số khách đang thuộc nhóm. Nhóm đang có khách hàng không xoá được.

## 3. Tab `Bảng giá`

### 3.1. Tạo bảng giá

`Thêm bảng giá`:

| Trường | Ghi chú |
|---|---|
| `Mã bảng giá`, `Tên bảng giá` | Mã dùng chữ không dấu, số, dấu chấm, gạch ngang. |
| `Loại bảng giá` | `Bảng giá chuẩn (mọi khách)` hoặc `Theo nhóm khách hàng`. |
| `Hiệu lực từ ngày` `*`, `Hiệu lực đến ngày` | Bỏ trống ngày kết thúc là không hết hạn. Tính trọn ngày theo giờ Việt Nam. |
| `Trạng thái` | `Đang áp dụng` hoặc `Ngừng áp dụng`. |
| `Nhóm khách hàng áp dụng` | Chỉ với bảng theo nhóm. Một nhóm chỉ có một bảng giá đang áp dụng tại một thời điểm. |

### 3.2. Dòng giá

- `Thêm dòng giá`: `Id mặt hàng`, `Mã mặt hàng`, `Tên mặt hàng`, `Đơn vị tính`, `Đơn giá (VND)`, `Thuế suất (%)` (0, 5, 8 hoặc 10). Id, mã, tên lấy từ danh mục mặt hàng của Kho.
- `Dán từ bảng tính`: dán tối đa 500 dòng, mỗi dòng các cột cách nhau bằng Tab hoặc `;` theo thứ tự id mặt hàng, mã, tên, đơn vị tính, đơn giá, thuế suất (không bắt buộc, mặc định 10). Dòng tiêu đề được bỏ qua. Dòng trùng mặt hàng và đơn vị tính sẽ cập nhật giá. Kiểm tra số `... dòng hợp lệ` rồi bấm `Nhập ... dòng`.
- Xoá bảng giá xoá luôn mọi dòng giá; không hoàn tác được.

### 3.3. Thứ tự áp giá

Khi tính giá một dòng báo giá hoặc đơn, đơn giá gốc lấy theo thứ tự:

1. Giá khung của hợp đồng còn hiệu lực của khách (nguồn `Hợp đồng`).
2. Bảng giá của nhóm khách đang áp dụng (nguồn `Bảng giá nhóm`).
3. Bảng giá chuẩn (nguồn `Bảng giá chuẩn`).

Không có giá ở cả ba nguồn thì nhân viên phải nhập tay (nguồn `Nhập tay`), và báo giá sẽ cần duyệt vì có ghi đè.

## 4. Tab `Chính sách chiết khấu`

### 4.1. Trần chiết khấu

Ô `Trần chiết khấu` (`Phần trăm tối đa trên giá gốc`, mặc định 10%), bấm `Lưu trần`. Tổng chiết khấu theo chính sách vượt mức này thì bị cắt.

### 4.2. Tạo chính sách

`Thêm chính sách chiết khấu`:

| Trường | Ghi chú |
|---|---|
| `Mã chính sách`, `Tên chính sách` | Bắt buộc. |
| `Hiệu lực từ ngày` `*`, `Hiệu lực đến ngày` | Bỏ trống ngày kết thúc là không hết hạn. |
| `Phần trăm chiết khấu` | Ví dụ 3 hoặc 2,5. Có bậc số lượng thì để trống: lấy theo từng bậc. |
| `Kiểu kết hợp` | `Cộng dồn` hoặc `Lấy mức cao nhất`. |
| `Độc quyền` | Chính sách độc quyền khớp dòng sẽ loại mọi chính sách khác. |
| `Độ ưu tiên` | Số nhỏ là ưu tiên cao (1 đến 1000). |
| `Điều kiện` | Danh sách tiêu chí, tối đa 100. |

Loại tiêu chí: `Bậc số lượng` (`Từ số lượng`, `Đến số lượng`), `Thời gian` (`Từ ngày`, `Đến ngày`), `Khách hàng`, `Nhóm khách hàng`, `Mặt hàng`, `Nhóm hàng` (loại hàng ở Kho). Các tiêu chí chia bốn chiều: số lượng; thời gian; khách hàng hoặc nhóm khách; mặt hàng hoặc nhóm hàng. Các chiều kết hợp AND; nhiều tiêu chí cùng một chiều kết hợp OR. Bậc số lượng chồng nhau thì lấy bậc khớp cao nhất.

### 4.3. Cộng dồn và trần

Với mỗi dòng hàng:

1. Nếu có chính sách `Độc quyền` khớp: chỉ dùng chính sách độc quyền có ưu tiên cao nhất (số `Độ ưu tiên` nhỏ nhất).
2. Nếu không: cộng các chính sách `Cộng dồn` với mức cao nhất trong các chính sách `Lấy mức cao nhất`.
3. Tổng là phần trăm trên giá gốc, cắt ở trần chiết khấu.

Ví dụ với bậc 1–9 giảm 2%, 10–49 giảm 5%, từ 50 giảm 8% và trần 10%: một chính sách `Cộng dồn` 3% cho nhóm VIP cộng với bậc 8% cho ra 11%, bị cắt còn 10%.

Ngừng hoặc xoá chính sách: báo giá mới sẽ không áp chính sách này nữa; báo giá đã lập giữ nguyên cho đến khi bấm `Tính lại giá`.

## 5. Tab `Thử tính giá`

Chọn khách (`Chọn khách (nhóm lấy theo hồ sơ)`), thêm mặt hàng, `Ngày tính giá` (bỏ trống là hôm nay), bấm `Tính giá`. Bảng `Kết quả tính giá` hiện `Nguồn giá`, `Đơn giá gốc`, `Chiết khấu`, `Đơn giá sau CK`, `Thành tiền`, `Chính sách đã áp`. Dùng tab này kiểm tra bảng giá, chính sách trước khi cho nhân viên dùng.

## 6. Tab `Duyệt báo giá`

### 6.1. Ngưỡng duyệt báo giá

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `Hạn mức chiết khấu của nhân viên (%)` | 5 | Áp cho người lập không có `crm.quote.approve`, `crm.read.all`. |
| `Hạn mức của trưởng nhóm (%)` | 15 | Áp cho người lập có `crm.quote.approve`. |
| `Hạn mức của quản lý (%)` | Không giới hạn | Áp cho người lập có `crm.read.all` hoặc quản trị tenant. |
| `Biên lợi nhuận tối thiểu (%)` | 10 | Biên cả báo giá dưới mức này thì cần duyệt. |

Bỏ trống hạn mức là không giới hạn. Bấm `Lưu ngưỡng duyệt`. Ngưỡng mới áp cho lần gửi duyệt sau; phiên bản đã duyệt không bị xét lại.

Ngoài chiết khấu và biên, báo giá luôn cần duyệt khi có dòng ghi đè giá hoặc chiết khấu, hoặc dòng hàng tồn kho chưa có giá vốn.

### 6.2. Cách duyệt và gắn quy trình

Phần `Cách duyệt` có hai mục: `Báo giá vượt ngưỡng` và `Đơn bán vượt hạn mức công nợ`. Mỗi mục chọn:

- `Duyệt trực tiếp trong CRM` (mặc định): báo giá do người có `crm.quote.approve` trong phạm vi duyệt; vượt hạn mức do quản lý kinh doanh duyệt.
- `Duyệt qua Quy trình`: chọn `Quy trình duyệt` trong danh sách quy trình đã công bố, bấm `Lưu`. Mục `Quy trình đã gắn` hiện quy trình đang dùng.

Chuẩn bị trước trên phân hệ Quy trình: thiết kế, phân vai RACI và công bố một quy trình duyệt (cần `procedure.definition.manage`, `procedure.definition.publish`). Danh sách trống thì hiện `Chưa có quy trình đã công bố`.

Đổi cách duyệt chỉ áp cho lần gửi duyệt sau; hồ sơ đang chạy trên Quy trình vẫn hoàn tất trên Quy trình.

## 7. Cấu hình công nợ

`Công nợ` → tab `Cấu hình` (chỉ hiện với `crm.manage` hoặc quản trị tenant):

| Trường | Lựa chọn |
|---|---|
| `Ghi nhận nợ` | `Khi chứng từ xuất giao hàng được ghi sổ`; hợp đồng có đợt thanh toán thì ghi nợ theo đợt. |
| `Vượt hạn mức công nợ khi xác nhận đơn` | `Đưa đi duyệt` (mặc định) hoặc `Chặn xác nhận đơn`. |
| `Người nhận thêm cảnh báo quá hạn, vượt hạn mức` | Ngoài người phụ trách khách hàng và đơn, ví dụ kế toán công nợ. Bấm `Thêm người nhận`. |

Bấm `Lưu cấu hình`.

## 8. Kho bảo hành

`Bảo hành` → `Kho bảo hành` (chỉ hiện với `crm.manage` hoặc quản trị tenant):

| Trường | Ý nghĩa |
|---|---|
| `Kho cách ly` | Hàng bảo hành nhận về, `Chờ kiểm định`. |
| `Kho lỗi` | Hàng kiểm định `Lỗi` chuyển sang. |
| `Kho nhập lại hàng Đạt` | Dùng khi không biết kho đã xuất serial, dòng hàng. |

Nhập mã kho của phân hệ Kho. Giá trị mặc định khi mới bật phân hệ là mã kho dùng khi kiểm thử (`QA-KHO-CL`, `QA-KHO-LOI`); phải đổi sang kho thật trước khi tiếp nhận bảo hành.
