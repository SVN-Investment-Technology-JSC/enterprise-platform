# HƯỚNG DẪN SỬ DỤNG — BÁN HÀNG: KẾ TOÁN CÔNG NỢ

> Phạm vi: trang `Công nợ` của CRM (tuổi nợ, sổ công nợ khách, lần thu tiền, phân bổ, điều chỉnh) và bước ghi sổ phiếu thu bên Tài chính. Quyền cần có: `crm.read`, `crm.read.all`, `crm.receivable.write` để thu tiền, lập điều chỉnh; `finance.read`, `finance.receipt.create`; người ghi sổ phiếu thu bên Tài chính cần `finance.receipt.approve`.

## 1. Nguyên tắc sổ công nợ

| Nguyên tắc | Chi tiết |
|---|---|
| Chỉ ghi thêm | Sổ công nợ không có thao tác sửa hay xoá dòng, kể cả ở tầng DB. Sai thì lập điều chỉnh hoặc để bút đảo tự sinh. |
| Ghi nợ khi giao | Mặc định, khoản nợ phát sinh khi chứng từ xuất giao hàng được Kho ghi sổ; hạn thanh toán = ngày giao + thời hạn thanh toán của khách. |
| Ghi nợ theo đợt | Đơn từ hợp đồng có đợt thanh toán thì ghi nợ theo đợt của hợp đồng (khi ký, khi giao, khi nghiệm thu, theo ngày). |
| Đảo chứng từ xuất | Kho đảo chứng từ xuất thì sổ có dòng `Bút đảo` tương ứng. |
| Tiền thu qua Tài chính | Mỗi lần thu sinh phiếu thu nháp bên Tài chính; phân bổ chỉ có hiệu lực khi phiếu được ghi sổ. |

Loại dòng sổ: `Phát sinh nợ`, `Thu tiền`, `Điều chỉnh`, `Bút đảo`. Số tiền dòng là ảnh hưởng có dấu lên dư nợ: dương tăng nợ, âm giảm nợ.

## 2. Trang Công nợ

| Tab | Nội dung |
|---|---|
| `Tuổi nợ theo khách` | Mỗi khách một dòng: `Dư nợ`, `Hạn mức`, các nhóm `Chưa đến hạn`, `0–30 ngày`, `31–60 ngày`, `61–90 ngày`, `Trên 90 ngày`. Lọc theo người phụ trách, tìm theo mã, tên khách, chỉ khách có khoản quá hạn. Bấm `Mở` để vào sổ của khách. |
| `Lần thu tiền` | Mọi lần thu: `Mã`, `Khách hàng`, `Ngày thu`, `Số tiền`, `Hình thức`, `Phiếu Tài chính`, `Người thu`, `Trạng thái`. |
| `Điều chỉnh công nợ` | Mọi điều chỉnh: `Người lập`, `Người duyệt`, `Lý do`, `Trạng thái`; nút `Duyệt`, `Huỷ`. |
| `Cấu hình` | Chỉ quản trị bán hàng thấy (xem [quan-tri-ban-hang.md](./quan-tri-ban-hang.md), mục 7). |

Nhóm tuổi nợ tính theo số ngày quá hạn: `0–30 ngày` gồm cả khoản đến hạn đúng hôm nay.

## 3. Sổ công nợ của khách

Gồm các phần:

- `Tổng hợp công nợ`: dư nợ, hạn mức (`Không giới hạn` nếu chưa đặt), thời hạn thanh toán, tiền trả trước chưa phân bổ.
- `Khoản nợ còn mở`: `Khoản nợ`, `Hạn`, `Còn nợ`, `Đang chờ ghi sổ` (phần đang được lần thu chưa ghi sổ giữ chỗ), `Còn phân bổ được`, `Tuổi nợ`.
- `Sổ công nợ`: `Ngày`, `Loại`, `Diễn giải`, `Chứng từ`, `Phát sinh`, `Hiệu lực`. Bấm mã đơn để mở đơn bán.
- `Lần thu tiền của khách`.

Nút `Ghi nhận thu tiền` và `Điều chỉnh công nợ` ở đầu trang.

## 4. Ghi nhận thu tiền

1. Mở sổ của khách, bấm `Ghi nhận thu tiền`. Hộp ghi: `Phân bổ có hiệu lực khi kế toán ghi sổ phiếu thu bên Tài chính.`
2. Nhập `Số tiền thu` `*`, `Hình thức` (`Tiền mặt` hoặc `Chuyển khoản`), `Ngày thu` (bỏ trống là hôm nay), `Ghi chú`.
3. Phân bổ vào khoản nợ: nhập số ở từng dòng khoản nợ, hoặc bấm `Phân bổ theo hạn sớm trước`. Tối đa 100 dòng phân bổ.
4. Bấm `Ghi nhận`.

Quy tắc phân bổ:

- Tổng phân bổ không vượt số tiền thu; mỗi khoản không vượt số còn phân bổ được.
- Phần chưa phân bổ là tiền trả trước (`chưa phân bổ ... (trả trước)`). Không còn khoản nợ nào thì toàn bộ số thu là trả trước.
- Hai người thu cùng lúc cho cùng khoản nợ: hệ thống khoá dòng, người sau nhận lỗi nếu vượt số còn nợ.

Kết quả: lần thu ở trạng thái `Chờ tạo phiếu`, rồi `Chờ kế toán ghi sổ` khi Tài chính đã có phiếu thu nháp (thông báo `Đã ghi nhận lần thu ...; Tài chính đã có phiếu thu nháp ...`).

## 5. Ghi sổ phiếu thu bên Tài chính

Người có `finance.receipt.approve` mở phiếu thu nháp trên phân hệ Tài chính (phiếu có nguồn từ CRM):

| Nút | Kết quả |
|---|---|
| `Nhập thông tin kế toán` | Bổ sung tài khoản quỹ, ngân hàng và thông tin hạch toán. |
| `Ghi sổ` | Hộp `Ghi sổ phiếu này?`: tiền ghi vào sổ tài khoản, phiếu nhận mã chính thức. Lần thu bên CRM sang `Đã ghi sổ`, phân bổ có hiệu lực, dư nợ giảm. |
| `Trả hồ sơ` | Bắt buộc `Lý do trả hồ sơ`. Lần thu bên CRM sang `Bị trả lại, cần sửa`. |

Người lập phiếu không được tự ghi sổ phiếu do mình lập, trừ khi cài đặt Tài chính cho phép tự duyệt.

## 6. Trạng thái lần thu và xử lý

| Trạng thái | Ý nghĩa | Thao tác |
|---|---|---|
| `Chờ tạo phiếu` | CRM chưa tạo được phiếu bên Tài chính; hệ thống tự thử lại | Chờ; báo quản trị nếu kéo dài |
| `Chờ kế toán ghi sổ` | Phiếu thu nháp đã có | Kế toán ghi sổ bên Tài chính |
| `Bị trả lại, cần sửa` | Tài chính trả lại | `Sửa và gửi lại` (sửa số tiền, phân bổ), rồi phiếu cũ được mở lại bên Tài chính |
| `Đã ghi sổ` | Có hiệu lực | |
| `Phiếu đã bị đảo` | Tài chính đảo phiếu đã ghi sổ | Sổ có bút đảo; ghi nhận lại lần thu đúng nếu cần |
| `Đã huỷ` | `Huỷ lần thu` (bắt buộc `Lý do huỷ`) trước khi ghi sổ | |

## 7. Điều chỉnh công nợ

Dùng cho giảm trừ do trả hàng, chiết khấu thanh toán, xoá nợ nhỏ, hoặc tăng nợ.

1. Trong sổ của khách, bấm `Điều chỉnh công nợ`.
2. Chọn `Loại điều chỉnh` (`Giảm trừ công nợ` hoặc `Tăng công nợ`), nhập `Số tiền` `*`, chọn `Khoản nợ` (bỏ trống: trừ vào các khoản theo hạn sớm trước), nhập `Lý do` `*`.
3. Bấm `Lập điều chỉnh`. Điều chỉnh ở `Chờ duyệt`.
4. Quản lý bán hàng (thấy toàn bộ dữ liệu) duyệt ở tab `Điều chỉnh công nợ`. Người lập không tự duyệt. Người lập hoặc quản lý có thể `Huỷ điều chỉnh` kèm lý do.

Chỉ khi được duyệt, sổ công nợ mới có dòng `Điều chỉnh`. Điều chỉnh do bảo hành (hoàn tiền, giảm trừ) cũng đi qua bước duyệt này.

## 8. Hạn mức công nợ

- Hạn mức đặt trên hồ sơ khách (`Hạn mức tín dụng (đồng)`); bỏ trống là không giới hạn.
- Khi xác nhận đơn, nếu dư nợ theo sổ cộng giá trị đơn vượt hạn mức: đơn sang `Chờ duyệt hạn mức` hoặc bị chặn, tuỳ cấu hình.
- Cảnh báo quá hạn và vượt hạn mức gửi người phụ trách khách, người phụ trách đơn và những người quản trị thêm vào danh sách nhận cảnh báo.

## 9. Báo cáo

Người có `crm.report.read` xem tab `Công nợ phải thu` trong `Báo cáo` và `Xuất Excel` (sheet `Công nợ theo khách`, `Đơn quá hạn`). Xem [truong-nhom-quan-ly.md](./truong-nhom-quan-ly.md), mục 5.

## 10. Hạn chế hiện tại

- Chưa có nút trên giao diện để phân bổ tiền trả trước vào khoản nợ phát sinh sau; chức năng có ở API, cần quản trị hỗ trợ.
- Ngày giao (mốc tính hạn nợ) là thời điểm Kho ghi sổ chứng từ xuất, không phải ngày chứng từ.
