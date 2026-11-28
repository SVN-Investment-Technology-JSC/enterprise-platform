# Đánh giá rủi ro các trường phân loại của vật tư (bản nháp)

Trạng thái: nháp, ngày 23/11/2026. Mức độ là đánh giá của người lập dựa trên code, migration và dữ liệu một tenant dev.
Chưa chạy thử từng kịch bản. Tìm kiếm văn bản có loại trừ HRM và workspace; chưa đọc hết CRM.

Bốn trường phân loại cùng nằm trên bảng `inventory_schema.materials`: `kind`, `category`, `trade_category`, `trade_mode`.
Ngoài ra thiết bị (`ASSET`) có `asset_category` riêng, không xét ở đây.

## 1. Tóm tắt

| Trường | Ý nghĩa | Do ai định nghĩa | Ràng buộc DB | Rủi ro chính | Mức |
|---|---|---|---|---|---|
| `kind` | Có tồn kho hay không (STOCK, SERVICE; ASSET riêng) | Code cố định | Có (`CHECK`, trigger) | Chi phí mở rộng: danh sách khai báo ở nhiều nơi | Trung bình |
| `category` | Nhóm kỹ thuật (Phụ tùng, Vật tư tiêu hao, Dụng cụ, Vật tư luân chuyển) | Code cố định | Có (`CHECK`) | Một trường mang hai nghĩa; CRM dùng làm tiêu chí giá; form gán cứng giá trị | Cao |
| `trade_category` | Phân loại thương mại | Tenant, ở Cài đặt | Không | Lưu bằng chữ, không khoá ngoại; chặn xoá chỉ ở giao diện | Cao |
| `trade_mode` | Cách sử dụng (Chỉ bán, Chỉ tặng...) | Tenant, ở Cài đặt | Không | Hai hệ mã song song; chưa thấy tác dụng nghiệp vụ | Trung bình |

Thứ tự ưu tiên xử lý: `category` trước, rồi ràng buộc ở server cho `trade_category` và `trade_mode`, sau đó gom danh sách
`kind`, cuối cùng dọn mã cũ của `trade_mode`.

## 2. `kind` (STOCK, SERVICE, ASSET)

Giá trị: `STOCK` (hàng hoá, mặc định), `SERVICE` (dịch vụ, không nhập, xuất, giữ hàng), `ASSET` (thiết bị, đi đường riêng).

| # | Rủi ro | Mức |
|---|---|---|
| 1 | Thêm loại mới phải sửa 4 nơi khai báo (`MATERIAL_KINDS`, `CATALOG_MATERIAL_KINDS` của CRM, `CATALOG_SYNC_KINDS`, kiểu `InventoryItem`) cộng ràng buộc DB và trigger. Sót một nơi thì loại mới bị lọc mất âm thầm | Cao |
| 2 | Hành vi gắn với chuỗi `'SERVICE'` rải khắp CRM (hơn chục chỗ so sánh trực tiếp và SQL `material_kind <> 'SERVICE'`). Loại mới hành xử như dịch vụ sẽ không được nhận ra | Cao |
| 3 | Hai định nghĩa kiểu mâu thuẫn: `MaterialKind` không có `ASSET`, `InventoryItem.kind` không có `SERVICE`, nhưng DB cho cả ba | Trung bình |
| 4 | CRM chụp `material_kind` vào từng dòng báo giá, hợp đồng, đơn bán và không cập nhật lại; mặc định `'STOCK'` khi thiếu che lỗi dữ liệu | Trung bình |
| 5 | Chặn đổi `kind` khi đã có dấu vết nằm ở tầng ứng dụng; trigger DB chỉ chặn ghi tồn cho `SERVICE` | Thấp |
| 6 | Lỗi từ trigger và `CHECK` ở DB có thông báo khó hiểu với người dùng | Thấp |

Nhận xét: trường ổn định, có ràng buộc DB; rủi ro chính là chi phí mở rộng, không phải sai dữ liệu.

## 3. `category` (Nhóm kỹ thuật)

Giá trị cố định: `SPARE_PART` (Phụ tùng), `CONSUMABLE` (Vật tư tiêu hao), `TOOL` (Dụng cụ), `ROTABLE` (Vật tư luân chuyển).

| # | Rủi ro | Mức |
|---|---|---|
| 1 | Một trường hai mục đích: gợi ý cách theo dõi lúc tạo, và là "Nhóm hàng" trong chính sách chiết khấu CRM. Đổi nhãn nghiệp vụ ảnh hưởng luật giá | Cao |
| 2 | Luật chiết khấu CRM so khớp chữ với `material.category`; chỉ có 4 giá trị nên luật "nhóm hàng" chỉ phân biệt 4 nhóm. Tenant dev cũ có 548 trong 613 hàng cùng nhóm Vật tư tiêu hao | Cao |
| 3 | Form hàng hoá thương mại (tab Hàng hóa) gán cứng `category: 'CONSUMABLE'`, nên mọi hàng tạo từ đó mang nhóm này dù thực tế khác, và gợi ý theo dõi suy ra từ nhóm sai | Cao |
| 4 | `CHECK` ở DB và hợp đồng nhập Excel bắt đúng 4 giá trị; thêm nhóm phải sửa DB, hợp đồng nhập, form và CRM | Trung bình |
| 5 | CRM chụp `category` vào dòng báo giá, đơn; báo cáo bán hàng có chiều này; đổi cách phân loại làm số liệu cũ và mới không so sánh được | Trung bình |
| 6 | Ghi chú dự án nói `category` đã ẩn, nhưng form vật tư vẫn hiển thị ô "Nhóm" (chưa rõ ghi chú lỗi thời hay form chưa cập nhật) | Thấp |

Nhận xét: rủi ro cao nhất vì mang hai nghĩa và CRM dùng làm tiêu chí giá.

## 4. `trade_category` (Phân loại thương mại)

Do tenant khai ở Cài đặt (`catalog.trade`), hai danh sách riêng cho hàng hoá và dịch vụ. Lưu bằng chữ trong `materials`.

| # | Rủi ro | Mức |
|---|---|---|
| 1 | Không có khoá ngoại; đổi tên hoặc xoá mục trong Cài đặt để lại mặt hàng mang chữ "ngoài danh mục" | Cao |
| 2 | Chặn xoá mục đang dùng chỉ nằm ở giao diện (`usedTrade` tính từ danh sách vật tư đã tải về trình duyệt); server không kiểm. Gọi API trực tiếp, hoặc dữ liệu chưa tải đủ (phân trang, hàng ngừng dùng), vẫn xoá được | Cao |
| 3 | Phần lớn dữ liệu bỏ trống (431 trong 613 hàng ở tenant dev cũ); báo cáo và bộ lọc theo phân loại bỏ sót phần lớn hàng | Trung bình |
| 4 | Hai danh sách riêng cho hàng hoá và dịch vụ; đổi `kind` phải xoá phân loại đã chọn (form đã làm), nhưng nhập Excel và import có thể đặt phân loại hàng hoá lên dịch vụ | Trung bình |
| 5 | CRM hiện phân loại trong cột chọn hàng; chữ sai chính tả ở Kho lan sang báo giá | Thấp |

Nhận xét: thiếu ràng buộc nhất; là lý do chính cần chuẩn hoá thành bảng (xem
`KE_HOACH_CHUAN_HOA_DANH_MUC_VA_CAI_DAT.md`).

## 5. `trade_mode` (Cách sử dụng)

Chữ tự do lấy từ danh mục `catalog.trade.usageModes` (Chỉ bán, Chỉ tặng, Đi kèm combo, Chỉ dùng nội bộ, Có thể bán và
quà tặng). Dòng cũ còn mã `SALE_ONLY`, `GIFT_ONLY`, `INTERNAL_ONLY`, `MULTI`.

| # | Rủi ro | Mức |
|---|---|---|
| 1 | Hai hệ mã song song (mã cũ và chữ tự do); mọi nơi phải đổi qua `usageLabel` | Cao |
| 2 | Lọc theo cách sử dụng so sánh nhãn đã chuyển; một mã cũ lạ có thể không có nhãn tương ứng | Trung bình |
| 3 | Lưu bằng chữ; chặn xoá chỉ ở giao diện (cùng cơ chế `trade_category`) | Trung bình |
| 4 | Chưa thấy hành vi nghiệp vụ gắn vào (ví dụ chặn bán hàng "Chỉ dùng nội bộ" ở CRM); nếu người dùng tin nó có tác dụng chặn thì sẽ sai | Trung bình |
| 5 | Server chỉ kiểm chữ không rỗng và độ dài, không kiểm thuộc danh mục | Thấp |

## 6. Việc đề xuất

| Thứ tự | Việc | Lý do |
|---|---|---|
| 1 | Tách hai nghĩa của `category`; bỏ giá trị gán cứng `CONSUMABLE` ở form hàng hoá thương mại; không để chính sách giá CRM phụ thuộc `category` | Đang gây sai dữ liệu thật |
| 2 | Kiểm ở server: giá trị `trade_category` và `trade_mode` phải thuộc danh mục; xoá mục đang dùng bị từ chối | Chặn xoá chỉ ở giao diện là lỗ hổng thật |
| 3 | Gom danh sách `kind` về một nơi dùng chung giữa Kho và CRM | Giảm chi phí mở rộng; chưa gây sai dữ liệu |
| 4 | Dọn mã cũ của `trade_mode` bằng migration mới (không sửa migration đã merge) | Bỏ nhánh xử lý hai hệ mã |

Mục 1 và 2 độc lập với quyết định chuẩn hoá danh mục lớn, có thể làm riêng.

## 7. Ngoài phạm vi

- `asset_category` của thiết bị (`INDUSTRIAL`, `IT_OFFICE`, `TOOL_PPE`, `VEHICLE`).
- Sửa dữ liệu CRM đã chụp `kind` và `category` ở dòng cũ.
- Đổi nghiệp vụ giá và chiết khấu của CRM (cần quyết định riêng của phụ trách CRM).
