# Kế hoạch backend: vị trí lưu trữ hàng hóa, cách theo dõi lô / serial và nhật ký vòng đời

Phạm vi: phân hệ Kho (`inventory`), phần dữ liệu, API, quy tắc nghiệp vụ và migration. Bố cục màn hình, hộp thoại và tương tác nằm ở
[THIET_KE_GIAO_DIEN_VI_TRI_LUU_TRU_VA_THEO_DOI.md](THIET_KE_GIAO_DIEN_VI_TRI_LUU_TRU_VA_THEO_DOI.md) (kế hoạch giao diện); hai tài liệu tham chiếu nhau theo số mục.
Mục "Hiện trạng" đã đối chiếu với code và migration trên `origin/dev/release` (commit `d9efdc22`); phần chưa kiểm chứng
nêu ở mục 11.

Liên quan, đọc cùng:
- [KE_HOACH_HANG_HOA_DICH_VU_TAI_SAN.md](KE_HOACH_HANG_HOA_DICH_VU_TAI_SAN.md): `kind`, `tracking_mode`, tài sản, dịch vụ.
- [DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT.md](../DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT.md): công tắc lô/sê-ri theo tenant.
- [THIET_KE_CHUC_NANG_KIEM_KE_KHO.md](../THIET_KE_CHUC_NANG_KIEM_KE_KHO.md): kiểm kê.

Kế hoạch này **không đặt lại** những gì hai tài liệu đầu đã chốt. Nó dùng cùng tên cột `tracking_mode` và cùng cơ chế
`module_settings`, và bổ sung hai phần còn thiếu: vị trí lưu trữ (mục 4) và cách phân loại nhóm so với theo dõi (mục 5).

## 1. Quyết định đã chốt

| # | Quyết định | Hệ quả |
|---|---|---|
| 1 | Vị trí kho, kệ, ngăn **chỉ là dữ liệu thông tin tùy chọn**, phục vụ kiểm kê và xuất kho | Không có logic kiểm tra, không đổi cách tính tồn, không chặn chứng từ |
| 2 | Nhập vị trí bằng **chuỗi tự do**, nhưng lưu ở **bảng riêng** | Để sau này nâng lên theo dõi vị trí thật mà không phải đổi dữ liệu đã nhập |
| 3 | Số cấp và tên cấp (khu, dãy, kệ, tầng, ô...) **khai theo tenant và theo từng kho**, **không giới hạn số cấp** | Kho A có thể 2 cấp, kho B 3 cấp hay hơn |
| 4 | Một mặt hàng có thể tồn ở nhiều kho, mỗi kho một hoặc nhiều vị trí | Xem mục 4.3 |
| 5 | **Lô và serial tách nhau**: một mặt hàng chỉ có một cách theo dõi | `tracking_mode` là `NONE`, `LOT` hoặc `SERIAL`; không có giá trị kết hợp |
| 6 | Nhóm (`category`) **không quyết định** cách theo dõi | Nhóm chỉ gợi ý giá trị điền sẵn lúc tạo hàng (mục 5.2); đã đồng ý giữ gợi ý |
| 7 | Sửa vị trí **dùng chung quyền** sửa danh mục hàng hóa | Không thêm action quyền mới |
| 8 | **Kiểm kê được ghi ngược** vị trí mới vào dữ liệu vị trí khi duyệt | Xem mục 4.5.1 |
| 9 | **Serial** dành cho vật lớn đếm theo cái, chiếc: mỗi cá thể một mã serial đại diện, không mang số lô. **Lô** dành cho vật nhỏ số lượng lớn (đinh, vít, ốc): nhiều lần nhập có cùng thông tin định danh được gom thành một lô; khác nhà cung cấp thì là lô khác (dòng 12) | Hai đối tượng có vòng đời riêng (mục 6) |
| 10 | Vòng đời **chỉ lưu lịch sử dạng dòng nhật ký đơn giản** cho cả serial và lô: nhập xuất kho, bán cho khách A, B, C, bảo trì... | Mục 6; không làm danh mục trạng thái, người giữ, truy xuất xuôi ngược ở lần này |
| 11 | Quản lý serial và quản lý lô **chỉ là tùy chọn của tenant**, **mặc định tắt** | Công tắc `tracking.serial.enabled`, `tracking.lot.enabled`; tùy chọn Excel "Cập nhật vị trí chính theo file" cũng mặc định tắt |
| 12 | **Khác một trường định danh là khác lô** (số lô, nhà cung cấp, ngày sản xuất, hạn dùng, số chứng chỉ). **Cách xử lý bốn trường hợp (trùng hết, khác, lô trống, nhập trống) do tenant đặt mặc định và người dùng quyết định, có đủ tạo, xem, sửa, xóa lô** | Mục 6.2, 6.3 |
| 13 | Vị trí nhập từ Excel là **chữ tự do**, không bắt khớp cấu trúc kho; hàng có hoặc không có vị trí đều hợp lệ | Mục 5.7, A |
| 14 | Nhật ký có trường `detail` (ghi chú) và API nội bộ để module khác (ví dụ Bảo trì) ghi sau; **chưa nối** sự kiện CRM và Bảo trì | Mục 6.5 |
| 15 | **Đã chốt:** một mặt hàng, nhà cung cấp là thuộc tính của lô và phiếu nhập, quản lý bằng danh mục trong Cài đặt; không tạo hai mặt hàng theo nhà cung cấp. Nhập nhà cung cấp **chỉ chọn từ danh mục** | Mục 6.1 |
| 16 | **Đã chốt:** trường định danh lô mặc định bật cả bốn (nhà cung cấp, ngày sản xuất, hạn dùng, số chứng chỉ); cách xử lý bốn trường hợp mặc định như bảng 6.2, `allowOverride = true` cho cả bốn | Mục 6.2 |

## 2. Hiện trạng đã xác minh

### 2.1 Vị trí

- `inventory_schema.warehouse_locations` (`0001-inventory.sql`) có `id`, `warehouse_id`, `code`, `name`, `qr_code`. Không
  có `parent_id`, không có API tạo dữ liệu, giao diện chỉ có ô văn bản tự do ở form kho
  (`warehouse-editor.tsx`).
- `material_inventory.location_id` và `inventory_transactions.location_id` có trong schema nhưng code không dùng.
  Khóa duy nhất `(warehouse_id, location_id, material_id)` được khai `NULLS NOT DISTINCT`, và mọi truy vấn tồn đều lọc
  `location_id IS NULL`.
- `stocktake_lines.bin_location` đã có (`0010-stocktake.sql`), hợp đồng `StocktakeLine.binLocation` đã có; chưa có nguồn dữ
  liệu để điền.
- Chứng từ kho (`stock_documents`, `stock_document_lines`) không có cột vị trí.

### 2.2 Nhóm và theo dõi

`MaterialCategory` là bốn giá trị `SPARE_PART`, `CONSUMABLE`, `TOOL`, `ROTABLE`. Ngoài ra có `kind` (`STOCK`, `SERVICE`;
`ASSET` đi đường riêng), `tradeCategory` (chuỗi tự do lấy từ Cài đặt) và `isSerialized`.

`materials` **chưa có** cột `tracking_mode`. Form hàng hóa (`material-form.tsx`) quy đổi khi lưu: `SERIAL` thành
`is_serialized = true`, `LOT` thành `category = 'CONSUMABLE'`, `NONE` thành `SPARE_PART`, và đọc ngược lại khi sửa. Hệ
quả: mọi vật tư tiêu hao hiện tự động được coi là theo lô, và không có cách nào khai một phụ tùng theo lô.

### 2.3 Serial và lô đã có sẵn ở server

| Đối tượng | Bảng | Đã có |
|---|---|---|
| Serial | `serial_tracking` (`0013`) | Duy nhất `(material_id, upper(btrim(serial_number)))`; `quality_status` (`PASSED`, `QUARANTINE`, `DEFECTIVE`, `PENDING_INSPECTION`); `stock_state` (trong kho, đã xuất, đang chuyển, đã hủy); `current_status` và `location_type` là chuỗi tự do do admin tenant khai |
| Lịch sử serial | `serial_movements` (`0013`) | Chỉ ghi thêm, trigger chặn UPDATE và DELETE |
| Lô | `lots`, `lot_balances` (`0014`), `lot_quality_events` | Số dư theo kho, trạng thái chất lượng (`0015`) |
| Tài sản | `asset_test_records` | Chỉ cho tài sản; `test_type` là chữ tự do |
| Cũ | `lot_tracking` (`0011`, `0018`) | Không dùng trong code |

Ghi sổ chứng từ đã ép số serial theo `is_serialized` (`postgres-stock-document.store.ts`, vùng 1196-1206) và đã có mã
lỗi `LOT_REQUIRED` cho lô (vùng 956-962). Công việc ở mục 5 là chuyển các kiểm tra này sang đọc `tracking_mode`, không
phải viết mới từ đầu.

## 3. Nguyên tắc

- Mọi thay đổi schema là migration mới, chạy lại được, tương thích ngược (skill `erp-migrations`). Rollback chỉ lùi
  image, nên bản app cũ phải chạy được với schema mới.
- Phần vị trí **không đụng** vào `material_inventory`, giữ hàng, báo cáo tồn. Bảng mới độc lập, bản cũ bỏ qua.
- Server kiểm quyền; giao diện chỉ ẩn hiện theo `capabilities` (skill `erp-permissions`).
- Giao diện dùng `SearchableSelect`, không dùng thẻ `<select>`, không dùng emoji; chữ hiển thị là tiếng Việt có dấu.
- Không thêm cột chỉ để dự phòng. Cột nào thêm được an toàn ở migration sau thì để sau (xem 4.6).

## 4. Phần A: vị trí lưu trữ

### 4.1 Bảng mới `inventory_schema.material_storage_locations`

Mỗi dòng nói: "ở kho này, mặt hàng này nằm ở chỗ này".

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | UUID, khóa chính | |
| `warehouse_id` | UUID, bắt buộc, FK `warehouses`, `ON DELETE CASCADE` | Kho |
| `material_id` | UUID, bắt buộc, FK `materials`, `ON DELETE CASCADE` | Mặt hàng |
| `location_text` | VARCHAR(255), bắt buộc | Chuỗi hiển thị và tìm kiếm, ví dụ `Khu A / Kệ 3 / Ngăn 2` |
| `segments` | JSONB, có thể rỗng | Các phần theo từng cấp, ví dụ `["Khu A","Kệ 3","Ngăn 2"]`; để form chia ô theo cấp |
| `is_primary` | BOOLEAN, mặc định false | Vị trí chính của mặt hàng ở kho đó |
| `note` | TEXT, có thể rỗng | Ghi chú tự do (ví dụ "hàng nặng, để tầng thấp") |
| `created_at`, `updated_at`, `updated_by` | | Truy vết người sửa |

Ràng buộc:
- Duy nhất `(warehouse_id, material_id, lower(btrim(location_text)))`: không khai trùng một chỗ.
- Chỉ một dòng `is_primary = true` cho mỗi `(warehouse_id, material_id)` (chỉ mục duy nhất có điều kiện).
- `location_text` là nguồn hiển thị và tìm kiếm. `segments` chỉ là gợi ý cho form; nếu lệch nhau thì `location_text` thắng.
- Chỉ mục `(material_id)` cho tra "hàng này nằm ở những kho nào"; khóa duy nhất ở trên đã phục vụ tra theo kho.

Không thêm cột vào `material_inventory`, `stock_document_lines` hay `inventory_transactions`.

### 4.2 Số cấp và tên cấp

| Nơi | Lưu | Vai trò |
|---|---|---|
| Cài đặt tenant | Khóa `warehouse.location.levels` trong `module_settings` | Mẫu mặc định, ví dụ `["Khu vực","Dãy","Kệ","Tầng","Ô chứa"]` |
| Từng kho | Cột mới `warehouses.location_levels` JSONB, có thể rỗng | Ghi đè mẫu tenant. Rỗng nghĩa là dùng mẫu tenant |

- **Không giới hạn số cấp** về nghiệp vụ: `location_levels` và `segments` là mảng JSONB, không đặt trần số phần tử. Chỉ
  giữ giới hạn kỹ thuật chống dữ liệu rác: tên cấp tối đa 50 ký tự, `location_text` tối đa 255 ký tự. Form hiển thị
  các ô theo cấp và tự xuống dòng khi nhiều. Cấp "Kho" chính là kho nên không nằm trong danh sách.
- Danh sách tên cấp **chỉ quyết định hình dạng form** (bao nhiêu ô, nhãn gì). Đổi tên cấp hay số cấp **không** đổi dữ liệu
  đã nhập, vì `location_text` đã là chuỗi hoàn chỉnh.
- Ký tự nối khi ghép `location_text` cố định là ` / `.
- Bảng trong ảnh tham khảo (Kho, Khu vực, Dãy, Kệ, Tầng, Ô chứa) được dùng làm **mẫu gợi ý** khi tenant chưa khai.

### 4.3 Một mặt hàng tồn ở nhiều kho

Ví dụ vòng bi 6205 có 40 cái ở kho A và 10 cái ở kho B.

| Tình huống | Cách lưu và hiển thị |
|---|---|
| Hai kho, mỗi kho một chỗ | Hai dòng: `(A, 6205, "Kệ 3 / Ngăn 2")` và `(B, 6205, "Dãy 1 / Tầng 4")` |
| Cùng kho nhưng để ở hai chỗ | Hai dòng cùng `(A, 6205)`; một dòng `is_primary`. Không có số lượng theo từng chỗ |
| Màn kiểm kê, xuất kho của kho B | Chỉ tra theo `(kho B, mặt hàng)`, không bao giờ hiện vị trí của kho A |
| Mặt hàng chưa khai vị trí ở kho đó | Không có dòng; ô vị trí để trống, không báo lỗi |
| Chuyển kho A sang B | Vị trí **không** tự di chuyển; ở kho B để trống cho đến khi khai |
| Kho tên thay đổi, tắt dùng | Không ảnh hưởng; dòng gắn theo `warehouse_id` |
| Kho `VIRTUAL_IN_TRANSIT` | API từ chối khai vị trí |
| Mặt hàng `kind = SERVICE` | API từ chối khai vị trí |

Giới hạn cần biết: vị trí gắn với mặt hàng trong kho, **không gắn với lô hay serial**, và không có số lượng theo từng chỗ.
Không thể trả lời "40 cái này chia ra mỗi ngăn mấy cái" hay "serial X nằm ở ngăn nào". Đó là phạm vi của mục 4.6.

### 4.4 API và quyền

| Phương thức | Đường dẫn | Mục đích |
|---|---|---|
| GET | `/v1/materials/:id/storage-locations` | Mọi vị trí của một mặt hàng, nhóm theo kho |
| GET | `/v1/warehouses/:id/storage-locations?materialId=&q=` | Vị trí trong một kho; hỗ trợ tìm theo văn bản |
| PUT | `/v1/materials/:id/storage-locations/:warehouseId` | Thay toàn bộ danh sách vị trí của mặt hàng ở kho đó (một lần ghi, một transaction) |
| PUT | `/v1/warehouses/:id/location-levels` | Khai tên cấp của kho |

- Danh sách mặt hàng hiện có thể lọc theo `locationText` (so khớp không phân biệt hoa thường).
- Quyền: **dùng chung quyền sửa danh mục hàng hóa** (đã chốt). Xác định action cụ thể khi làm, qua
  `inventory-access.guard.ts`. **Không thêm action quyền mới** (luật 3). Đọc vị trí dùng quyền xem danh mục.
- Lỗi trả dạng `{ statusCode, code, message }`, `message` tiếng Việt.

### 4.5 Dùng ở đâu (chỉ hiển thị)

| Màn hình | Hiển thị |
|---|---|
| Danh mục hàng hóa | Tab "Vị trí lưu trữ": bảng theo kho, thêm, sửa, xóa; ô chọn kho bằng `SearchableSelect` |
| Form kho | Khai tên cấp của kho |
| Kiểm kê | Cột "Vị trí" trên dòng đếm; sắp xếp và lọc theo vị trí để đi một vòng kho. Khi tạo đợt kiểm kê, sao chép **vị trí chính** của `(kho, mặt hàng)` vào `stocktake_lines.bin_location` (cột đã có) để đợt kiểm kê cũ giữ nguyên giá trị khi vị trí đổi sau này |
| Xuất kho, chuyển kho | Hiện vị trí của kho nguồn bên cạnh mỗi dòng, chỉ đọc |
| Nhập Excel | Xem mục 5.7 |
| Tìm kiếm | Ô tìm hàng hóa tìm thêm theo văn bản vị trí |

### 4.5.1 Kiểm kê ghi ngược vị trí

Người đếm sửa được ô "Vị trí" trên dòng kiểm kê. Khi **duyệt** đợt kiểm kê, vị trí mới được ghi ngược vào
`material_storage_locations`, trong cùng transaction với việc ghi sổ điều chỉnh. Không cần quyền riêng: quyền duyệt kiểm
kê (`inventory.stocktake.approve`) đã đủ.

Để biết dòng nào bị đổi, dòng kiểm kê lưu thêm vị trí gốc lúc tạo đợt: cột mới `stocktake_lines.bin_location_original`
(`bin_location` vẫn là giá trị người đếm nhập).

| Tình huống lúc duyệt | Xử lý |
|---|---|
| `bin_location` bằng `bin_location_original` | Không làm gì |
| Khác, và vị trí chính hiện tại vẫn bằng bản gốc | Vị trí mới thay vị trí chính cũ của `(kho, mặt hàng)`; các vị trí phụ giữ nguyên |
| Khác, nhưng vị trí chính hiện tại đã bị người khác sửa trong lúc kiểm kê | Không ghi đè: thêm vị trí mới thành vị trí phụ và báo trong kết quả duyệt để người duyệt xử lý |
| Người đếm xóa trắng ô vị trí | Coi là không đổi, không xóa dữ liệu hiện có |
| Dòng chưa đếm hoặc bị loại khỏi đợt | Không ghi ngược |

Mỗi lần ghi ngược được ghi vào nhật ký dòng kiểm kê hiện có (`stocktake_line_audits`) với giá trị cũ và mới.

### 4.6 Hướng nâng cấp khi cần theo dõi vị trí thật

Bảng ở 4.1 được giữ tối thiểu. Khi cần tồn theo từng chỗ, các thay đổi sau đều là migration cộng thêm, không phải dữ liệu
đã nhập:

1. Thêm `location_id UUID NULL` nối tới `warehouse_locations` (bảng đã có), kèm `parent_id` cho cây; dòng cũ giữ
   `location_text`.
2. Thêm `quantity NUMERIC NULL` để mỗi dòng nói số lượng nằm ở chỗ đó.
3. Thêm `lot_id`, `serial_id` nếu cần biết lô hay serial nằm ở đâu.
4. Khi đã có số lượng theo chỗ, mới cân nhắc chứng từ chuyển vị trí và kiểm kê theo vị trí (kéo theo đổi khóa duy nhất
   `(session_id, material_id)` của `stocktake_lines`).

Các bước 1 đến 4 **không nằm** trong kế hoạch này.

## 5. Phần B: phân loại nhóm so với theo dõi lô / serial

### 5.1 Hai trục độc lập

| Trục | Trả lời câu hỏi | Nơi lưu | Ai chọn |
|---|---|---|---|
| `kind` | Có quản lý tồn không | cột có sẵn | Hệ thống |
| `category` (nhóm) | Hàng này thuộc loại nào, dùng vào việc gì | cột có sẵn | Người dùng |
| `tradeCategory` | Phân loại kinh doanh của tenant | cột có sẵn | Tenant (từ Cài đặt) |
| **`tracking_mode`** | **Tồn của mặt hàng được nhận diện ra sao** | **cột mới** | **Người dùng** |

`tracking_mode`: `NONE` (chỉ đếm số lượng), `LOT` (theo lô), `SERIAL` (theo từng cá thể). Ba giá trị loại trừ nhau.

Cột `materials.tracking_mode VARCHAR(10) NOT NULL DEFAULT 'NONE'`, có CHECK ba giá trị, và CHECK `kind <> 'SERVICE'` hoặc
`tracking_mode = 'NONE'`.

**Tiêu chí chọn:**

| Cần gì | Chọn |
|---|---|
| Lịch sử riêng từng cái: bảo trì, bán, người giữ, tình trạng | `SERIAL` |
| Truy xuất theo mẻ, hạn dùng, kiểm định cả mẻ | `LOT` |
| Chỉ cần biết còn bao nhiêu | `NONE` |

Mỗi cá thể `SERIAL` chỉ cần một mã serial đại diện (đã chốt). Serial không mang số lô.

### 5.2 Gợi ý theo nhóm: chỉ là giá trị điền sẵn

Khi người dùng **tạo** mặt hàng và chọn nhóm, ô "Cách theo dõi" được điền sẵn một giá trị gợi ý. Người dùng sửa được.

| Nhóm | Gợi ý điền sẵn |
|---|---|
| ROTABLE | SERIAL |
| TOOL | SERIAL |
| SPARE_PART | NONE |
| CONSUMABLE | NONE |

- Bảng này lưu ở `module_settings`, khóa `tracking.defaultByCategory`, tenant sửa được. Có thể tắt hẳn (form mặc định `NONE`).
- Gợi ý **không được lưu thành quy tắc**: sau khi tạo, đổi nhóm không làm đổi `tracking_mode`.
- Đây là điểm khác với hiện nay: hôm nay nhóm CONSUMABLE **ép** mặt hàng thành "theo lô", không đổi được.

### 5.3 Dữ liệu cũ (backfill)

| Điều kiện | `tracking_mode` |
|---|---|
| `is_serialized = true` | `SERIAL` |
| Chưa theo serial, nhưng đã có dòng trong `lots` hoặc `lot_balances` | `LOT` |
| Còn lại | `NONE` |

- **Không suy từ `category`**, đúng như đã ghi ở tài liệu lô/sê-ri theo tenant (mục 3.2): không tự chuyển vật tư tiêu hao
  sang `LOT`.
- Trường hợp vừa serial vừa có lô (xung đột với quy tắc loại trừ): lấy `SERIAL`; migration in danh sách mã vào
  `RAISE NOTICE`, dữ liệu lô cũ vẫn đọc được ở màn truy xuất. Số trường hợp này chưa biết (mục 11).
- `is_serialized` giữ đồng bộ với `tracking_mode` khi ghi (`SERIAL` thì true). Bản mới đọc `tracking_mode`; bản cũ vẫn đọc
  `is_serialized`. Bỏ cột cũ theo expand/contract ở đợt sau, không trong kế hoạch này.

### 5.4 Quy tắc đổi cách theo dõi

- Chỉ đổi được khi mặt hàng **chưa có tồn và chưa có chứng từ ghi sổ**. Đã có thì từ chối với thông báo tiếng Việt nêu
  rõ lý do. Luồng "khai báo serial hoặc lô cho tồn cũ" nằm ngoài kế hoạch này.
- Mọi lần đổi ghi lịch sử (`material_tracking_history`: mặt hàng, từ, sang, người đổi, thời điểm, lý do).
- Công tắc theo tenant `tracking.lot.enabled`, `tracking.serial.enabled` (đề xuất lô/sê-ri theo tenant, mục 3.1) giữ nguyên:
  chỉ chọn được `LOT` hoặc `SERIAL` khi công tắc tương ứng bật; tenant đã có dữ liệu thì tự bật; chặn tắt khi còn mặt hàng
  đang theo dõi có tồn.
- Dịch vụ luôn `NONE`; form ẩn lựa chọn này.

### 5.5 Ép khi ghi sổ

Hiện kiểm tra serial đọc `is_serialized` và lô đọc theo luồng riêng (mục 2.3). Việc cần làm:

1. Cả hai đọc `tracking_mode`.
2. Cài đặt tenant `tracking.enforcement` với hai mức: `warn` (cho ghi sổ, trả cảnh báo) và `block` (từ chối). Mặc định `warn`.
   Lý do mặc định `warn`: dữ liệu cũ chưa có lô hoặc serial không được làm kẹt chứng từ đang chạy.
3. `SERIAL`: số lượng nguyên và bằng số serial. `LOT`: bắt buộc mã lô (và hạn dùng nếu mặt hàng khai hạn dùng).
4. Giữ nguyên quy tắc đã có: lô `BLOCKED`, `EXPIRED`, `QUARANTINE` không chọn được khi xuất.

### 5.6 Dọn bảng cũ

`lot_tracking` được ghi chú "không dùng" trong tài liệu; **không `DROP`** (luật tương thích ngược).

### 5.7 Nhập Excel nhiều mặt hàng

**Hiện trạng** (đã đọc `excel-import-dialog.tsx`): hộp thoại này là công cụ **nạp dòng chứng từ**, không phải nhập danh
mục thuần. Mỗi dòng có mã kho, vị trí, số lượng, đơn giá, thuế, định mức min/max, số lô, hạn dùng, ghi chú. Mã hàng chưa có
thì tạo mặt hàng mới (kèm loại, đơn vị, định mức). Số serial luôn rỗng (`serialNumbers: []`) và không có cột cách theo dõi.
Cột "Vị trí" được đọc vào dòng (`locationId`), nhưng chứng từ kho không có cột vị trí (mục 2.1), nên theo hiểu của tôi giá
trị này không được lưu sau khi ghi sổ; chưa xác nhận (mục 11). Với nạp dữ liệu cả kho, còn dòng lỗi thì không cho nạp
(tất cả hoặc không); quy tắc này giữ nguyên.

Đề xuất xử lý:

**A. Vị trí: khi chữ trong file không khớp cấu trúc kho đã khai**

Nguyên tắc: vị trí trong file là **chữ tự do**. Hệ thống không bắt phải khớp tên kho, tên cấp hay danh sách vị trí nào; có
hàng có vị trí, có hàng không, đều hợp lệ.

| Tình huống | Xử lý |
|---|---|
| Chữ không theo cấu trúc khu, kệ, ngăn (ví dụ "gần cửa", "A-03-02", "kệ cũ phía sau") | Lưu nguyên văn vào `location_text`, không tách cấp (`segments` để trống), hiển thị là vị trí tự do. Không lỗi, không cảnh báo |
| File có nhiều cột, mỗi cột một cấp | Bước ghép cột cho ghép từng cột với "Cấp 1", "Cấp 2"... (tên cấp lấy từ cấu hình kho nhận, không giới hạn số cấp). Hệ thống nối bằng ` / ` thành `location_text` và lưu `segments`. Ô cấp trống thì bỏ cấp đó |
| File một cột có dấu `/` hoặc `>` | Tách theo hai dấu này và chuẩn hóa thành ` / `. Dấu khác (gạch ngang, dấu chấm) **không** tách vì có thể là một mã nguyên (`A-03-02`) |
| Ô vị trí trống | **Không đổi gì** dữ liệu hiện có, không xóa vị trí đã khai. Xóa vị trí làm trong giao diện, không qua file |
| Trong file chỉ một phần hàng có vị trí | Chỉ dòng có vị trí được ghi. Bảng xem trước đếm "N dòng có vị trí, M dòng không" |
| Hàng đang có tồn và hàng không còn tồn trong cùng file | Cả hai đều lưu: vị trí là thông tin khai báo, không phụ thuộc có tồn (khai trước cho hàng sắp nhập) |
| Cùng `(kho, mã hàng)` nhiều dòng khác vị trí | Thành nhiều vị trí; dòng đầu là vị trí chính; trùng (không phân biệt hoa thường, bỏ khoảng trắng) thì bỏ |
| `(kho, mã hàng)` đã có vị trí | **Không ghi đè** vị trí chính; vị trí khác trong file thêm làm vị trí phụ. Tùy chọn "Cập nhật vị trí chính theo file", mặc định tắt |
| Vị trí chưa từng dùng ở kho đó | Bảng xem trước đánh dấu "Vị trí mới"; vị trí đã từng dùng đánh dấu "Đã dùng". Giúp phát hiện gõ lệch như "Ke 3" và "Kệ 3". Chỉ là gợi ý, không chặn |
| File nhiều kho nhưng dòng thiếu mã kho | Bỏ phần vị trí của dòng, cảnh báo. File một kho thì dùng kho mặc định |
| Kho ảo, hàng dịch vụ | Bỏ qua vị trí, cảnh báo |
| Dài quá 255 ký tự | Lỗi dòng (trường hợp lỗi duy nhất của vị trí) |

Chuẩn hóa: bỏ khoảng trắng hai đầu và gộp khoảng trắng liền nhau; giữ nguyên hoa thường và dấu như người nhập.

**Lưu thế nào.** Sau khi ghi sổ chứng từ thành công, giao diện gọi API hàng loạt phía server
`PUT /v1/storage-locations/bulk`. Vị trí là thông tin tùy chọn nên **không** gộp chung transaction với chứng từ: nếu bước
lưu vị trí lỗi thì tồn vẫn đúng, giao diện báo "đã ghi sổ, chưa lưu được N vị trí" kèm nút thử lại.

**Chế độ chỉ nạp vị trí.** Vì API hàng loạt ở trên vẫn phải làm cho nạp chứng từ, thêm một chế độ nhập riêng gần như không
tốn thêm: file chỉ gồm mã hàng, mã kho, vị trí; không tạo chứng từ, không đổi tồn. Dùng để khởi tạo vị trí cho hàng nghìn
mã. Thao tác lặp lại được nên **dòng hợp lệ vẫn được lưu**; dòng lỗi (mã hàng hoặc mã kho không tồn tại) được xuất ra để sửa
và nạp lại. Đề xuất làm cùng A5.

**B. Cách theo dõi, lô, serial**

| Việc | Quy tắc |
|---|---|
| Cột mới "Cách theo dõi" (Không, Lô, Serial; nhận cả `NONE`, `LOT`, `SERIAL`) | Chỉ áp dụng cho mặt hàng **mới tạo** trong file. Để trống thì dùng gợi ý theo nhóm (mục 5.2) nếu file có cột nhóm; không có thì `NONE` |
| Mặt hàng đã có trong hệ thống | Bỏ qua cột này. Nếu khác với hiện tại thì cảnh báo dòng (không lỗi), vì chỉ đổi được khi chưa có tồn (mục 5.4) và phải qua form hàng hóa |
| Mặt hàng `LOT`, nhập kho | Cột số lô bắt buộc (và hạn dùng nếu mặt hàng khai hạn dùng). Thiếu: lỗi dòng nếu `tracking.enforcement = block`, cảnh báo nếu `warn` |
| Mặt hàng `SERIAL`, nhập kho | Cột mới "Số serial": nhiều serial trong một ô, cách nhau bằng `;` hoặc xuống dòng, và số serial phải bằng số lượng. Hoặc nhiều dòng cùng mã hàng, mỗi dòng một serial |
| Serial trùng trong file, hoặc đã có trong hệ thống | Luôn là lỗi dòng, không phụ thuộc `warn`/`block`, vì tính duy nhất là ràng buộc của database |
| Mặt hàng `NONE` có điền số lô hoặc serial | Bỏ qua giá trị, cảnh báo dòng. Hiện cột số lô được nhận cho mọi mặt hàng; sẽ đổi theo quy tắc này |
| Mặt hàng mới khai `LOT` hoặc `SERIAL` khi công tắc tenant tương ứng đang tắt | Lỗi dòng, kèm thông báo tiếng Việt |

**C. Xem trước và hiệu năng**

- Bảng xem trước thêm cột "Cách theo dõi" và "Vị trí", và tổng số cảnh báo.
- Mẫu file tải về thêm hai cột: Cách theo dõi, Số serial. Nhận diện tiêu đề đa ngôn ngữ như các cột hiện có.
- Với file hàng nghìn dòng, kiểm serial trùng gửi theo lô một truy vấn phía server (`= ANY(...)`), không kiểm từng dòng.
- Nếu có một đường nhập **danh mục** riêng (kế hoạch hàng hóa, dịch vụ, tài sản nhắc `postgres-inventory-store.ts:946`, có
  `INSERT` chứa `is_serialized`), đường này cũng phải nhận cột cách theo dõi theo cùng quy tắc B. Chưa kiểm (mục 11).

## 6. Phần C: lô, serial và lịch sử vòng đời

Hai đối tượng, đều chỉ là **tùy chọn của tenant**, công tắc mặc định tắt (mục 5.4):

| Đối tượng | Ví dụ | Vòng đời cần xem |
|---|---|---|
| **Serial** | Vật lớn, đếm theo cái, chiếc: máy bơm, động cơ, thiết bị đo | Nhập, xuất, chuyển kho, đổi chất lượng; bán cho khách A, B, C; bảo trì; kiểm định; ghi chú |
| **Lô** | Vật nhỏ, số lượng lớn như đinh, vít, ốc | Các lần nhập thuộc lô (phiếu nào, số lượng), xuất cho ai, đổi chất lượng, kiểm định; ghi chú |

Không có máy trạng thái, không chặn thao tác, không danh mục trạng thái do tenant khai ở lần này.

### 6.0 Hiện trạng liên quan

- **Serial:** `serial_movements` (chỉ ghi thêm) đã ghi nhập, xuất, chuyển, trả, bảo hành xuất, điều chỉnh, đảo **và cả
  `QUALITY_CHANGE`**, kèm `source_type`, `source_id`, chứng từ. Không ghi đôi các sự việc này vào bảng nhật ký mới.
- **Lô:** `lots` duy nhất theo `(material_id, lot_no)`, có sẵn `supplier`, `manufactured_on`, `expires_on`,
  `certificate_no`, `note`, `updated_at`. `lot_balances` cộng dồn theo kho; mỗi dòng chứng từ có `lot_id`. `lot_quality_events`
  ghi đổi chất lượng, chỉ ghi thêm.
- **API lô hiện chỉ có đọc và đổi chất lượng:** `GET /v1/lots`, `GET /v1/lots/suggest`, `GET /v1/lots/:id`,
  `POST /v1/lots/:id/quality` (`lot.controller.ts`). Lô chỉ được tạo gián tiếp khi ghi sổ chứng từ nhập. **Chưa có tạo trực tiếp, sửa, xóa.**
- **Nhà cung cấp hiện nằm ở 4 nơi, đều là chữ tự do, không có danh mục chung:**

| Nơi | Cột | Ý nghĩa |
|---|---|---|
| Mặt hàng | `materials.supplier` (varchar 180, `0008`) | "Mua của ai" mặc định của hồ sơ mặt hàng. Ghi chú trong migration: thuộc hồ sơ mã vật tư, không thuộc từng lần nhập |
| Lô | `lots.supplier` (varchar 255, `0014`) | Nhà cung cấp của lô |
| Sổ cái | `inventory_transactions.counterparty_type = 'SUPPLIER'`, `counterparty_name` (`0020`) | Bên nhập đến, theo từng giao dịch |
| Bảng cũ | `lot_tracking.supplier` | Không dùng |

  Không có bảng nhà cung cấp trong Kho. Trong CRM chỉ thấy `crm_schema.tender_partners` (đối tác đấu thầu), chưa kiểm xem
  có dùng làm danh mục nhà cung cấp được không (mục 11).

### 6.1 Nhà cung cấp: hai bản ghi hàng hóa hay một bản ghi

Câu hỏi: cùng một hàng mua từ hai nhà cung cấp thì khai **hai mặt hàng** (mỗi nhà một mã), hay **một mặt hàng** và nhà cung
cấp là một thông tin quản lý riêng?

| | Phương án 1: hai mặt hàng, mỗi nhà một mã | Phương án 2: một mặt hàng, nhà cung cấp là thuộc tính của lô và của phiếu nhập |
|---|---|---|
| Tồn của "Đinh M10" | Tách đôi; muốn biết tổng phải cộng hai mã | Một số tồn, chia theo lô |
| Báo cáo, định mức tồn min/max | Theo từng mã; định mức tổng khó đặt | Theo một mã |
| Vật tư cần cho công việc, định mức bảo trì, đơn bán của CRM | Phải chọn đúng mã nhà nào, dễ chọn sai | Chọn một mã duy nhất |
| Xuất theo hạn dùng (FEFO) | Không xuyên qua hai mã | Xuyên qua mọi lô của mã |
| Giá nhập, mã hàng riêng của từng nhà | Mỗi mã giữ riêng, tự nhiên | Giá nằm ở dòng nhập; mã riêng của nhà chưa có chỗ |
| Chất lượng khác nhau giữa hai nhà | Theo dõi qua hai mã | Theo dõi qua hai lô (cơ chế sẵn có) |
| Quay lại gộp khi khai nhầm | Rất khó: lịch sử sổ cái chỉ ghi thêm, không gộp được | Không phát sinh việc gộp |
| Phù hợp khi | Hai nguồn thực chất là **hai sản phẩm** (khác quy cách, thương hiệu, nhà sản xuất) | Hai nguồn là **cùng một sản phẩm** mua từ nhiều nơi |

**Đề xuất: phương án 2 là mặc định**, theo quy tắc: *cùng sản phẩm khác nguồn mua thì một mặt hàng, hai lô; khác sản phẩm
(quy cách, thương hiệu) thì hai mặt hàng.* Tenant nào muốn phương án 1 vẫn tự làm được, không có gì ngăn; tài liệu hướng
dẫn chỉ ghi rõ cái giá phải trả ở bảng trên.

Góc nhìn nhiều tenant (một schema chung, khác biệt nằm ở dữ liệu cấu hình):

| Kiểu tenant | Thực tế | Cấu hình phù hợp |
|---|---|---|
| Thương mại, phân phối | Một hàng mua nhiều nhà, chất lượng mỗi nhà khác nhau | Phương án 2; bật nhà cung cấp trong trường định danh lô |
| Nhà máy, bảo trì | Phụ tùng chính hãng, thường một nguồn | Phương án 2; tắt nhà cung cấp khỏi trường định danh, lô chỉ phân biệt theo số lô và hạn dùng |
| Xây lắp, vật tư dự án | Mua nơi nào rẻ, không cần theo lô | `tracking_mode = NONE`; nhà cung cấp chỉ ghi ở phiếu nhập |
| Tenant muốn mã hàng theo nhà cung cấp | Giá và mã khác nhau từng nhà | Phương án 1, chấp nhận tồn bị tách |

**Nhà cung cấp quản lý ra sao để làm trường định danh được.** Hiện là chữ tự do ở cả bốn nơi, nên "Cty A", "Công ty A", "CÔNG TY A"
là ba lô khác nhau. Đề xuất:

1. **Danh mục nhà cung cấp trong Cài đặt**, theo cơ chế `catalog.*` đã có (cạnh `catalog.unit`, `catalog.trade`). Người nhập
   chọn bằng `SearchableSelect`. Không tạo bảng nhà cung cấp mới trong Kho, vì chưa biết nhà cung cấp nên thuộc Kho, CRM hay Finance (luật 4: không ghi vào
   schema phân hệ khác).
2. Cài đặt tenant `supplier.input`: **`CATALOG_ONLY` là mặc định** (chỉ chọn từ danh mục, đã chốt). `CATALOG_OR_FREE` (chọn hoặc gõ tự do)
   vẫn là giá trị cấu hình được cho tenant nào muốn.
   **`CATALOG_ONLY` chỉ có hiệu lực khi danh mục có ít nhất một nhà cung cấp.** Danh mục rỗng thì vẫn cho nhập tự do, để tenant
   hiện có không bị chặn nhập kho trước khi kịp tạo danh mục.
3. **Khóa so sánh chuẩn hóa** khi xét định danh lô: bỏ khoảng trắng thừa, không phân biệt hoa thường, bỏ dấu và dấu câu.
   Khi chọn từ danh mục thì giá trị lưu đúng tên trong danh mục, nên không lệch.
   Viết tắt ("Cty A") **không** được coi là cùng khóa với "Công ty A"; chỉ khác biệt về hoa thường, dấu, dấu câu và khoảng trắng mới được gộp.
4. `materials.supplier` giữ nguyên, đóng vai "nhà cung cấp mặc định/ưu tiên" để điền sẵn khi nhập; không còn là nơi quyết
   định nhà cung cấp của lô.
5. Khi sau này có danh mục nhà cung cấp dùng chung (CRM hoặc Finance), thêm cột `supplier_ref` tùy chọn cho lô và phiếu;
   chữ đã lưu giữ làm bản chụp. Việc đó nằm ngoài kế hoạch này.

**Hệ quả của `CATALOG_ONLY`.** Vì dữ liệu cũ và các đường nhập khác là chữ tự do, cần xử lý để không chặn công việc:

| Đường nhập | Xử lý |
|---|---|
| Form nhập kho, form lô | Ô nhà cung cấp là `SearchableSelect` chỉ liệt kê danh mục. **Không có thêm nhanh.** Không tìm thấy thì ô hiện "Chưa có trong danh mục. Nhờ người quản lý thêm ở Cài đặt", người dùng chọn nhà cung cấp khác hoặc thêm ở Cài đặt rồi quay lại sửa |
| Excel | Nhà cung cấp trong file không có trong danh mục (sau khi chuẩn hóa) là **lỗi dòng**, thông báo "Nhà cung cấp "X" chưa có trong danh mục". **Không thêm nhanh ở bảng xem trước**: người dùng sửa file hoặc nhờ người quản lý thêm vào danh mục ở Cài đặt, rồi nạp lại. Tên khớp sau chuẩn hóa thì tự nhận đúng tên trong danh mục |
| API và tích hợp | Từ chối giá trị ngoài danh mục với mã lỗi riêng và thông báo tiếng Việt |
| Dữ liệu cũ (chữ tự do ở `materials.supplier`, `lots.supplier`, `counterparty_name` loại `SUPPLIER`) | Giữ nguyên, không sửa tự động, vẫn hiển thị. Tạo danh mục ban đầu bằng nút "Nhập từ dữ liệu cũ" trong Cài đặt: liệt kê các giá trị khác nhau (đã chuẩn hóa, gộp biến thể), quản trị viên duyệt rồi thêm vào danh mục. Khi sửa một lô có giá trị cũ ngoài danh mục thì phải chọn lại từ danh mục |
| Đổi tên hoặc xóa một nhà cung cấp trong danh mục | Không đổi các lô và phiếu đã lưu (chữ là bản chụp). Xóa khỏi danh mục chỉ khiến giá trị đó không chọn được nữa |

### 6.2 Định danh lô: cấu hình theo tenant, người dùng quyết định khi nhập

Đã chốt: khác một trường định danh là khác lô. **Nhưng việc xử lý từng trường hợp do tenant đặt mặc định và người dùng
quyết định, không cứng.**

**Trường định danh** (tenant chọn tập con, số lô luôn được tính): nhà cung cấp, ngày sản xuất, hạn dùng, số chứng chỉ (CO/CQ).
Mặc định bật cả bốn. Ghi chú không thuộc định danh.

**Bốn trường hợp** khi nhập vào một số lô đã có. So sánh từng trường định danh giữa lần nhập và lô hiện có:

| Trạng thái của từng trường | Ý nghĩa |
|---|---|
| Trùng | Hai bên cùng giá trị (sau khi chuẩn hóa) |
| Khác | Hai bên cùng có giá trị nhưng khác nhau |
| Lô trống | Lô chưa khai, lần nhập có giá trị |
| Nhập trống | Lô đã có giá trị, lần nhập để trống |

Trường hợp xét theo cả lần nhập: có **ít nhất một trường Khác** thì là trường hợp 2; ngược lại, các trường còn lại xử
lý theo từng trường theo trường hợp 3 và 4; không có gì khác biệt thì là trường hợp 1.

| # | Trường hợp | Cách xử lý có thể chọn | Mặc định tích hợp sẵn |
|---|---|---|---|
| 1 | Trùng hết | **Gom vào lô hiện có** (thêm một dòng chứng từ cùng `lot_id`, cộng tồn lô); **Tạo lô mới** (hệ thống đặt số lô kèm hậu tố `-02`...) | Gom |
| 2 | Khác ít nhất một trường | **Tạo lô mới** (số lô kèm hậu tố gợi ý); **Gom, giữ thông tin của lô**; **Gom và cập nhật lô theo lần nhập** (sửa các trường khác biệt trên lô) | Tạo lô mới |
| 3 | Lô trống, lần nhập có | **Điền bổ sung vào lô**; **Tạo lô mới**; **Gom nhưng để lô trống** | Điền bổ sung |
| 4 | Lần nhập trống, lô có | **Kế thừa thông tin của lô**; **Tạo lô mới**; **Gom và xóa trắng trường đó trên lô** (có xác nhận) | Kế thừa |

Cài đặt tenant `lot.identity` (lưu trong `module_settings`, khóa lạc quan theo phiên bản sẵn có):

- `fields`: tập trường định danh.
- Với mỗi trường hợp 1 đến 4: `default` (một trong các cách xử lý ở bảng, hoặc `ASK` nghĩa là hỏi người dùng) và
  `allowOverride` (người dùng có được chọn cách khác ở từng lần nhập không).
- Đổi cài đặt chỉ áp dụng cho các lần nhập về sau, không đổi lô đã có.
- Quyền sửa cài đặt: `inventory.manage` như các cài đặt khác của Kho.

**Khi nhập kho:**

- Gặp trường hợp mà tenant đặt `ASK`, hoặc `allowOverride = true`, giao diện hiện hộp thoại: "Số lô L2411 đã có", bảng so sánh các
  trường khác biệt, và các cách xử lý (nút chọn). Có tùy chọn "áp dụng cho các dòng còn lại của phiếu".
- `allowOverride = false` thì cách mặc định được áp dụng ngầm, không hỏi.
- Server là nơi quyết định: dòng nhập mang `lotResolution` tùy chọn. Nếu thiếu và tenant đặt `ASK`, server trả `409` với mã
  `LOT_RESOLUTION_REQUIRED` kèm trường hợp và bảng so sánh, để giao diện hỏi rồi gửi lại. Client không có giao diện (API,
  tích hợp) gửi thẳng `lotResolution`.
- **Excel:** thêm cột tùy chọn "Xử lý lô". Để trống thì dùng mặc định của tenant; riêng `ASK` không hỏi được trong file nên
  dùng mặc định tích hợp sẵn và hiển thị cảnh báo ở bảng xem trước, người dùng đổi cột "Xử lý lô" rồi nạp lại.
- Mỗi lần xử lý ghi một dòng vào nhật ký (mục 6.4) với `event_type` là `LOT_MERGED`, `LOT_CREATED`, `LOT_UPDATED`
  hoặc `LOT_FIELD_FILLED`, và `detail` ghi trường nào đổi từ giá trị nào sang giá trị nào. Đây cũng là lịch sử sửa lô.

### 6.3 Quản lý lô: tạo, xem, sửa, xóa

Hiện chỉ có đọc và đổi chất lượng. Bổ sung đủ:

| Thao tác | API | Quy tắc |
|---|---|---|
| Tạo | `POST /v1/lots` | Tạo lô trước khi nhập (ví dụ khai lô tồn đầu kỳ). Vẫn tuân thủ duy nhất `(material_id, lot_no)`. Lô cũng được tạo gián tiếp khi ghi sổ nhập (mục 6.2) |
| Xem | `GET /v1/lots`, `GET /v1/lots/:id`, `GET /v1/lots/suggest` (đã có) | Bổ sung lọc theo số lô, nhà cung cấp, khoảng ngày sản xuất, khoảng hạn dùng, trạng thái chất lượng, đã ngừng dùng; `GET /v1/lots/:id/timeline` cho dòng thời gian |
| Sửa | `PATCH /v1/lots/:id` | Sửa số lô (vẫn duy nhất), nhà cung cấp, ngày sản xuất, hạn dùng, số chứng chỉ, ghi chú. Mỗi lần sửa ghi nhật ký với giá trị cũ và mới. Đổi chất lượng vẫn qua `POST /v1/lots/:id/quality` |
| Ngừng dùng | `POST /v1/lots/:id/archive`, `.../restore` | Lô đã phát sinh dữ liệu không xóa được thì ngừng dùng: ẩn khỏi danh sách chọn khi nhập và xuất, giữ nguyên lịch sử. Cột mới `lots.archived_at` |
| Xóa | `DELETE /v1/lots/:id` | Chỉ khi lô **chưa có** dòng chứng từ, tồn, sự kiện chất lượng và dòng nhật ký. Ngược lại từ chối, thông báo tiếng Việt kèm gợi ý "ngừng dùng" |

- Tất cả kiểm quyền ở server qua guard của Kho (luật 2). Quyền xóa theo cách Kho đã cấp quyền xóa ở nơi khác (quyền
  xóa cấp đích danh, không đi theo `manage`); xác định action cụ thể khi làm (mục 11), không thêm danh sách quyền mới.
- Sửa nhà cung cấp, ngày, hạn dùng của lô **không** làm đổi lô khác đã có; định danh chỉ được so sánh ở lần nhập tiếp theo.
- Giao diện: màn Lô có bảng với bộ lọc ở trên, nút thêm, sửa, ngừng dùng, xóa; ô chọn nhà cung cấp dùng `SearchableSelect`.
- Cũng đưa vào hạng mục này: ô Số lô ở form nhập là danh sách chọn các lô còn dùng của mặt hàng kèm tạo mới; chọn lô có sẵn
  thì điền sẵn thông tin lô.

### 6.4 Bảng `inventory_schema.material_activity_log`

Một bảng cho cả hai đối tượng.

| Cột | Ý nghĩa |
|---|---|
| `id`, `created_at` | |
| `material_id` | Mặt hàng |
| `subject_type` | `SERIAL` hoặc `LOT` |
| `serial_id`, `lot_id` | Đúng một trong hai có giá trị theo `subject_type` (CHECK) |
| `event_type` | Chuỗi khóa, ví dụ `SOLD`, `MAINTENANCE`, `INSPECTION`, `STATUS_CHANGE`, `NOTE`, `LOT_MERGED`, `LOT_CREATED`, `LOT_UPDATED`, `LOT_FIELD_FILLED`. Không có CHECK; giao diện đổi khóa lạ thành chữ gốc |
| `event_at` | Thời điểm sự việc xảy ra |
| `title` | Một dòng tóm tắt tiếng Việt, ví dụ "Bán cho Công ty A theo đơn DH-0123" |
| `detail` | **Ghi chú chi tiết, văn bản dài, có thể rỗng** (mục 6.5) |
| `party_name`, `party_ref` | Đối tác liên quan: tên chụp lại lúc ghi và mã tham chiếu |
| `source_module` | `inventory`, `manual`, sau này `crm`, `maintenance`... |
| `ref_type`, `ref_id` | Chứng từ hoặc phiếu gốc ở module nguồn |
| `actor_user_id` | Người thực hiện, nếu có |

- Chỉ ghi thêm: trigger chặn UPDATE và DELETE, giống `serial_movements`. Ghi nhầm thì thêm dòng đính chính.
- Duy nhất `(source_module, ref_type, ref_id, event_type, subject_type, coalesce(serial_id, lot_id))` khi có `ref_id`, để
  nguồn gọi lặp lại không nhân đôi.
- **Dòng thời gian** = hợp các nguồn, sắp theo thời gian:
  - Serial: `serial_movements` + `material_activity_log`.
  - Lô: các dòng `stock_document_lines` có `lot_id` (từng lần nhập, từng lần xuất) + `lot_quality_events` + `material_activity_log`.
- Hiển thị ở `serial-panel.tsx` và `lot-panel.tsx`; **ẩn khi công tắc tenant tương ứng tắt**.

### 6.5 Ai ghi vào nhật ký

| Nguồn | Cách ghi |
|---|---|
| Kho: đổi `current_status`; xử lý lô khi nhập; sửa lô | Ghi trực tiếp trong cùng transaction. **Đổi chất lượng không ghi vào đây** vì `serial_movements` và `lot_quality_events` đã ghi |
| Ghi chú tay | Người dùng Kho thêm trên dòng thời gian (mục 6.6) |
| **Module khác qua API** (về sau) | API nội bộ `POST /v1/internal/material-activity` nhận một dòng gồm `subjectType`, mã serial hoặc số lô, `eventType`, `eventAt`, `title`, **`detail` (ghi chú)**, `party*`, `sourceModule`, `refType`, `refId` |

Về sau, khi bạn cung cấp trường ghi chú qua API, ví dụ **sự kiện bảo trì mang theo ghi chú**, nguồn chỉ cần gọi API nội
bộ này; **không cần đổi cấu trúc bảng**. Cột `detail` được thiết kế sẵn cho việc đó.

- API nội bộ xác thực bằng service token và `x-tenant-id` (skill `erp-permissions`); gọi lặp lại với cùng khóa ở 6.4 không
  ghi đôi.
- Nếu nguồn là sự kiện giữa module thì theo luật 4, 5: module nguồn ghi sự kiện vào outbox, một consumer ở worker gọi API
  này; Kho không ghi vào schema của CRM hay Bảo trì và ngược lại. Việc nối sự kiện CRM và Bảo trì **chưa làm trong lần này**;
  cần đọc module Bảo trì và kiểm sự kiện CRM đã phát trước.

### 6.6 Ghi chú tay

Là một dòng nhật ký do **người dùng gõ trực tiếp** trên dòng thời gian của một serial hoặc lô, cho việc mà không module
nào tự ghi. Ví dụ: "Vỏ trầy xước nhẹ khi nhập", "Khách A báo máy kêu to, đã hẹn kiểm tra tuần sau". Chính là dòng
`event_type = NOTE`, `source_module = manual`, nội dung nằm ở `detail`.

- Dùng quyền ghi của Kho hiện có; người ghi và thời điểm tự lưu.
- Không sửa, không xóa. Ghi sai thì thêm một ghi chú đính chính.

### 6.7 Hạng mục

| Hạng mục | Nội dung | Phụ thuộc |
|---|---|---|
| C1 | Bảng `material_activity_log` (kèm `detail`), API đọc dòng thời gian của serial và của lô (hợp nhiều nguồn) | B1 |
| C2 | Màn dòng thời gian ở `serial-panel.tsx`, `lot-panel.tsx`, ẩn theo công tắc tenant | C1, B3 |
| C3 | Kho tự ghi dòng khi đổi `current_status` | C1 |
| C4 | Ghi chú tay | C1 |
| C5 | API nội bộ nhận dòng nhật ký từ module khác, lặp lại được | C1 |
| L1 | Danh mục nhà cung cấp `catalog.supplier` (quản lý ở Cài đặt), cài đặt `supplier.input` (mặc định `CATALOG_ONLY`), khóa so sánh chuẩn hóa, nút "Nhập từ dữ liệu cũ", báo lỗi tiếng Việt khi nhà cung cấp ngoài danh mục ở form, Excel và API (mục 6.1) | không |
| L2 | Cài đặt `lot.identity`; logic bốn trường hợp ở server, mã `LOT_RESOLUTION_REQUIRED`, `lotResolution` ở dòng nhập, hộp thoại chọn cách xử lý (mục 6.2) | L1, C1 |
| L3 | CRUD lô: tạo, sửa, ngừng dùng (`archived_at`), xóa; lọc và tìm kiếm lô; màn Lô (mục 6.3) | C1, L2 |
| Hoãn | Nối sự kiện CRM và Bảo trì tới API ở C5 | Đọc module Bảo trì; chốt sự kiện |

## 7. Công việc và phụ thuộc

Không chia theo giai đoạn. Các mục làm theo thứ tự bất kỳ khi phụ thuộc đã thỏa.

| Mã | Công việc | Phụ thuộc | Migration |
|---|---|---|---|
| A1 | Bảng `material_storage_locations`, cột `warehouses.location_levels`, API mục 4.4 | không | có |
| A2 | API đọc và tìm vị trí theo mặt hàng, theo kho, toàn tenant; lọc mặt hàng theo vị trí (giao diện: tài liệu giao diện, mục 3.1, 3.2) | A1 | không |
| A3 | Kiểm kê: sao chép vị trí chính vào `bin_location`, cột Vị trí, sắp xếp, lọc; thêm `bin_location_original`; **ghi ngược khi duyệt** (mục 4.5.1) | A1 | có (cột mới) |
| A4 | Xuất, chuyển kho: hiện vị trí nguồn chỉ đọc | A1 | không |
| A5 | API hàng loạt `PUT /v1/storage-locations/bulk`; nạp chứng từ bằng Excel lưu vị trí sau khi ghi sổ (mục 5.7, A) | A1 | không |
| A6 | Chế độ Excel chỉ nạp vị trí (mục 5.7, A); đề xuất làm cùng A5 | A5 | không |
| B1 | `tracking_mode`, backfill, CHECK, bảng lịch sử đổi, giữ `is_serialized` đồng bộ | không | có |
| B2 | Gợi ý theo nhóm khi tạo hàng, dịch vụ cố định `NONE` (giao diện: tài liệu giao diện, mục 3.5) | B1 | không |
| B3 | Công tắc tenant `tracking.*.enabled` (mặc định tắt) và `capabilities` | B1 | không |
| B4 | Ghi sổ đọc `tracking_mode`, cài đặt `tracking.enforcement` mức `warn` rồi `block` | B1, B3 | không |
| B5 | Quy tắc đổi cách theo dõi và thông báo lỗi | B1 | không |
| B6 | Excel: cột Cách theo dõi, cột Số serial, cột Xử lý lô, kiểm theo `tracking_mode` (mục 5.7, B; 6.2) | B1, B4, L2 | không |
| C1 đến C5 | Nhật ký vòng đời serial và lô (mục 6.7) | B1; C2 cần B3 | C1 có |
| L1 đến L3 | Nhà cung cấp, định danh lô, CRUD lô (mục 6.7) | xem mục 6.7 | L3 có (`lots.archived_at`) |

A và B độc lập nhau. Số migration kế tiếp: `0025-material-vat-rate` đã có trên `dev/release`, nên A1 dùng `0026`, B1 dùng
`0027`, A3 dùng `0028`, C1 dùng `0029`, L3 dùng `0030` (kiểm lại số lớn nhất sau khi rebase; nhánh khác có thể đã lấy số).

## 8. Kiểm thử, tương thích ngược, rollback

- Test Jest cạnh code cho: luật duy nhất và vị trí chính (A1), từ chối kho ảo và dịch vụ (A1), sao chép vị trí vào kiểm
  kê (A3), **ba nhánh ghi ngược khi duyệt** (không đổi, đổi bình thường, vị trí chính bị người khác sửa) (A3), chuẩn hóa
  và tách cấp vị trí từ Excel, ô trống không xóa dữ liệu (A5), quy tắc Excel ở mục 5.7 gồm serial trùng và số lượng serial
  lệch số lượng (B6), backfill ba nhánh và trường hợp xung đột (B1), CHECK theo `kind` (B1), từ chối đổi khi còn tồn
  (B5), mức `warn` và `block` (B4).
- **Lô:** khóa so sánh nhà cung cấp chuẩn hóa ("Công ty A", "CÔNG TY A " và "Cong ty A." cùng khóa; "Cty A" khác khóa) (L1); **bốn trường
  hợp × mọi cách xử lý** của mục 6.2, mỗi tổ hợp một test (gom, tạo mới có hậu tố kế tiếp chưa dùng, cập nhật lô, điền
  bổ sung, kế thừa, xóa trắng); thứ tự ưu tiên khi nhiều trường ở trạng thái khác nhau; `allowOverride = false` áp dụng
  ngầm; `ASK` trả `409 LOT_RESOLUTION_REQUIRED` rồi gửi lại với `lotResolution` thì thành công; Excel với `ASK` dùng mặc
  định tích hợp sẵn kèm cảnh báo (L2); tạo, sửa, ngừng dùng, xóa lô và các điều kiện từ chối, số lô sửa vẫn duy nhất (L3).
- **Nhật ký:** chỉ ghi thêm, ghi lặp không nhân đôi, CHECK đúng một trong `serial_id` và `lot_id`, API nội bộ cần service
  token, dòng thời gian của lô gộp đúng nhiều lần nhập (C1, C5), ẩn khi công tắc tắt (C2), có quyền và không có quyền ở API.
- Trước khi mở PR: `pnpm nx affected -t lint typecheck test --base=origin/dev/release`, `pnpm nx sync:check`,
  `node tools/check-migrations.mjs`, `node tools/check-ui-rules.mjs`, `node tools/sync-agent-skills.mjs --check`.
- Rollback chỉ lùi image: bảng mới và cột mới bị bản cũ bỏ qua; `is_serialized` được giữ đồng bộ nên bản cũ vẫn ép đúng serial.
  Quy tắc định danh lô nằm ở tầng ứng dụng nên bản cũ chỉ đơn giản không kiểm. `lots.archived_at` là cột thêm, bản cũ bỏ
  qua nên lô đã ngừng dùng vẫn hiện ở bản cũ.
- Mặc định `NONE`, công tắc tắt và mức `warn` giữ hành vi cũ cho tenant chưa cấu hình.

## 9. Ngoài phạm vi

- Cây vị trí, tồn theo vị trí, chứng từ chuyển vị trí, kiểm kê theo từng vị trí (mục 4.6).
- Giá trị `tracking_mode` kết hợp lô và serial; số lô nhà sản xuất trên serial.
- Danh mục nhà cung cấp dùng chung giữa các phân hệ và bảng `material_suppliers` (mã hàng, giá riêng của từng nhà); mục 6.1 chỉ đặt chỗ để thêm cột `supplier_ref` sau.
- Gộp hai lô thành một, tách một lô thành hai.
- Danh mục trạng thái sử dụng do tenant khai, người giữ hiện tại của serial, truy xuất xuôi và ngược, công việc nền báo lô
  cận hạn, lịch bảo trì định kỳ (do module Bảo trì giữ). Có thể thêm sau trên nền nhật ký ở mục 6.
- Nối sự kiện CRM và Bảo trì vào nhật ký (API ở C5 đã sẵn sàng, phần nối để sau).
- `inventory_managed` riêng (đã có `kind`), mở rộng enum `category`, đổi sang `category_id`.
- Bộ phân loại tùy chỉnh và nhãn thay `tradeCategory`: là refactor riêng, kéo theo CRM (CRM còn dùng nhóm cố định). Không
  thêm `tradeCategory2`, `tradeCategory3` trong lúc chờ.
- Đổi tên `lots`, `serial_tracking`; xóa `lot_tracking`, `is_serialized`.
- Luồng khai báo serial hoặc lô cho tồn cũ.

## 10. Câu hỏi mở

Không còn câu hỏi mở về thiết kế. Mô hình nhà cung cấp, trường định danh lô và cách xử lý bốn trường hợp đã chốt.

Ba điểm đã xác nhận về danh mục nhà cung cấp:

1. Nhà cung cấp mới **chỉ được thêm ở Cài đặt** (người có quyền sửa danh mục hàng hóa). Form và Excel **không thêm nhanh**;
   gặp nhà cung cấp ngoài danh mục thì báo lỗi, người dùng sửa lại.
2. Dữ liệu nhà cung cấp cũ **không tự sửa**; tạo danh mục ban đầu bằng nút "Nhập từ dữ liệu cũ" do quản trị viên duyệt.
3. Đổi tên hoặc xóa nhà cung cấp khỏi danh mục **không đổi** lô và phiếu đã lưu.

Đã chốt: ghi ngược vị trí khi kiểm kê; serial và lô tách nhau, có vòng đời dạng nhật ký, đều là tùy chọn của tenant, mặc
định tắt; khác một trường định danh là khác lô, cách xử lý bốn trường hợp do tenant đặt mặc định, người dùng quyết định,
có đủ tạo, xem, sửa, xóa; một mặt hàng và nhà cung cấp là thuộc tính của lô và phiếu nhập, chỉ chọn từ danh mục; vị trí từ
Excel là chữ tự do (mục 5.7); ghi chú tay giữ; nhật ký có trường `detail` và API nội bộ để module khác ghi sau; tùy chọn
Excel "Cập nhật vị trí chính theo file" mặc định tắt; chưa nối sự kiện CRM và Bảo trì.

## 11. Chưa kiểm chứng

- **Nhập vào lô đã tồn tại:** code hiện cho gom hay buộc tạo lô mới (đường ghi lô ở `postgres-stock-tracking.ts`), và chỗ
  nào của luồng ghi sổ là nơi đặt logic bốn trường hợp.
- **Bán cho khách:** serial xuất cho đơn của CRM đã ghi `source_type`, `source_id` trong `serial_movements` chưa; nếu có thì
  dòng thời gian đã hiện được "xuất theo đơn nào" mà chưa cần nhật ký.
- **Module Bảo trì** chưa được đọc; phần nối sự kiện về sau là giả định, chưa biết module có sự kiện dùng được hay không.
- **CRM**: chưa kiểm sự kiện giao hàng hoặc bán serial đã phát có đủ dữ liệu cho việc nối về sau.
- **Cột "Vị trí" trong nạp Excel** có được lưu sau khi ghi sổ không (theo mục 2.1, nhiều khả năng không; cần xác nhận khi làm A5).
- **Đường nhập danh mục** riêng (mục 5.7, C) có tồn tại và dùng thế nào.
- **Số mặt hàng** hiện vừa `is_serialized` vừa có lô trên các tenant thật (quyết định mức ảnh hưởng của migration B1).
- Số migration kế tiếp có thể đã bị nhánh khác dùng.

## 12. Kết quả triển khai (2026-11-21)

Tất cả nằm trong nhánh cục bộ tách từ `origin/dev/release`, **chưa push**. Nhánh tích hợp thử `test/inventory-integration` đã gộp ba nhánh đầu.

| Nhánh | Worktree | Hạng mục | Migration |
|---|---|---|---|
| `feat/inventory-storage-locations` | `D:\CRM\ep-loc` | A1, A2, A3, A5; A4 hiển thị vị trí chính ở phiếu xuất | `0026`, `0028` |
| `feat/inventory-tracking-mode` | `D:\CRM\ep-track` | B1, B2, B3, B5 | `0027` |
| `feat/inventory-supplier-catalog` | `D:\CRM\ep-supplier` | L1 | không |
| `feat/inventory-tracking-enforcement` | `D:\CRM\ep-enforce` | A4 (vị trí và số vị trí phụ), A5, A6 (chỉ nạp vị trí), B4 (`tracking.enforcement`), B6 (cột Cách theo dõi, Số serial) | không |
| `feat/inventory-lot-lifecycle` | `D:\CRM\ep-lot` | C1 đến C5, L2, L3, cột Excel Xử lý lô | `0029`, `0030` |

Hai nhánh cuối tách từ `test/inventory-integration`, nên gộp chúng phải gộp ba nhánh đầu trước.

### 12.1 Đã xác minh

- **Quyền:** Kho không có action riêng cho sửa danh mục; guard rơi về `inventory.manage` cho mọi request ghi. Dùng cho vị trí, cài đặt, danh mục nhà cung cấp, tạo, sửa, ngừng dùng và xóa lô. Ghi chú tay dùng `inventory.transaction.write`.
- **Chứng từ kho** không có trường nhà cung cấp; nhà cung cấp chỉ ở lô trên dòng chứng từ và ở bên giao hàng của các API cũ.
- **Server không dùng nhóm để quyết định lô:** `LOT_REQUIRED` suy từ số dư lô.
- Kho không có endpoint `capabilities`; công tắc tenant đọc qua `GET /v1/settings`.

### 12.2 Khác với kế hoạch lúc viết

- **Vị trí:** API dùng mã (`:code`, `:warehouseCode`); thêm `GET /v1/storage-locations`; vị trí là một nhóm trong drawer hàng hóa, không phải tab; duyệt kiểm kê ghi ngược tự động, không có hộp thoại chọn.
- **Theo dõi:** trigger `materials_sync_tracking_mode` giữ `is_serialized` khớp `tracking_mode`; công tắc chỉ kiểm khi request gửi `trackingMode` rõ ràng; `tracking.enforcement` mặc định `WARN`, `BLOCK` trả mã `TRACKING_REQUIRED`; chứng từ đảo và điều chỉnh kiểm kê không bị kiểm.
- **Nhà cung cấp:** `CATALOG_ONLY` chỉ có hiệu lực khi danh mục không rỗng; mã lỗi `SUPPLIER_NOT_IN_CATALOG`; tên tối đa 180 ký tự, danh mục tối đa 500 mục.
- **Lô:** nhập cùng số lô mà thông tin định danh khác không còn lỗi `LOT_ATTRIBUTE_CONFLICT` mà tạo lô `-02` (mặc định); xử lý định danh chỉ chạy cho nhập mua và nhập khác, nhập điều chuyển và nhập trả hàng bán chỉ tham chiếu lô có sẵn; xử lý diễn ra lúc lập phiếu nháp nên phiếu nháp bị hủy vẫn để lại lô; lô ngừng dùng bị chặn nhập, xuất mới (`LOT_ARCHIVED`); xóa lô có phát sinh trả `LOT_HAS_ACTIVITY`.
- **Nhật ký:** `material_activity_log` chỉ ghi thêm (trigger chặn sửa, xóa); dòng thời gian gộp nhiều nguồn, không ghi đôi việc đổi chất lượng.

### 12.3 Còn thiếu và việc cần quyết định

- **Chưa nối** sự kiện CRM và Bảo trì tới `POST /v1/internal/material-activity` (đã hoãn).
- **Excel nhập kho:** nhà cung cấp, ngày sản xuất, số chứng chỉ chưa được đọc từ tệp; serial đã có sẵn trong hệ thống chưa được kiểm trước (server từ chối `SERIAL_DUPLICATE` khi nạp); mặt hàng mới không có cột Cách theo dõi là `NONE`, chưa gợi ý theo nhóm; hộp thoại Excel mở từ phiếu nhập xuất dùng mức `WARN` mặc định.
- **Đường nhập kho cũ** (`receiveStock`) bị chặn khi `BLOCK` nhưng không trả `warnings`.
- **Thiết bị (tài sản)** có trường `supplier` chưa gắn kiểm danh mục.
- **Lỗi có sẵn, chưa sửa:** `requireManager` ném `INVALID_RESERVATION` khi thiếu quyền; 7 test của `inventory-web` (`trade-import`, `permissions`, `trade-items`, `stock-document-screens`) fail trên nhánh tích hợp trước khi sửa.
- **Gộp nhánh:** các nhánh cùng sửa `inventory-settings.ts`, `excel-import-dialog.tsx`, `movement-form.tsx`, `inventory-screen.tsx`, `inventory-api.ts`, `tenant-migrations.ts`; sẽ có conflict văn bản khi gộp `feat/inventory-tracking-enforcement` với `feat/inventory-lot-lifecycle`.
- **Số mặt hàng vừa serial vừa có lô** chưa biết; migration `0027` in danh sách mã khi chạy.
