# HƯỚNG DẪN SỬ DỤNG — BÁN HÀNG: BẢO HÀNH VÀ ĐỔI TRẢ

> Phạm vi: trang `Bảo hành` (nhóm Sau bán): tra cứu bảo hành theo serial, tiếp nhận, nhận hàng về kho cách ly, kiểm định, xử lý, đóng yêu cầu. Quyền cần có: `crm.read` để xem, `crm.warranty.write` để xử lý; thường kèm `crm.read.all` để tra mọi khách. Thủ kho ghi sổ các chứng từ kho sinh ra (xem [thu-kho.md](./thu-kho.md)).

## 1. Cách tính hạn bảo hành

| Quy tắc | Chi tiết |
|---|---|
| Mốc bắt đầu | Ngày giao thực tế của serial, tức ngày Kho ghi sổ chứng từ xuất của đợt giao chứa serial; không phải ngày đơn. |
| Ưu tiên hợp đồng | Đơn đi từ hợp đồng có `Bảo hành (tháng)` lớn hơn 0 thì dùng thời hạn hợp đồng, kể cả khi ngắn hơn thời hạn của mặt hàng. |
| Theo mặt hàng | Không có thời hạn hợp đồng thì dùng số tháng bảo hành của mặt hàng trong danh mục Kho. |
| Serial thay thế | Serial xuất thay thế kế thừa đúng ngày hết hạn của serial cũ, không tính lại từ đầu. |
| Ngày cuối | Tính cả ngày cuối: giao 15/03, 12 tháng thì còn bảo hành đến hết 15/03 năm sau. Tháng đích không có ngày đó thì lấy ngày cuối tháng. |
| Không rõ | Không có ngày giao hoặc không có thời hạn: coi như hết hạn. |

Nguồn hạn hiện trên kết quả tra cứu: `Theo hợp đồng`, `Theo mặt hàng`, `Kế thừa serial được thay`, `Không có bảo hành`.

Serial hết hạn vẫn tiếp nhận được nhưng là loại có phí.

## 2. Tra cứu bảo hành theo serial

1. Vào `Bảo hành`, ô `Tra cứu bảo hành theo serial`, nhập `Số serial` (ví dụ SN031), bấm `Tra cứu`.
2. Kết quả hiện khách hàng, đơn, ngày giao, `Hạn bảo hành` (ngày cuối và số ngày còn lại), nguồn hạn, hợp đồng (nếu có), và `Hàng thay thế của ...` nếu serial là hàng đổi.
3. Trong chi tiết yêu cầu, bấm số serial ở bảng `Dòng yêu cầu` để xem `Lịch sử serial ...`: các bước kho (`Nhập kho`, `Xuất kho`, `Điều chuyển`, `Nhập trả`, `Xuất bảo hành`, `Điều chỉnh`, `Đảo chứng từ`, `Đổi trạng thái chất lượng`) và các yêu cầu bảo hành có serial đó.
4. Serial đang có yêu cầu mở thì hiện `Đang có yêu cầu bảo hành mở`; bấm để mở yêu cầu đó, không tạo yêu cầu thứ hai.

## 3. Tiếp nhận yêu cầu

Bấm `Tiếp nhận yêu cầu` từ kết quả tra cứu (hoặc `Tiếp nhận (có phí)` khi đã hết hạn), hoặc từ danh sách yêu cầu:

| Trường | Ghi chú |
|---|---|
| `Số serial` | Mỗi dòng một serial; các serial phải cùng một khách. Tối đa 50 dòng. Màn tiếp nhận hiện chỉ nhận theo serial; hàng không theo serial chưa tiếp nhận được trên giao diện. |
| `Nguyên nhân` `*` | `Lỗi kỹ thuật`, `Giao sai`, `Giao thiếu`, `Khách đổi ý`, `Trả theo chính sách`. |
| Mô tả | `Mô tả lỗi, yêu cầu của khách`. |
| `Người xử lý` | Bỏ trống là bạn. |

Yêu cầu mới có mã dạng `BH<năm><số>` và trạng thái `Tiếp nhận`. Không đủ điều kiện thì bấm `Từ chối`, nhập `Lý do không đủ điều kiện`.

## 4. Vòng đời yêu cầu

| Trạng thái | Việc cần làm | Ai làm |
|---|---|---|
| `Tiếp nhận` | `Nhận hàng về kho cách ly`: gửi chứng từ nhập trả sang Kho | Kỹ thuật, CSKH |
| `Chờ nhận hàng` | Thủ kho ghi sổ chứng từ `Nhập trả hàng bán` vào kho cách ly; hàng ở trạng thái `Chờ kiểm định` | Thủ kho |
| `Đang kiểm định` | Bấm `Kiểm định` trên từng dòng, chọn `Kết quả` `Đạt` hoặc `Lỗi`, `Ghi chú` | Kỹ thuật |
| `Đang xử lý` | Bấm `Xử lý` trên từng dòng, chọn hướng xử lý, bấm `Sinh chứng từ` | Kỹ thuật, CSKH |
| `Đã xử lý` | Thủ kho, kế toán ghi sổ các chứng từ sinh ra | Thủ kho, quản lý bán hàng |
| `Đã đóng` | `Đóng yêu cầu` | Kỹ thuật, CSKH |
| `Từ chối` | Trạng thái cuối | |

Chuyển trạng thái tự động: `Chờ nhận hàng` → `Đang kiểm định` khi Kho ghi sổ nhập trả; `Đang kiểm định` → `Đang xử lý` khi mọi dòng có kết quả; `Đang xử lý` → `Đã xử lý` khi mọi dòng có hướng xử lý và chứng từ.

## 5. Hướng xử lý

Hộp `Hướng xử lý` của mỗi dòng có hai phần:

| Phần | Lựa chọn | Chứng từ sinh ra |
|---|---|---|
| `Hàng nhận về` `*` | `Nhập lại hàng tốt` | Đổi trạng thái chất lượng về `Đạt` và điều chuyển về kho bán (kho đã xuất, hoặc `Kho nhập lại hàng Đạt` khi không biết) |
| | `Chuyển kho lỗi` | Điều chuyển sang `Kho lỗi` |
| | `Loại bỏ` | `Xuất khác (loại bỏ)` |
| `Xử lý cho khách` | `Không` | |
| | `Đổi hàng (xuất thay thế)` | `Xuất bảo hành (hàng thay thế)`; nhập `Kho xuất hàng thay thế` `*` (mặc định kho đã giao serial cũ). Thủ kho chọn serial thay thế; serial mới kế thừa hạn còn lại. |
| | `Hoàn tiền` | Hoàn tiền theo giá trị dòng đơn |
| | `Giảm trừ công nợ` | `Điều chỉnh giảm công nợ` theo giá trị dòng đơn; quản lý bán hàng duyệt |

Hoàn tiền, giảm trừ tính theo giá trị dòng đơn, nên chỉ chọn được khi dòng yêu cầu gắn với một dòng đơn bán.

## 6. Chứng từ của yêu cầu

Phần `Chứng từ` liệt kê `Loại`, `Số chứng từ`, `Số tiền`, `Trạng thái`:

| Trạng thái | Ý nghĩa |
|---|---|
| `Chưa gửi được` | Lỗi tạm khi gửi sang Kho hoặc sổ công nợ. Bấm `Gửi lại chứng từ`. |
| `Chờ thủ kho ghi sổ` | Đã tạo nháp ở Kho. |
| `Chờ duyệt` | Chờ người duyệt chứng từ kho (ví dụ `Xuất khác`). |
| `Chờ sổ công nợ` | Đề nghị điều chỉnh công nợ đang chờ duyệt. |
| `Đã ghi sổ` | Hoàn tất. |
| `Đã đảo` | Kho đã đảo chứng từ. |

`Đóng yêu cầu` chỉ được khi mọi dòng đã xử lý và mọi chứng từ đã ghi sổ.

## 7. Cấu hình kho bảo hành

Quản trị bán hàng đặt `Kho cách ly`, `Kho lỗi`, `Kho nhập lại hàng Đạt` ở nút `Kho bảo hành` (xem [quan-tri-ban-hang.md](./quan-tri-ban-hang.md), mục 8). Kiểm tra cấu hình này trước khi tiếp nhận yêu cầu đầu tiên.
