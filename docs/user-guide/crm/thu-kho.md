# HƯỚNG DẪN SỬ DỤNG — KHO: THỦ KHO VÀ QUẢN LÝ KHO (NÂNG CẤP CÙNG BÁN HÀNG)

> Phạm vi: phần mới của phân hệ `Kho & Vật tư` đi cùng CRM: chứng từ kho nhiều dòng, duyệt chứng từ, lô và hạn dùng (FEFO), serial, trạng thái chất lượng, yêu cầu xuất từ đơn bán, báo cáo kho. Phần cũ (cây tài sản, danh mục, kiểm kê) xem [HDSD_02](../HDSD_02_NHA_KHO_VA_CAY_TAI_SAN_CHI_TIET.md).

## 1. Quyền

| Action | Nhãn | Dùng cho |
|---|---|---|
| `inventory.read` | Xem kho và tài sản | Xem chứng từ, tồn, báo cáo kho |
| `inventory.transaction.write` | Nhập, xuất, chuyển kho và giữ chỗ | Lập, sửa, gửi duyệt, ghi sổ, huỷ, đảo chứng từ; xử lý yêu cầu xuất |
| `inventory.document.approve` | Duyệt chứng từ nhập khác, xuất khác và điều chỉnh kho | Duyệt, từ chối chứng từ |
| `inventory.quality.write` | Đổi trạng thái chất lượng của lô và serial | Nút `Đổi chất lượng` |
| `inventory.manage` | Quản lý kho, tài sản và cấu hình (bao gồm giao dịch) | Gồm tất cả quyền trên |

Thủ kho thường có `inventory.read`, `inventory.transaction.write`, `inventory.quality.write`; quản lý kho có `inventory.manage`.

## 2. Menu mới

| Nhóm | Trang | Nội dung |
|---|---|---|
| Chứng từ | `Chứng từ kho` | Danh sách, lập và xử lý chứng từ nhập, xuất, chuyển, điều chỉnh nhiều dòng |
| Chứng từ | `Duyệt chứng từ` | Chứng từ đang `Chờ duyệt` |
| Chứng từ | `Yêu cầu xuất từ đơn bán` | Chứng từ xuất nháp do CRM gửi sang (xuất bán, xuất bảo hành) |
| Báo cáo | `Báo cáo kho` | Tồn theo kho, lô, serial; nhập xuất; lịch sử duyệt |

## 3. Tồn thực tế, đã giữ, khả dụng

Bảng tồn có bốn cột:

| Cột | Ý nghĩa |
|---|---|
| `Thực tế` | Số đang nằm trong kho. |
| `Đã giữ` | Phần đã giữ cho đơn bán, hợp đồng. |
| `Chờ kiểm định/không đạt` | Hàng thuộc lô, serial không ở trạng thái `Đạt`. |
| `Khả dụng` | `Thực tế − Đã giữ − Chờ kiểm định/không đạt`; là số còn bán hoặc xuất được. |

Thay đổi so với trước: mọi phiếu xuất tự do (xuất dự án, xuất khác, điều chuyển) chỉ lấy được từ tồn **khả dụng**. Hàng đã giữ cho đơn bán được bảo vệ; muốn dùng thì CRM phải nhả giữ hàng trước.

## 4. Chứng từ kho

### 4.1. Loại chứng từ

| Loại | Lập tay | Duyệt trước khi ghi sổ | Ghi chú |
|---|---|---|---|
| `Nhập mua hàng` | Có | Không | |
| `Nhập khác` | Có | Có | |
| `Xuất cho dự án` | Có | Không | Chỉ lấy hàng `Đạt`. |
| `Xuất khác` | Có | Có | Được xuất hàng không `Đạt` (ví dụ loại bỏ). |
| `Điều chuyển kho` | Có | Không | Được chuyển hàng không `Đạt` (ví dụ sang kho lỗi). |
| `Điều chỉnh tồn` | Có | Có | Mỗi dòng chọn `Chiều` `Tăng tồn` hoặc `Giảm tồn`. |
| `Xuất bán hàng` | Không, từ CRM | Không | Chỉ lấy hàng `Đạt`; phải chọn đủ serial. |
| `Xuất bảo hành` | Không, từ CRM | Không | Hàng thay thế cho khách. |
| `Nhập trả hàng bán` | Không, từ CRM | Không | Nhập trả về kho cách ly. |
| `Nhập điều chuyển`, `Xuất điều chuyển` | Không | | Do chứng từ điều chuyển sinh ra. |

Trạng thái: `Nháp`, `Chờ duyệt`, `Đã duyệt`, `Từ chối`, `Đã ghi sổ`, `Đã huỷ`. Nguồn: `Đơn bán`, `Đợt giao hàng`, `Bảo hành`, `Trả hàng`, `Không có nguồn`.

Ngưỡng duyệt chỉ theo loại chứng từ, không theo giá trị.

### 4.2. Lập chứng từ

1. `Chứng từ kho` → `Lập chứng từ`. Hộp `Lập chứng từ kho` mở.
2. Chọn `Loại chứng từ` (mỗi loại có gợi ý `Phải duyệt trước khi ghi sổ` hoặc `Ghi sổ không cần duyệt`), `Kho` (hoặc `Kho đi` và `Kho đến` với điều chuyển), `Ngày chứng từ`, `Nguồn (loại chứng từ gốc)` (ví dụ đơn mua PO-001), `Ghi chú`.
3. Trong `Dòng chứng từ`, bấm `Thêm dòng` cho mỗi mặt hàng: `Mặt hàng`, `Số lượng`, `Đơn giá`, `Lô`, `Serial`, `Ghi chú`.
4. Bấm `Lưu nháp`, hoặc `Lưu và gửi duyệt` (loại cần duyệt), hoặc `Lưu và ghi sổ`.

| Trường dòng | Quy tắc |
|---|---|
| `Đơn giá` | Bỏ trống hoặc 0 là nhập theo giá bình quân hiện tại. Giá vốn tính khi ghi sổ. |
| `Lô` | Dòng nhập: nhập `Số lô`, `Hạn dùng` (có hạn dùng thì phải có số lô). Dòng xuất: bấm `Chọn lô (FEFO)`. |
| `Serial` | Số serial phải bằng số lượng; mặt hàng theo serial phải có số lượng nguyên. |
| Lô và serial | Một dòng chỉ ghi lô hoặc serial, không cả hai. |
| Dịch vụ | Mặt hàng loại dịch vụ không quản lý tồn, không vào chứng từ kho. |

### 4.3. Xử lý theo trạng thái

| Trạng thái | Người lập | Người duyệt |
|---|---|---|
| `Nháp` | `Sửa`, `Ghi sổ` hoặc `Gửi duyệt`, `Huỷ chứng từ` | |
| `Chờ duyệt` | `Huỷ chứng từ` | `Duyệt`, `Từ chối` |
| `Từ chối` | `Sửa` (về `Nháp`, xem `Lý do từ chối`) | |
| `Đã duyệt` | `Ghi sổ`, `Huỷ chứng từ` | |
| `Đã ghi sổ` | `Tạo chứng từ đảo` | |

- `Ghi sổ chứng từ?`: tồn kho thay đổi ngay; chứng từ đã ghi sổ không sửa được, sai thì tạo chứng từ đảo.
- `Tạo chứng từ đảo?`: hệ thống tạo chứng từ ngược chiều tham chiếu chứng từ này và ghi sổ ngay; chứng từ gốc giữ nguyên. Chứng từ đảo không đảo lại được.
- `Huỷ chứng từ?`: chứng từ chuyển `Đã huỷ` và không dùng lại được.

Số liệu đã ghi sổ không sửa, không xoá được (kể cả ở tầng DB). Mọi sai sót sửa bằng chứng từ đảo hoặc chứng từ điều chỉnh.

### 4.4. Mã chứng từ

Mã sinh tự động theo dạng `<tiền tố>-<dấu thời gian>-<6 ký tự>`: `PN` cho nhập, `PX` cho xuất, `PC` cho điều chuyển, `PDC` cho điều chỉnh. Mỗi dòng sổ kho có mã dạng `TXN-<dấu thời gian>-<8 ký tự>`. Mã không đánh số liên tục; tra cứu theo mã đầy đủ hoặc theo ngày.

## 5. Duyệt chứng từ

`Duyệt chứng từ` liệt kê `Chứng từ chờ duyệt`, lọc theo `Loại` và kho.

1. Mở chứng từ, kiểm tra dòng, số lượng, lô, serial, ghi chú.
2. Bấm `Duyệt`, hoặc `Từ chối` và nhập `Lý do từ chối (bắt buộc, người lập sẽ thấy để sửa lại)`.
3. Sau khi duyệt, người lập (hoặc người có quyền ghi) bấm `Ghi sổ`.

Quy tắc: người lập không tự duyệt chứng từ của mình (trừ khi tenant bật cho phép tự duyệt trong cài đặt Kho). Người không có quyền thấy dòng `Bạn chỉ xem được danh sách; duyệt hoặc từ chối cần quyền "Duyệt chứng từ kho".`

## 6. Lô và hạn dùng (FEFO)

### 6.1. Chọn lô khi xuất

Trên dòng xuất, bấm `Chọn lô (FEFO)`. Hộp `Chọn lô ... tại ...` hiện `Số lô`, `Hạn dùng`, `Khả dụng`, `Lấy`.

- `Gợi ý FEFO`: chia số cần xuất theo hạn dùng gần nhất trước; lô không hạn dùng xếp sau cùng.
- Lô hết hạn, lô không ở trạng thái `Đạt`, lô hết hàng ở kho này không xuất được (hiện lý do `Hết hạn`, `Không ở trạng thái Đạt`, `Hết hàng ở kho này`).
- Lô dùng được đến hết ngày hạn dùng, theo giờ Việt Nam.
- `Không chọn lô` chỉ dùng cho phần tồn không theo lô; mặt hàng quản lý theo lô thì hệ thống yêu cầu chọn lô khi phần không theo lô không đủ.
- Bấm `Áp dụng`.

### 6.2. Xem lô của mặt hàng

`Kho & Danh mục` → mở mặt hàng → tab `2. Quản lý theo Lô`: `Số lô`, `Hạn dùng`, `Ngày sản xuất`, `Chất lượng`, `Tồn theo kho`, `Nhà cung cấp, CO/CQ`.

Thay đổi so với trước: lô được lưu trên server, không còn lưu trong trình duyệt. Lô đã khai trên trình duyệt trước đây **không được chuyển**; khai lại lô thật bằng chứng từ nhập hoặc điều chỉnh.

## 7. Serial

- Dòng nhập: nhập serial mới; serial mới được tạo khi ghi sổ. Serial đã có của mặt hàng bị từ chối.
- Dòng xuất: hộp chọn serial cho phép `Quét hoặc gõ serial rồi nhấn Enter` (nhiều serial cách nhau bằng dấu phẩy hoặc xuống dòng), hoặc chọn trong danh sách `Serial sẵn có ở kho ... (Trong kho, Đạt)`. Bấm `Áp dụng` khi `Đã chọn` đủ số lượng.
- Serial bị từ chối khi `đã chọn`, `không có trong kho hoặc không ở trạng thái Đạt`, hoặc `vượt số lượng của dòng`.
- Một serial không được lặp ở hai dòng của cùng chứng từ.
- `Xuất bán hàng`, `Xuất bảo hành`, `Nhập trả hàng bán` phải chọn đủ serial trước khi ghi sổ.

Serial là duy nhất theo mặt hàng, không phân biệt chữ hoa thường và khoảng trắng đầu cuối (`sn001` và ` SN001 ` là cùng một serial).

## 8. Trạng thái chất lượng

| Trạng thái | Ý nghĩa |
|---|---|
| `Đạt` | Bán, xuất bình thường. |
| `Cách ly` | Tạm giữ, không tính khả dụng. |
| `Lỗi` | Hàng hỏng. |
| `Chờ kiểm định` | Hàng nhận về chờ kiểm (ví dụ hàng bảo hành). |

Đổi chất lượng lô: tab `2. Quản lý theo Lô` → `Đổi chất lượng`. Hộp `Đổi trạng thái chất lượng lô ...`: chọn `Trạng thái mới`, nhập `Lý do` (bắt buộc), bấm `Lưu trạng thái`. Toàn bộ tồn của lô ở mọi kho không tính vào tồn khả dụng cho đến khi lô về `Đạt`.

Chất lượng của serial hàng bảo hành thay đổi qua chứng từ do yêu cầu bảo hành sinh ra (xem [bao-hanh.md](./bao-hanh.md)); đợt này chưa có màn đổi chất lượng từng serial bằng tay.

## 9. Yêu cầu xuất từ đơn bán

Khi nhân viên kinh doanh bấm `Yêu cầu xuất kho` trên một đợt giao, Kho nhận một chứng từ xuất nháp.

1. Mở `Yêu cầu xuất từ đơn bán`. Lọc `Loại` (`Xuất bán và xuất bảo hành`), `Nguồn`, kho.
2. Chọn một yêu cầu ở danh sách bên trái. Phần chi tiết hiện `Mặt hàng`, `Xuất`, `Giữ hàng / còn chưa xuất` (ví dụ `Giữ 10, đã xuất 4, còn 6`), `Lô` và `Hết hạn giữ ...`.
3. Chọn lô (FEFO), serial cho từng dòng. Bấm `Lưu lựa chọn` nếu chưa xuất ngay.
4. Bấm `Ghi sổ`. Hộp `Ghi sổ xuất kho?`: tồn và phần đã giữ giảm ngay; CRM nhận số đã giao, serial và giá vốn.
5. Không xuất được: `Huỷ chứng từ` (`Huỷ yêu cầu xuất?`): chứng từ chuyển `Đã huỷ`; giữ hàng của đơn vẫn còn đến khi CRM nhả.

Quy tắc giữ hàng:

| Quy tắc | Chi tiết |
|---|---|
| Giữ tất cả hoặc không | CRM xác nhận đơn: một dòng thiếu khả dụng thì không giữ dòng nào (`Không đủ tồn khả dụng để giữ hàng: ...`). |
| Hạn giữ | Mỗi lần giữ có hạn. Hết hạn mà chưa xuất, hệ thống tự chuyển `Hết hạn` và trả phần chưa xuất về khả dụng; CRM báo người phụ trách. |
| Không xuất quá phần giữ | Dòng xuất không vượt số còn đang giữ (`giữ hàng ... chỉ còn ... chưa xuất`). |
| Giao từng phần | Một đơn có nhiều đợt giao, mỗi đợt một chứng từ xuất; trạng thái giữ hàng `Đã xuất một phần` cho tới khi xuất hết. |
| Xuất từ kho khác | Đợt giao chọn kho khác kho giữ hàng thì xuất từ tồn khả dụng của kho đó. |

Trạng thái giữ hàng: `Chờ xử lý`, `Đang giữ`, `Đã xuất một phần`, `Hoàn tất`, `Đã huỷ`, `Hết hạn`.

## 10. Giá vốn bình quân

Giá vốn tính khi ghi sổ theo bình quân gia quyền di động từng kho: nhập làm thay đổi giá bình quân; xuất lấy giá bình quân hiện tại; nhập đơn giá 0 giữ nguyên bình quân; chứng từ đảo lấy giá của dòng gốc. CRM dùng giá bình quân làm giá vốn ước tính khi báo giá và lấy giá vốn thực tế từ chứng từ xuất đã ghi sổ.

## 11. Báo cáo kho

`Báo cáo kho` cần `inventory.read`. Mỗi tab có `Xuất Excel`, `Tải lại`.

| Tab | Bộ lọc, cột chính |
|---|---|
| `Tồn theo kho` | `Tìm`, `Nhóm vật tư`, `Chất lượng`, `Hiện dòng tồn bằng 0`; `Tồn thực tế`, `Đã giữ`, `Chờ kiểm định / không đạt`, `Khả dụng`, `Giá bình quân`, `Giá trị tồn` |
| `Tồn theo lô` | Thêm `Hạn dùng` (`Đã hết hạn`, `Hết hạn trong 30/60/90/180 ngày`); hiện `Còn N ngày` hoặc `Đã hết hạn N ngày` |
| `Tồn theo serial` | Thêm `Trạng thái kho` (`Trong kho`, `Đã xuất`, `Đang vận chuyển`, `Đã huỷ`) |
| `Nhập xuất` | `Từ ngày`, `Đến ngày`, `Nhóm`, `Loại chứng từ`; phần `Tổng theo nhóm`, `Theo loại chứng từ và kho`, `Bút toán chi tiết`; cột `SL nhập`, `SL xuất`, `Giá trị nhập`, `Giá trị xuất`, `Số bút toán` |
| `Lịch sử duyệt` | `Chứng từ`, `Trạng thái`, `Lý do`, `Lập`, `Duyệt hoặc từ chối`, `Ghi sổ`, `SL tăng`, `SL giảm`, `Giá trị` |
