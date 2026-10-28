# HƯỚNG DẪN SỬ DỤNG — PHÂN HỆ BÁN HÀNG (CRM)

> Phạm vi: phân hệ CRM (`/modules/crm`) và các màn Kho, Tài chính, Quy trình mà người bán hàng dùng kèm. Chức năng hiển thị phụ thuộc vào entitlement `crm` của tenant và quyền mà quản trị tenant đã cấp. Quyền thật được kiểm ở API; nút bị ẩn trên giao diện chỉ là hệ quả của quyền, không phải cách phân quyền.

## 1. Tài liệu theo vai trò

| Vai trò | Tài liệu | Nội dung chính |
|---|---|---|
| Nhân viên kinh doanh | [nhan-vien-kinh-doanh.md](./nhan-vien-kinh-doanh.md) | Khách hàng, lead, cơ hội (kanban), hoạt động, báo giá, đơn bán |
| Trưởng nhóm, quản lý kinh doanh | [truong-nhom-quan-ly.md](./truong-nhom-quan-ly.md) | Duyệt báo giá (trực tiếp hoặc trên Quy trình), phạm vi nhóm, duyệt vượt hạn mức, báo cáo |
| Quản trị bán hàng | [quan-tri-ban-hang.md](./quan-tri-ban-hang.md) | Nhóm khách, mã khách, bảng giá, chính sách chiết khấu, ngưỡng duyệt, gắn quy trình duyệt, cấu hình |
| Quản lý hợp đồng | [hop-dong.md](./hop-dong.md) | Hợp đồng mua bán, khung, nguyên tắc; đợt thanh toán; giữ hàng theo hợp đồng |
| Thủ kho, quản lý kho | [thu-kho.md](./thu-kho.md) | Chứng từ nhiều dòng, duyệt chứng từ, lô FEFO, serial, chất lượng, yêu cầu xuất từ đơn bán, báo cáo kho |
| Kế toán công nợ | [ke-toan-cong-no.md](./ke-toan-cong-no.md) | Thu tiền, phân bổ, phiếu thu bên Tài chính, điều chỉnh, tuổi nợ, hạn mức |
| Kỹ thuật, chăm sóc khách hàng | [bao-hanh.md](./bao-hanh.md) | Tra serial, tiếp nhận, kiểm định, xử lý, đổi trả |

Tài liệu vận hành khi đưa phân hệ vào dùng: [docs/operations/crm-go-live-runbook.md](../../operations/crm-go-live-runbook.md).

## 2. Bản đồ menu

Menu bên trái của phân hệ CRM chia theo nhóm. Mỗi trang có địa chỉ riêng dạng `/modules/crm#<trang>`, có thể gửi đường dẫn cho người khác.

| Nhóm | Trang | Nội dung | Ai thấy |
|---|---|---|---|
| Bán hàng | Tổng quan | Phạm vi dữ liệu, danh sách quyền của bạn, lối tắt vào các trang | Mọi người có `crm.read` |
| Bán hàng | Khách hàng | Hồ sơ khách, người liên hệ, nhóm khách, người phụ trách, dòng thời gian | `crm.read` |
| Bán hàng | Lead | Đầu mối tiềm năng; chuyển thành khách hàng và cơ hội bằng một thao tác | `crm.read` |
| Bán hàng | Cơ hội | Kanban kéo thả theo giai đoạn, dạng bảng, lịch sử chuyển giai đoạn | `crm.read` |
| Bán hàng | Hoạt động | Gọi điện, email, gặp mặt, công việc; nhắc trước hạn và khi quá hạn | `crm.read` |
| Bán hàng | Báo giá | Báo giá theo phiên bản, tính giá theo bảng giá và chính sách, duyệt báo giá | `crm.read` |
| Giao dịch | Hợp đồng | Hợp đồng mua bán, hợp đồng khung, nguyên tắc; đợt thanh toán; hiệu lực | `crm.read` |
| Giao dịch | Đơn bán | Đơn bán, giữ hàng ở Kho, kế hoạch giao nhiều đợt, yêu cầu xuất kho | `crm.read` |
| Giao dịch | Công nợ | Tuổi nợ theo khách, sổ công nợ, lần thu tiền, điều chỉnh, cấu hình công nợ | `crm.read` |
| Sau bán | Bảo hành | Tra cứu bảo hành theo serial, yêu cầu bảo hành, đổi trả, nhập trả về Kho | `crm.read` |
| Sau bán | Báo cáo | Doanh thu, lợi nhuận; tỷ lệ chuyển đổi; cảnh báo; công nợ phải thu | `crm.report.read` hoặc quản trị tenant |
| Quản trị | Cấu hình | Tab `Chung`, `Bảng giá`, `Chính sách chiết khấu`, `Thử tính giá`, `Duyệt báo giá` | `crm.manage` hoặc quản trị tenant |

Trang **Tổng quan** hiện:

- `Phạm vi dữ liệu`: `Toàn bộ dữ liệu CRM` (người có `crm.read.all`, `crm.manage` hoặc quản trị tenant) hoặc `Dữ liệu của bạn và cấp dưới theo cơ cấu tổ chức`.
- `Quyền của bạn`: danh sách nhãn như `Lập báo giá`, `Duyệt báo giá`, `Lập đơn bán`, `Thu tiền, công nợ`... Không có quyền ghi nào thì hiện `Chỉ xem`.

Khi tenant vừa bật phân hệ, trang hiện `Dữ liệu CRM của tenant đang được khởi tạo.` cho đến khi migration của `crm_schema` chạy xong.

## 3. Quyền và vai trò

### 3.1. Action quyền của CRM

| Action | Nhãn trên Tổng quan | Cho phép |
|---|---|---|
| `crm.read` | (quyền vào phân hệ) | Xem dữ liệu CRM trong phạm vi của mình |
| `crm.read.all` | (phạm vi `Toàn bộ dữ liệu CRM`) | Xem toàn bộ dữ liệu, không lọc theo người phụ trách; được tính là "quản lý" khi xét ngưỡng duyệt; duyệt điều chỉnh công nợ, duyệt vượt hạn mức trực tiếp |
| `crm.opportunity.write` | `Quản lý khách hàng, cơ hội` | Khách hàng, lead, cơ hội, hoạt động của mình |
| `crm.quote.write` | `Lập báo giá` | Lập, sửa, gửi duyệt, đánh dấu gửi khách, ghi nhận khách chấp nhận hoặc từ chối |
| `crm.quote.approve` | `Duyệt báo giá` | Duyệt, từ chối báo giá do người khác gửi; được tính là "trưởng nhóm" khi xét ngưỡng duyệt |
| `crm.order.write` | `Lập đơn bán` | Lập, xác nhận, huỷ, đóng đơn; kế hoạch giao; yêu cầu xuất kho |
| `crm.contract.write` | `Quản lý hợp đồng` | Lập, xác nhận, hoàn thành, thanh lý, huỷ hợp đồng; đợt thanh toán |
| `crm.receivable.write` | `Thu tiền, công nợ` | Ghi nhận thu tiền, phân bổ, lập điều chỉnh công nợ |
| `crm.warranty.write` | `Xử lý bảo hành` | Tiếp nhận, kiểm định, xử lý, đóng yêu cầu bảo hành |
| `crm.report.read` | `Xem báo cáo` | Trang Báo cáo |
| `crm.manage` | `Quản trị bán hàng` | Nhóm khách, mã khách, bảng giá, chính sách, ngưỡng và cách duyệt, hạn mức, cấu hình; thấy toàn bộ dữ liệu |

Quản trị tenant (`tenant.manage`) có mọi quyền CRM. Quyền kéo theo: mọi quyền `crm.*` đều kèm `crm.read`; `crm.manage` kèm `crm.read.all` nhưng không kèm các quyền ghi (lập báo giá, đơn...), nên quản trị bán hàng cần được gán thêm quyền ghi nếu cũng thao tác nghiệp vụ.

Hai quyền Kho mới đi cùng đợt nâng cấp: `inventory.document.approve` (Duyệt chứng từ nhập khác, xuất khác và điều chỉnh kho) và `inventory.quality.write` (Đổi trạng thái chất lượng của lô và serial); cả hai nằm trong `inventory.manage`.

### 3.2. Gợi ý gán quyền theo vai trò

Hệ thống không tạo sẵn vai trò nghiệp vụ; chỉ vai trò quản trị tenant tự có mọi quyền `crm.*`. Bảng dưới là cách gán đã dùng khi kiểm thử, quản trị tenant tạo vai trò tương ứng trong màn quản trị vai trò.

| Vai trò | Quyền |
|---|---|
| Nhân viên kinh doanh | `crm.read`, `crm.opportunity.write`, `crm.quote.write`, `crm.order.write` |
| Trưởng nhóm kinh doanh | Quyền nhân viên + `crm.quote.approve` |
| Quản lý kinh doanh, ban giám đốc | Quyền trưởng nhóm + `crm.read.all`, `crm.report.read`, `inventory.read` |
| Quản trị bán hàng, admin hợp đồng | `crm.manage`, `crm.contract.write` |
| Kỹ thuật, chăm sóc khách hàng | `crm.read`, `crm.read.all`, `crm.warranty.write` |
| Thủ kho | `inventory.read`, `inventory.transaction.write`, `inventory.quality.write` |
| Quản lý kho | `inventory.manage` (gồm `inventory.document.approve`) |
| Kế toán công nợ | `crm.read`, `crm.read.all`, `crm.receivable.write`, `finance.read`, `finance.receipt.create` |
| Kế toán ghi sổ phiếu thu (Tài chính) | `finance.read`, `finance.receipt.approve` |

### 3.3. Phạm vi dữ liệu

- Người có `crm.read.all`, `crm.manage` hoặc quản trị tenant thấy toàn bộ.
- Người khác thấy bản ghi do chính mình phụ trách cộng bản ghi của cấp dưới theo chuỗi "Báo cáo cho" trong cơ cấu tổ chức ở Core. Trưởng nhóm vì vậy thấy dữ liệu cả nhóm mà không cần `crm.read.all`.
- Bản ghi ngoài phạm vi trả lỗi không tìm thấy, như thể không tồn tại.
- Nếu Core không trả lời được cơ cấu tổ chức, hệ thống báo lỗi tạm thời chứ không mở rộng phạm vi.

## 4. Luồng nghiệp vụ chính

```text
Lead ──Chuyển đổi──> Khách hàng + Cơ hội (Mới)
Cơ hội ──> Báo giá (phiên bản) ──Gửi duyệt──> Đã duyệt ──> Đã gửi khách ──> Khách chấp nhận
Khách chấp nhận ──Chuyển thành hợp đồng, đơn──> Hợp đồng mua bán + Đơn bán (Nháp)
Đơn bán ──Xác nhận đơn──> giữ hàng ở Kho ──Yêu cầu xuất kho──> Kho ghi sổ chứng từ xuất
Kho ghi sổ xuất ──> Đơn cập nhật số đã giao, serial, giá vốn ──> Sổ công nợ ghi nợ
Ghi nhận thu tiền ──> phiếu thu nháp bên Tài chính ──Kế toán ghi sổ──> phân bổ có hiệu lực
Serial đã giao ──> Bảo hành: tiếp nhận ──> nhập trả kho cách ly ──> kiểm định ──> xử lý
```

## 5. Quy ước chung trên giao diện

| Quy ước | Ý nghĩa |
|---|---|
| `*` | Trường bắt buộc. |
| Hộp chọn có tìm kiếm | Gõ mã hoặc tên rồi chọn; bấm dấu xoá để bỏ lọc. |
| `Mọi người phụ trách`, `Mọi trạng thái` | Bộ lọc đang để trống, hiện tất cả trong phạm vi của bạn. |
| `Dòng thời gian`, `Nhật ký` | Lịch sử thao tác của khách, báo giá, hợp đồng, đơn, bảo hành. |
| Hộp xác nhận | Thao tác đổi trạng thái (xác nhận, huỷ, đóng, chuyển) luôn hỏi lại; đọc kỹ mô tả trước khi bấm. |
| Sửa đồng thời | Hệ thống từ chối lưu nếu người khác vừa sửa cùng bản ghi; tải lại rồi sửa tiếp. |

Tiền tính bằng VND, làm tròn đến đồng theo từng dòng. Ngày hiệu lực tính trọn ngày theo giờ Việt Nam.
