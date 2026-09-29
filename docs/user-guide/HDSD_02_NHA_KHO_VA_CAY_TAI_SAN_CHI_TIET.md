# HƯỚNG DẪN SỬ DỤNG — 02. NHÀ KHO & CÂY TÀI SẢN

> Phạm vi: Cây thiết bị, danh mục vật tư, giao dịch kho, yêu cầu cấp phát và kiểm kê (ảnh 08–41). Người dùng cần có quyền Inventory phù hợp; giao dịch nhập/xuất/điều chuyển tác động đến tồn kho và phải được kiểm tra trước khi xác nhận.

## 1. Mục tiêu và quy ước vận hành

Module Nhà kho quản lý đồng thời vật tư trong kho và thiết bị/tài sản ngoài hiện trường. Thiết bị có thể được tổ chức theo cây; vật tư có thể lắp vào, tháo khỏi thiết bị hoặc giao dịch qua phiếu kho.

| Quy ước | Ý nghĩa |
|---|---|
| `*` | Trường bắt buộc. |
| Hộp chọn có tìm kiếm | Gõ mã hoặc tên, dùng `↑`/`↓` và `Enter` để chọn. |
| Checkbox trong bảng | Chọn nhiều dòng để xử lý hàng loạt. |
| Biểu tượng `+` / `-` trên node | Mở rộng/thu gọn nhánh; trong ngữ cảnh thao tác có thể mở lắp/tháo. Đọc nhãn/hộp thoại trước khi xác nhận. |
| `Kho tiếp nhận` | Kho nhận vật tư/thiết bị được tháo về. |
| `Kho xuất` | Kho giảm tồn khi vật tư được lắp hoặc xuất. |

### Trình tự khuyến nghị

1. Chuẩn hóa kho, vị trí kệ, SKU và đơn vị tính.
2. Tạo cây tài sản/thiết bị theo vị trí thực tế.
3. Khai báo tài liệu, thông số, BOM và kế hoạch bảo trì cho thiết bị quan trọng.
4. Xử lý cấp phát, nhập/xuất/điều chuyển theo chứng từ.
5. Đối chiếu tồn và thực hiện kiểm kê định kỳ.

## 2. Cây thiết bị vận hành

![Cây thiết bị vận hành](./images/screen_09.png)

### 2.1. Thành phần chính

| Thành phần | Loại UI | Cách dùng | Kết quả |
|---|---|---|---|
| `Dạng bảng` | Button | Chuyển từ cây sang danh sách | Dễ lọc, chọn nhiều và thao tác hàng loạt. |
| `Thu` | Button | Thu gọn toàn bộ nhánh đang mở | Giảm độ rối của cây. |
| `+ Gốc` | Button | Tạo thiết bị/node cấp cao nhất | Mở form tạo node gốc. |
| Tìm theo mã hoặc tên thiết bị | Input tìm kiếm | Nhập mã/tên thiết bị | Định vị nhanh node phù hợp. |
| Biểu tượng mở/thu nhánh | Icon button | Nhấp trên một nhánh | Hiện hoặc ẩn node con. |
| Tên node | Link/row action | Nhấp thiết bị cần xem | Mở hồ sơ chi tiết thiết bị. |

### 2.2. Tìm thiết bị và duy trì cây

1. Nhập mã hoặc tên thiết bị vào ô tìm kiếm.
2. Mở các nhánh liên quan bằng biểu tượng mở rộng; nhấn `Thu` để quay về trạng thái gọn.
3. Dùng `+ Gốc` để tạo tài sản đầu cấp, sau đó tạo node con theo cấu trúc thực tế.
4. Nhấp tên node để cập nhật hồ sơ thay vì tạo lại dữ liệu trùng lặp.

> Mã thiết bị nên ổn định, duy nhất và nhất quán với tem QR, chứng từ kho và hồ sơ bảo trì.

## 3. Thiết bị dạng bảng và xử lý hàng loạt

![Danh sách thiết bị dạng bảng](./images/screen_13.png)

### 3.1. Chọn và gỡ nhiều thiết bị

| Thành phần | Loại UI | Hướng dẫn |
|---|---|---|
| Checkbox từng dòng | Checkbox | Chọn các thiết bị cần gỡ. |
| Checkbox đầu bảng | Checkbox | Chọn tất cả thiết bị trong phạm vi danh sách hiện tại. |
| `Gỡ X thiết bị đã chọn` | Button cảnh báo | Chỉ dùng sau khi đã rà soát số lượng và đối tượng được chọn. |
| Form tháo dỡ hàng loạt | Popup form | Khai báo kho nhận và ghi chú cho giao dịch gỡ. |

### 3.2. Quy trình gỡ hàng loạt

1. Chuyển sang `Dạng bảng` và lọc danh sách nếu cần.
2. Chọn checkbox của từng thiết bị hoặc checkbox đầu bảng.
3. Kiểm tra nhãn `Gỡ X thiết bị đã chọn` để xác nhận đúng số lượng.
4. Nhấn nút gỡ; trong popup, chọn **Áp dụng kho chung** nếu tất cả cùng trả về một kho.
5. Chọn **Kho tiếp nhận** cho từng dòng còn lại, nhập ghi chú tháo dỡ.
6. Nhấn `Xác nhận tháo dỡ (X thiết bị)`.

| Trường trong popup | Loại | Bắt buộc | Mục đích |
|---|---|---:|---|
| Áp dụng kho chung cho tất cả các dòng | Hộp chọn | Không | Dùng một kho tiếp nhận cho nhiều thiết bị. |
| Kho tiếp nhận | Hộp chọn có tìm kiếm | Có | Kho nhận thiết bị/vật tư sau khi gỡ. |
| Ghi chú tháo dỡ | Textarea | Không | Ghi lý do, tình trạng hoặc số chứng từ. |
| `Xác nhận tháo dỡ` | Button | — | Ghi nhận thao tác và cập nhật trạng thái/tồn liên quan. |

## 4. Lắp vật tư và tháo dỡ đơn lẻ

![Lắp vật tư vào thiết bị](./images/screen_15.png)

### 4.1. Lắp vật tư vào thiết bị

1. Tại cây thiết bị, chọn đúng node đích và dùng thao tác lắp (`+`).
2. Trong popup **Lắp vật tư vào thiết bị**, tìm và chọn **Vật tư cần lắp**.
3. Chọn **Xuất từ kho**; kiểm tra số lượng khả dụng hệ thống hiển thị.
4. Nhập **Số lượng**, ghi chú lắp đặt nếu cần.
5. Nhấn `Xác nhận xuất kho & lắp`.

| Trường / nút | Loại UI | Bắt buộc | Hướng dẫn |
|---|---|---:|---|
| Vật tư cần lắp | Hộp chọn có tìm kiếm | Có | Tìm theo mã SKU hoặc tên vật tư. |
| Xuất từ kho | Hộp chọn có tìm kiếm | Có | Chọn kho có đủ số lượng khả dụng. |
| Số lượng | Number input | Có | Không vượt quá số lượng khả dụng. |
| Ghi chú lắp đặt | Textarea | Không | Ghi vị trí, tình trạng hoặc yêu cầu kỹ thuật. |
| `Xác nhận xuất kho & lắp` | Button | — | Xuất vật tư khỏi kho và liên kết với thiết bị. |

### 4.2. Tháo dỡ đơn lẻ và liên kết Work Order

![Tháo dỡ và liên kết Work Order](./images/screen_16.png)

1. Chọn thiết bị/vật tư cần tháo và dùng thao tác tháo (`-`).
2. Chọn **Kho tiếp nhận**.
3. Nếu công việc tháo dỡ cần được theo dõi, chọn **Quy trình liên kết mở Work Order**; trường này không bắt buộc.
4. Nhập ghi chú cần thiết, rồi nhấn `Xác nhận nhập về kho`.

| Trường | Loại UI | Ý nghĩa |
|---|---|---|
| Kho tiếp nhận | Hộp chọn có tìm kiếm | Kho nhận lại vật tư/thiết bị đã tháo. |
| Quy trình liên kết mở Work Order | Hộp chọn có tìm kiếm | Tự khởi tạo Work Order bên module Quy trình khi có nhu cầu theo dõi công việc. |
| Ghi chú | Textarea | Lý do tháo dỡ, tình trạng, thông tin hiện trường. |
| `Xác nhận nhập về kho` | Button | Hoàn tất nghiệp vụ tháo và nhập kho. |

### 4.3. Điều chuyển node trên cây

![Kéo thả điều chuyển node](./images/screen_17.png)

Kéo node cần điều chuyển đến node cha mới theo cấu trúc thực tế. Trước khi thả, kiểm tra node đích có đúng vị trí/quản lý trực tiếp không. Sau khi hệ thống xác nhận, mở lại cây để bảo đảm quan hệ cha–con đã cập nhật đúng.

## 5. Hồ sơ chi tiết thiết bị

![Chi tiết thiết bị](./images/screen_19.png)

### 5.1. Thao tác cơ bản

| Thành phần | Loại UI | Hướng dẫn |
|---|---|---|
| `Chỉnh sửa` | Button | Cập nhật tên, trạng thái, độ quan trọng và dữ liệu cơ bản. |
| `+ Thêm thiết bị con` | Button | Tạo tài sản phụ thuộc dưới thiết bị đang mở. |
| `In mã QR` | Button | Mở xem trước tem nhãn; chọn in khi đúng thiết bị và kích cỡ tem. |
| Tab `Tổng quan tham số` | Tab | Khai báo thông số kỹ thuật. |
| Tab `Tài liệu` | Tab | Đính kèm hồ sơ kỹ thuật/chứng từ. |
| Tab `Lịch sử vận hành – sự cố` | Tab | Xem và ghi nhận sự cố. |
| Tab `Phụ tùng (BOM)` | Tab | Khai báo phụ tùng cấu thành. |
| Tab `Kế hoạch bảo trì` | Tab | Xây dựng đầu việc và chu kỳ bảo trì. |

### 5.2. QR, thông số và tài liệu

![In QR và tham số thiết bị](./images/screen_22.png)

- Dùng `In mã QR` để mở bản xem trước tem chuẩn 50×30 mm; chỉ chọn `In ra máy in tem` sau khi đối chiếu tên/mã tài sản.
- Trong **Tổng quan tham số**, dùng `Chỉnh sửa` hoặc `+ Thêm thông số mới`; nhập tên thông số, giá trị và đơn vị theo tài liệu kỹ thuật.
- Trong **Tài liệu**, nhấn `Choose File` để tải bản vẽ, hướng dẫn vận hành, biên bản hoặc ảnh thiết bị.

| Nội dung | Kiểm tra trước khi lưu |
|---|---|
| Thông số kỹ thuật | Đơn vị đo, giá trị và tên thông số không bị trùng/nhầm thiết bị. |
| Tệp đính kèm | Tệp đúng phiên bản, tên tệp dễ tra cứu, không chứa dữ liệu không được phép chia sẻ. |
| Tem QR | Mã và tên trên tem thuộc đúng thiết bị đang xem. |

### 5.3. Ghi nhận sự cố

![Ghi nhận sự cố](./images/screen_24.png)

1. Mở tab **Lịch sử vận hành – sự cố** và nhấn `+ Ghi nhận sự cố`.
2. Chọn mức ưu tiên: `P4 - Thấp`, `P3 - Trung bình`, `P2 - Cao` hoặc `P1 - Khẩn cấp`.
3. Chọn **Phân loại sự cố**, nhập **Tiêu đề** và **Mô tả chi tiết**.
4. Tích **Đồng bộ sang Module Bảo trì (CMMS)** khi sự cố cần được xử lý/bám theo hoạt động bảo trì.
5. Lưu và kiểm tra sự cố xuất hiện trong lịch sử thiết bị.

### 5.4. BOM và kế hoạch bảo trì

| Khu vực | Thao tác | Kết quả |
|---|---|---|
| `Phụ tùng (BOM)` | Khai báo phụ tùng, đánh dấu **Trọng yếu**, nhấn `Lưu phụ tùng (BOM)` | Có danh mục phụ tùng phục vụ bảo trì/thay thế. |
| `Kế hoạch bảo trì` | Thêm các đầu việc T1, T2…, tần suất và thời lượng phút | Cung cấp dữ liệu nguồn cho module Bảo trì. |

## 6. Yêu cầu cấp phát vật tư từ Quy trình

![Xử lý yêu cầu cấp phát](./images/screen_33.png)

Khi Quy trình tạo nhu cầu vật tư, khu vực **Nhu cầu cấp phát vật tư từ Quy trình** hiển thị danh sách phiếu/yêu cầu cần xử lý.

| Thành phần | Loại UI | Hướng dẫn |
|---|---|---|
| `Xem chi tiết` | Button | Mở danh mục vật tư và bối cảnh phiếu. |
| `Tải bảng kê CSV` | Button | Tải danh sách để đối chiếu hoặc chia sẻ nội bộ. |
| `Kiểm tra tồn kho` | Button | Kiểm tra lượng đáp ứng trước khi quyết định xử lý. |
| `Xử lý phiếu yêu cầu (X vật tư)` | Button | Bắt đầu xử lý các dòng đã chọn/đủ điều kiện. |
| `Soi kho` | Button dòng | Xem tồn theo kho/vị trí. |
| `Xuất kho món này` | Button dòng | Xuất riêng một vật tư. |
| `Chuyển kho` | Button dòng | Điều chuyển để đáp ứng nhu cầu. |
| `Tách kho xuất` | Button dòng | Phân bổ một dòng từ nhiều kho xuất. |
| `Đề xuất mua sắm` | Button dòng | Ghi nhận phương án khi tồn không đáp ứng. |

### Quy trình xử lý cấp phát

1. Nhấn `Xem chi tiết` để xác định hồ sơ/quy trình và vật tư yêu cầu.
2. Nhấn `Kiểm tra tồn kho`; dùng `Soi kho` khi cần biết vị trí cụ thể.
3. Chọn cách đáp ứng: xuất một kho, tách nhiều kho, điều chuyển hoặc đề xuất mua sắm.
4. Tải CSV nếu cần đối chiếu độc lập trước khi chốt.
5. Nhấn `Xử lý phiếu yêu cầu` sau khi rà soát số lượng và kho xuất.

## 7. Nhập kho, xuất kho và điều chuyển

![Popup nhập/xuất/điều chuyển](./images/screen_36.png)

### 7.1. Khởi tạo giao dịch

1. Nhấn `+ Xuất/nhập kho`.
2. Chọn tab **Nhập kho**, **Xuất kho** hoặc **Điều chuyển kho**.
3. Chọn kho phù hợp, nhập số hóa đơn/lệnh và đính kèm chứng từ khi có.
4. Kiểm tra vật tư, số lượng và kho nguồn/đích trước khi xác nhận.

| Tab | Kho cần chọn | Mục đích |
|---|---|---|
| Nhập kho | Kho nhập | Tăng tồn kho từ nhà cung cấp, hoàn trả hoặc nguồn hợp lệ khác. |
| Xuất kho | Kho xuất | Giảm tồn khi cấp phát, sử dụng, bán hoặc phục vụ nghiệp vụ được phê duyệt. |
| Điều chuyển kho | Kho nguồn và kho đích | Chuyển tồn nội bộ giữa các kho/vị trí. |

| Trường thường dùng | Loại UI | Lưu ý |
|---|---|---|
| Kho xuất/nhập/nguồn/đích | Hộp chọn có tìm kiếm | Chọn đúng hướng giao dịch. |
| Số hóa đơn/lệnh | Input | Dùng số chứng từ có thể đối chiếu. |
| Chứng từ | Upload | Đính kèm file liên quan theo quy định nội bộ. |
| Danh sách vật tư | Bảng dòng | Kiểm tra SKU, đơn vị tính, số lượng trước khi lưu. |

> Không dùng điều chuyển để sửa sai số tồn. Khi có chênh lệch thực tế, thực hiện quy trình kiểm kê/điều chỉnh theo quy định của doanh nghiệp.

## 8. Danh mục vật tư, vị trí kho và kiểm kê

![Thêm vật tư](./images/screen_38.png)

### 8.1. Tạo vật tư mới

1. Nhấn `+ Thêm vật tư`.
2. Nhập **Mã SKU** và **Tên vật tư**; hai thông tin phải dễ tìm và không trùng.
3. Chọn **Đơn vị tính**, nhập mức tồn **Min/Max stock** nếu doanh nghiệp quản lý định mức.
4. Chọn phương thức định danh: **Theo Sê-ri (SN)**, **Theo Lô (Lot/Batch)** hoặc **Thông thường**.
5. Lưu, sau đó kiểm tra vật tư mới trong danh mục.

| Trường | Loại | Bắt buộc | Hướng dẫn |
|---|---|---:|---|
| Mã SKU | Input | Có | Mã vật tư duy nhất, dùng nhất quán trên chứng từ. |
| Tên vật tư | Input | Có | Tên mô tả rõ loại/quy cách chính. |
| Đơn vị tính | Hộp chọn có tìm kiếm | Có | Đơn vị ghi nhận tồn và giao dịch. |
| Min/Max stock | Number input | Không | Ngưỡng tồn phục vụ theo dõi kế hoạch. |
| Phương thức quản lý định danh | Radio | Có | Chọn SN, Lot/Batch hoặc Thông thường theo đặc tính vật tư. |

### 8.2. Vị trí kệ và kiểm kê

![Kiểm kê và vị trí kho](./images/screen_41.png)

| Khu vực | Thao tác | Hướng dẫn |
|---|---|---|
| Tab `Vị trí & Kho` | `Đổi vị trí kệ` | Cập nhật bin location khi vật tư được đặt sang kệ/vị trí khác. |
| Tab `Kiểm kê` | Nhập số đếm và `Xác nhận số đếm` | Ghi nhận spot count tại chỗ theo quy trình kiểm kê. |

### Quy trình kiểm kê nhanh

1. Xác định đúng kho, vị trí kệ và vật tư cần đếm.
2. Mở tab **Kiểm kê**, nhập số lượng thực đếm.
3. Đối chiếu số đếm với tồn hệ thống và ghi chú chênh lệch theo quy định nội bộ.
4. Nhấn `Xác nhận số đếm` khi đã kiểm tra số liệu.

## 9. Kiểm tra nhanh và xử lý sự cố

| Vấn đề | Cách kiểm tra/xử lý |
|---|---|
| Không tìm được thiết bị | Rà soát mã/tên, mở rộng nhánh hoặc chuyển sang Dạng bảng. |
| Không đủ tồn để lắp/xuất | Kiểm tra kho khác, dùng điều chuyển/tách kho hoặc đề xuất mua sắm theo quy trình. |
| Không chọn được kho | Kiểm tra quyền Inventory và trạng thái kho. |
| Gỡ nhầm thiết bị | Dừng thao tác nếu chưa xác nhận; nếu đã xác nhận, thực hiện nghiệp vụ lắp lại có chứng từ/ghi chú. |
| Không thấy vật tư trong danh mục | Kiểm tra SKU, trạng thái vật tư và quyền xem kho. |
| Chênh lệch tồn | Không tự sửa bằng giao dịch tùy tiện; thực hiện kiểm kê và quy trình điều chỉnh được phê duyệt. |

## 10. Checklist bàn giao vận hành

- [ ] Kho, vị trí kệ và đơn vị tính đã được chuẩn hóa.
- [ ] Vật tư có SKU, tên và phương thức quản lý định danh phù hợp.
- [ ] Cây tài sản phản ánh đúng quan hệ lắp đặt thực tế.
- [ ] Thiết bị quan trọng có QR, thông số, tài liệu và BOM khi cần.
- [ ] Người thực hiện giao dịch kho hiểu rõ kho nguồn, kho đích và chứng từ.
- [ ] Quy trình kiểm kê và xử lý chênh lệch đã được thống nhất.
