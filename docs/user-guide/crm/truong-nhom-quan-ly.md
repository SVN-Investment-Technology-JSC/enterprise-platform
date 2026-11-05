# HƯỚNG DẪN SỬ DỤNG — BÁN HÀNG: TRƯỞNG NHÓM VÀ QUẢN LÝ KINH DOANH

> Phạm vi: duyệt báo giá (trực tiếp trong CRM hoặc trên Quy trình), phạm vi dữ liệu của nhóm, duyệt vượt hạn mức công nợ, duyệt điều chỉnh công nợ, báo cáo. Trưởng nhóm cần thêm `crm.quote.approve`; quản lý cần thêm `crm.read.all` và `crm.report.read`. Thao tác lập khách, báo giá, đơn xem ở [nhan-vien-kinh-doanh.md](./nhan-vien-kinh-doanh.md).

## 1. Phạm vi dữ liệu

| Vai trò | Thấy gì | Cách xác định |
|---|---|---|
| Trưởng nhóm (không có `crm.read.all`) | Bản ghi của mình và của mọi cấp dưới | Chuỗi "Báo cáo cho" trong cơ cấu tổ chức ở Core, tính cả cấp dưới gián tiếp |
| Quản lý (`crm.read.all`) | Toàn bộ dữ liệu CRM | Không lọc theo người phụ trách |

Trang `Tổng quan` hiện phạm vi đang áp dụng cho bạn. Khi nhân viên đổi nhóm, chỉ cần sửa quan hệ "Báo cáo cho" ở Core; phạm vi trong CRM tự cập nhật. Bộ lọc `Mọi người phụ trách` trên các danh sách chỉ liệt kê người trong phạm vi của bạn.

Báo cáo cũng áp đúng phạm vi này: trưởng nhóm có `crm.report.read` chỉ thấy số liệu của nhóm mình.

## 2. Duyệt báo giá

### 2.1. Khi nào báo giá cần duyệt

Hệ thống tự xét lúc nhân viên bấm `Gửi duyệt`. Báo giá cần duyệt khi có ít nhất một điều:

- chiết khấu của một dòng, hoặc chiết khấu bình quân cả báo giá, vượt hạn mức theo vai trò người gửi;
- biên lợi nhuận dưới mức tối thiểu;
- có dòng ghi đè đơn giá hoặc chiết khấu;
- có dòng hàng tồn kho mà Kho chưa có giá vốn ước tính.

Vai trò người gửi xác định theo quyền: có `crm.read.all` (hoặc quản trị tenant) là quản lý; có `crm.quote.approve` là trưởng nhóm; còn lại là nhân viên. Mặc định: nhân viên 5%, trưởng nhóm 15%, quản lý không giới hạn, biên tối thiểu 10%. Đúng bằng hạn mức thì không cần duyệt.

Không có lý do nào thì phiên bản sang thẳng `Đã duyệt`, không ai phải duyệt.

### 2.2. Duyệt trực tiếp trong CRM

Áp dụng khi cách duyệt báo giá là `Duyệt trực tiếp trong CRM` (mặc định).

1. Cấp trên của người gửi nhận thông báo báo giá cần duyệt, kèm lý do đầu tiên.
2. Mở báo giá từ thông báo hoặc từ `Báo giá`, lọc trạng thái `Chờ duyệt`.
3. Xem các lý do cần duyệt, dòng hàng, cột `Biên`, `Giá vốn BQ`, `Chính sách đã áp`. Dùng `So sánh phiên bản` nếu là bản sửa.
4. Bấm `Duyệt`, hoặc `Từ chối duyệt` và ghi `Lý do` (bắt buộc).

Quy tắc:

- Người duyệt cần `crm.quote.approve` và phải thấy báo giá trong phạm vi của mình.
- Không được tự duyệt báo giá do mình gửi; nút không hiện và server cũng chặn.
- Phiên bản bị từ chối chỉ sửa được bằng cách tạo phiên bản mới; phiên bản mới phải gửi duyệt lại.

### 2.3. Duyệt trên Quy trình

Áp dụng khi quản trị bán hàng chọn `Duyệt qua Quy trình` và gắn một quy trình đã công bố (xem [quan-tri-ban-hang.md](./quan-tri-ban-hang.md)).

1. Khi nhân viên gửi duyệt, CRM tạo hồ sơ trên phân hệ Quy trình. Báo giá hiện mã hồ sơ và trạng thái: `đang tạo hồ sơ.`, `đang chờ người duyệt trên Quy trình.`, `đã có kết quả.`
2. Người duyệt xử lý bước duyệt trên màn hồ sơ của Quy trình theo phân vai RACI của quy trình (cần `procedure.access`).
3. Quy trình hoàn tất thì báo giá tự sang `Đã duyệt` hoặc `Từ chối duyệt`; người gửi nhận thông báo.

Lưu ý:

- Khi báo giá đang chờ trên Quy trình, nút `Duyệt` trong CRM bị chặn với thông báo `Báo giá đang được duyệt qua Quy trình; vui lòng thao tác trên hồ sơ Quy trình.`
- Nếu Quy trình không tạo được hồ sơ, hệ thống tự thử lại; khi đó báo giá hiện `chưa tạo được hồ sơ, hệ thống đang thử lại`. Chỉ khi hồ sơ lỗi vĩnh viễn (không có hồ sơ) mới được duyệt trực tiếp trong CRM.
- Nếu Quy trình thu hồi kết quả duyệt, nhật ký báo giá ghi `Quy trình thu hồi kết quả duyệt`. Trường hợp khách đã chấp nhận rồi mới bị thu hồi hiện chưa được xử lý tự động; trao đổi với quản trị bán hàng.

## 3. Duyệt vượt hạn mức công nợ

Khi nhân viên xác nhận đơn mà dư nợ theo sổ cộng giá trị đơn vượt hạn mức của khách, và cấu hình là `Đưa đi duyệt`, đơn sang `Chờ duyệt hạn mức`. Chi tiết đơn có khối `Duyệt vượt hạn mức công nợ` ghi rõ: `Dư nợ ... cộng giá trị đơn ... vượt hạn mức ...`.

| Cách duyệt | Ai duyệt | Thao tác |
|---|---|---|
| Trực tiếp | Người thấy toàn bộ dữ liệu CRM (quản lý kinh doanh) | `Duyệt vượt hạn mức` hoặc `Từ chối` (hộp `Từ chối duyệt vượt hạn mức`, bắt buộc lý do) |
| Qua Quy trình | Người được giao trên quy trình | Xử lý trên hồ sơ Quy trình; khối hiện `Duyệt trên Quy trình, hồ sơ ...` |

Duyệt xong hệ thống mới giữ hàng. Nếu lúc đó không giữ được (thiếu tồn, hợp đồng hết hiệu lực...), đơn về `Nháp` kèm lý do; nhân viên xử lý rồi xác nhận lại, không phải duyệt lại nếu giá trị đơn không tăng. Từ chối thì đơn về `Nháp` kèm lý do.

Nếu hồ sơ Quy trình lỗi vĩnh viễn, yêu cầu tự chuyển sang duyệt trực tiếp trong CRM và người lập đơn nhận thông báo.

## 4. Duyệt điều chỉnh công nợ

Điều chỉnh công nợ (giảm trừ do trả hàng, chiết khấu thanh toán, hoặc tăng nợ) do kế toán hoặc nhân viên có `crm.receivable.write` lập, ở trạng thái `Chờ duyệt`. Chỉ quản lý bán hàng (thấy toàn bộ dữ liệu) mới duyệt được, và người lập không được tự duyệt.

Vào `Công nợ` → tab `Điều chỉnh công nợ`, bấm `Duyệt` trên dòng (hộp `Duyệt điều chỉnh ...`) hoặc `Huỷ điều chỉnh` kèm `Lý do huỷ`. Duyệt xong sổ công nợ có dòng điều chỉnh mới.

## 5. Báo cáo

Trang `Báo cáo` cần `crm.report.read`. Mọi báo cáo áp phạm vi dữ liệu của người xem.

### 5.1. Bộ lọc chung

| Thành phần | Hướng dẫn |
|---|---|
| Kỳ | `Tháng này`, `Tháng trước`, `Quý này`, `Năm nay`, `12 tháng gần nhất` hoặc `Kỳ tuỳ chọn` với `Từ ngày`, `Đến ngày`. Kỳ dài nhất khoảng 3 năm (1.100 ngày). |
| `Mọi nhân viên`, `Mọi nhóm khách`, `Khu vực (đúng tên)` | Thu hẹp số liệu. Khu vực phải gõ đúng tên như trên hồ sơ khách. |
| `Xuất Excel` | Tải file Excel của tab đang xem. |

### 5.2. Các tab

| Tab | Nội dung |
|---|---|
| `Doanh thu, lợi nhuận` | `Nhóm theo` `Nhân viên`, `Khách hàng`, `Sản phẩm`, `Nhóm hàng`, `Khu vực`, `Nhóm khách`. Chỉ số `Doanh thu`, `Giá vốn thực tế`, `Lợi nhuận gộp`, `Biên lợi nhuận`, `Sản lượng`, `Số đơn`. Tối đa 2.000 nhóm, xếp theo doanh thu giảm dần. |
| `Tỷ lệ chuyển đổi` | Phễu `Cơ hội` → `Báo giá` → `Hợp đồng` → `Đơn bán` theo nhân viên; mỗi bước có tỷ lệ so với bước trước và so với bước đầu. |
| `Cảnh báo` | `Báo giá chờ duyệt`, `Hợp đồng sắp hết hạn`, `Đơn giao trễ`, lọc bằng `Mọi loại cảnh báo`. |
| `Công nợ phải thu` | Theo khách: `Doanh thu ghi nợ`, `Đã thu`, `Điều chỉnh`, `Dư nợ`, `Doanh thu chưa thu`, `Đến hạn, quá hạn`; danh sách `Đơn quá hạn`. |

Doanh thu và giá vốn lấy theo chứng từ xuất kho đã ghi sổ (giá vốn thực tế), không theo giá vốn ước tính lúc báo giá. Ngày giao là thời điểm Kho ghi sổ chứng từ xuất.
