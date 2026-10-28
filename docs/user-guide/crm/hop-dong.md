# HƯỚNG DẪN SỬ DỤNG — BÁN HÀNG: HỢP ĐỒNG

> Phạm vi: trang `Hợp đồng` (nhóm Giao dịch). Quyền cần có: `crm.read` để xem, `crm.contract.write` để lập, xác nhận, hoàn thành, thanh lý, huỷ hợp đồng và nhập đợt thanh toán. Hợp đồng mua bán cũng được tạo tự động khi chuyển báo giá khách chấp nhận (xem [nhan-vien-kinh-doanh.md](./nhan-vien-kinh-doanh.md), mục 5.5).

## 1. Loại hợp đồng

| Loại | Dùng khi | Dòng hàng |
|---|---|---|
| `Hợp đồng mua bán` | Một lần mua, giao theo dòng có số lượng | Mỗi dòng có giá khung và số lượng; dòng hàng tồn kho có số lượng được giữ ở Kho khi xác nhận |
| `Hợp đồng khung` | Chốt giá cho nhiều đơn trong thời hạn | Chỉ chốt giá; bỏ trống số lượng |
| `Hợp đồng nguyên tắc` | Như hợp đồng khung | Chỉ chốt giá; bỏ trống số lượng |

Giá khung (trước VAT) của hợp đồng còn hiệu lực là nguồn giá ưu tiên số một khi tính giá báo giá và đơn của khách đó.

## 2. Lập hợp đồng

`Hợp đồng` → `Lập hợp đồng`:

| Trường | Ghi chú |
|---|---|
| `Loại hợp đồng`, `Khách hàng` `*`, `Tên hợp đồng` `*` | |
| `Ngày ký` | |
| `Hiệu lực từ` `*`, `Hiệu lực đến` | Bỏ trống ngày kết thúc là không thời hạn. |
| `Giá trị hợp đồng (VND)` | Bỏ trống: cộng thành tiền gồm VAT của các dòng có số lượng. |
| `Mã kho giữ hàng` | Bắt buộc trước khi xác nhận nếu có dòng hàng tồn kho có số lượng. |
| `Bảo hành (tháng)` | Thời hạn bảo hành theo hợp đồng; ưu tiên hơn thời hạn của mặt hàng khi tính hạn bảo hành serial giao theo hợp đồng này. |
| `Người phụ trách` | Bỏ trống là chính bạn. |
| `Ghi chú` | |

Dòng giá khung và đợt thanh toán nhập ở màn chi tiết.

## 3. Dòng giá khung

Trong chi tiết hợp đồng `Nháp`, bấm `Thêm dòng giá khung`, chọn mặt hàng từ danh mục Kho, nhập `Giá khung trước VAT (VND)`, `Số lượng` (bỏ trống với hợp đồng khung, nguyên tắc), `Thuế suất (%)` (mặc định 10%). Tối đa 200 dòng.

## 4. Đợt thanh toán

| Cột | Ghi chú |
|---|---|
| `Tên đợt` | Mặc định `Đợt 1`, `Đợt 2`... |
| `Nhập theo` | `Phần trăm` hoặc `Số tiền`, không cả hai. |
| `Điều kiện` | `Theo ngày` (bắt buộc `Hạn thanh toán`), `Khi ký hợp đồng`, `Khi giao hàng`, `Khi nghiệm thu`. |
| `Số ngày sau điều kiện` | Số ngày phải thu sau khi điều kiện xảy ra. |

Tổng các đợt phải bằng 100% giá trị hợp đồng; đợt phần trăm cuối nhận phần lẻ làm tròn. Tối đa 24 đợt. Bấm `Lưu đợt thanh toán` hoặc `Bỏ thay đổi`.

Không có đợt thanh toán thì công nợ ghi theo xuất kho (`Chưa có đợt thanh toán (công nợ ghi theo xuất kho).`). Có đợt thì nợ ghi theo đợt:

- Đợt `Khi nghiệm thu`: bấm `Ghi nhận nghiệm thu` trên dòng đợt, nhập `Ngày nghiệm thu` (để trống là hôm nay; hạn thanh toán tính từ ngày này), bấm `Ghi nhận`.
- Trạng thái đợt: `Chưa đến hạn`, `Đến hạn`, `Đã ghi nợ`, `Đã thu`, `Đã huỷ`.

## 5. Vòng đời hợp đồng

| Trạng thái | Nút | Điều kiện, kết quả |
|---|---|---|
| `Nháp` | `Sửa thông tin`, `Xác nhận hợp đồng`, `Huỷ hợp đồng` | Xác nhận cần đợt thanh toán hợp lệ và giữ đủ hàng. |
| `Hiệu lực` | `Hoàn thành`, `Huỷ hợp đồng` | Hoàn thành khi đã giao và thu đủ (ghi `Lý do (đã giao và thu đủ)`). Huỷ chỉ khi chưa có đơn đã giao; mọi phần giữ được nhả. |
| `Hết hạn` | `Thanh lý` | Hệ thống tự chuyển khi qua `Hiệu lực đến`. |
| `Hoàn thành` | `Thanh lý` | Ghi `Nội dung xác nhận thanh lý`. |
| `Đã thanh lý`, `Đã huỷ` | | Trạng thái cuối. |

Hộp `Xác nhận hợp đồng?` nhắc: hợp đồng chuyển `Hiệu lực`; các dòng hàng tồn kho có số lượng được giữ ở Kho; thiếu tồn thì không giữ dòng nào (giữ tất cả hoặc không). Khi thiếu, màn hình liệt kê dòng thiếu và hợp đồng vẫn ở `Nháp`.

## 6. Giữ hàng theo hợp đồng

- Phần giữ hiện trên chi tiết hợp đồng kèm hạn giữ (`Đang giữ`, `Đã nhả`, `Hết hạn giữ`).
- Đơn bán lập từ hợp đồng dùng phần hàng hợp đồng đã giữ trước.
- Hợp đồng hết hạn hoặc bị huỷ: hệ thống nhả phần giữ còn lại và báo người phụ trách.
- Gia hạn hợp đồng hiện chưa tự gia hạn phần giữ hàng.

## 7. Đơn bán từ hợp đồng

`Đơn bán của hợp đồng` liệt kê `Mã đơn`, `Ngày đơn`, `Trạng thái`, `Giá trị`. Lập đơn mới: `Đơn bán` → `Lập đơn bán` → chọn `Từ hợp đồng`. Đơn dùng giá khung và khách của hợp đồng; hợp đồng phải ở `Hiệu lực` và hôm nay nằm trong thời hạn, nếu không hệ thống báo `Hợp đồng đã hết hiệu lực`.

## 8. Thông báo

- `Hợp đồng sắp hết hạn`: gửi người phụ trách trước số ngày quản trị cấu hình (mặc định 30).
- Phần giữ hàng của hợp đồng bị mất hoặc được nhả: gửi người phụ trách.
