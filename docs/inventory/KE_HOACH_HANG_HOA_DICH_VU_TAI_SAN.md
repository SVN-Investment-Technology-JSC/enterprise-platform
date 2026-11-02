# Kế hoạch: phân tách hàng hóa, dịch vụ và tài sản trong danh mục Kho

Trạng thái: **đề xuất, chưa triển khai**. Phạm vi: phân hệ Kho (`inventory`) và những nơi đọc danh mục của Kho.
Tài liệu này tổng hợp phần thảo luận thiết kế; mọi mục "Hiện trạng" đã đối chiếu với code và migration, mục "Chưa kiểm
chứng" nêu rõ phần còn lại.

Liên quan: [DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT.md](../DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT.md) (công tắc lô/sê-ri
theo tenant và cột `tracking_mode`), [THIET_KE_CHUC_NANG_KIEM_KE_KHO.md](../THIET_KE_CHUC_NANG_KIEM_KE_KHO.md).

## 1. Mục tiêu và nguyên tắc

Quản lý ba nhóm đối tượng **hàng hóa, dịch vụ, tài sản** theo cách mỗi tenant có thể triển khai khác nhau, mà không
phải rẽ nhánh code theo tenant.

- **Tách bản chất khỏi chính sách.** Bản chất (có tồn kho không, có định danh cá thể không) cố định và do nền tảng
  bảo vệ. Chính sách (bật tính năng nào, nhóm phân loại, ngưỡng cảnh báo) do tenant cấu hình.
- **Một schema cho mọi tenant.** Tùy biến nằm ở dữ liệu cấu hình, không ở cấu trúc bảng; mọi đổi schema qua migration
  mới, chạy lại được.
- **Mặc định tối giản.** Tenant không bật gì thì chỉ thấy phần cốt lõi.
- **Hành vi quyết định bởi `kind`, phân loại quyết định bởi nhóm.** Không gộp hai vai trò vào một trường.

## 2. Quyết định đã chốt

| # | Quyết định | Ghi chú |
|---|---|---|
| 1 | Ba nhóm lõi: hàng hóa, tài sản, dịch vụ | Các hình thức khác (bộ, hàng sở hữu của bên khác, cho thuê...) là thuộc tính, không phải loại mới |
| 2 | Hàng hóa và dịch vụ **không gom chung** bộ trường, vì đặc thù khác nhau | Phân biệt bằng `kind` |
| 3 | Vật tư và tài sản gom chung danh mục vật chất, phân biệt bằng một **cờ gán** | Cờ nằm ở cá thể, mặc định theo loại (xem mục 6.4) |
| 4 | Dịch vụ không dùng `minStock`, `maxStock`, `isSerialized`; giữ cột trong DB, không xóa | Xóa cột là bước cuối của quá trình, không làm trong đợt này (mục 7) |
| 5 | Trường "hình thức quản lý" của dịch vụ: để `NONE`, không bắt buộc | Chỉ thêm giá trị khi có nhu cầu cụ thể (mục 6.3) |
| 6 | Module Bảo trì giữ lịch và nhắc việc; **các bước, giai đoạn bảo trì và kiểm định do Kho định nghĩa** | Ngoài phạm vi đợt này (mục 9) |

## 3. Hiện trạng đã xác minh

### 3.1 Bảng `inventory_schema.materials`

Một bảng, cột `kind` có ba giá trị `STOCK`, `ASSET`, `SERVICE` (migration `0006`, `0017`). Dịch vụ:

- cho phép `category` trống; `unit` được phép trống ở DB nhưng `createMaterial` bắt buộc có đơn vị cho mọi loại
  ([inventory.application.ts:1241](../../packages/modules/inventory/src/lib/application/inventory.application.ts#L1241));
- bị trigger `reject_service_balance` chặn dòng tồn, nhưng trigger chỉ đặt trên `material_inventory`; chưa thấy chỗ
  nào chặn dịch vụ ở `lots`, `lot_balances`, `serial_tracking`;
- vẫn mang các cột của hàng và tài sản (`serial_number`, `qr_code`, `parent_id`, `criticality`, `specs`,
  `task_template`, `assigned_employee_id`, `asset_category`, `purchase_price`...). Các cột kiểu tài sản chưa có
  chỗ nào chặn.

`category` bị khóa bằng CHECK vào bốn giá trị của hàng (`SPARE_PART`, `CONSUMABLE`, `TOOL`, `ROTABLE`), nên dịch vụ
chưa có cách phân nhóm.

### 3.2 Ba trường tồn và serial

| Trường | Là chốt chặn? | Dùng ở |
|---|---|---|
| `min_stock` | Không, chỉ cảnh báo | Sự kiện `inventory.stock.low` sau mỗi lần ghi sổ ([postgres-stock-document.store.ts:1366](../../packages/modules/inventory/src/lib/infrastructure/postgres-stock-document.store.ts#L1366), [postgres-inventory-store.ts:1237](../../packages/modules/inventory/src/lib/infrastructure/postgres-inventory-store.ts#L1237)), dashboard, danh mục, Excel |
| `max_stock` | Không | Chỉ báo cáo Excel ("vượt định mức") |
| `is_serialized` | **Có** | Chứng từ kho bắt buộc nhập serial, lắp đặt, kiểm kê lô và serial |

### 3.3 Cách `createMaterial` và `updateMaterial` xử lý dịch vụ

- **Tạo:** ép `minStock = 0`, `maxStock = 0`, `isSerialized = false`; từ chối `isSerialized = true`
  ([inventory.application.ts:1260](../../packages/modules/inventory/src/lib/application/inventory.application.ts#L1260)).
- **Cập nhật:** **không ép**. Gửi `minStock = 5` cho một dịch vụ vẫn lưu được
  ([inventory.application.ts:1264](../../packages/modules/inventory/src/lib/application/inventory.application.ts#L1264)).
  `requireStockBounds` cũng chạy trước khi xét `kind`.
- Đổi `kind` giữa hàng và dịch vụ bị chặn khi mã đã có tồn, bút toán, giữ hàng hoặc serial.

### 3.4 "Hình thức quản lý" (lô, sê-ri) hiện chỉ là khái niệm của giao diện

Form quy đổi khi lưu ([material-form.tsx:100](../../packages/features/inventory/src/lib/components/material-form.tsx#L100)):
`SERIAL` thành `is_serialized = true`; `LOT` thành `category = 'CONSUMABLE'`; `NONE` thành `SPARE_PART`. Khi sửa thì đọc
ngược lại. Không có cột `tracking_mode` hay `is_lot_tracked` ở `materials`. Hệ quả: mọi vật tư tiêu hao hiện tự động
được coi là theo lô, và form lưu `category` theo hình thức quản lý cho cả dịch vụ.

Lô và serial của Kho gắn chặt với kho: `lot_balances` khóa theo `warehouse_id`; `serial_tracking.location_type` chỉ
nhận `WAREHOUSE`, `ASSET`, `VENDOR_REPAIR`; `serial_movements` toàn là loại di chuyển kho.

### 3.5 Nơi `kind` được dùng và ai đọc danh mục

| Nơi | Cách dùng |
|---|---|
| Kho | Khoảng 10 truy vấn lọc `kind IN ('STOCK','SERVICE')`; comment ở [postgres-inventory-store.ts:375](../../packages/modules/inventory/src/lib/infrastructure/postgres-inventory-store.ts#L375) quy định mọi truy vấn nhóm này phải lọc như vậy |
| Hợp đồng | `MATERIAL_KINDS = ['STOCK','SERVICE']`; tài sản đi qua đường API riêng |
| Danh mục nội bộ | `GET v1/internal/materials` mặc định chỉ trả `STOCK`; muốn dịch vụ phải truyền `kind=STOCK,SERVICE` ([internal-catalog.controller.ts:11](../../packages/modules/inventory/src/lib/presentation/internal-catalog.controller.ts#L11)) |
| CRM | Chụp `material_kind` vào dòng báo giá, đơn, hợp đồng (varchar 16). Bảo hành loại `SERVICE` ([postgres-warranty.store.ts:468](../../packages/modules/crm/src/lib/infrastructure/postgres-warranty.store.ts#L468)); màn giao hàng ghi "dịch vụ, không xuất kho" |
| Quy trình | Có bộ đọc HTTP `http-inventory-task-template.resolver.ts` (chưa mở) |
| Nhập Excel | Hợp đồng và bộ phân tích có cột `minStock`, `maxStock`, `isSerialized` |

Các module ngoài Kho và Bảo trì không nhắc `inventory_schema` trong code TypeScript.

## 4. Hàng hóa và dịch vụ: phân biệt bằng loại, hai bộ trường

| Phần | Trường |
|---|---|
| Chung | Mã, tên, mô tả, đơn vị, nhóm phân loại, đang dùng, bán được, mua được, thuế, bảo hành |
| Chỉ hàng | Tồn, serial, lô, hạn dùng, vị trí, giá vốn, cờ tài sản |
| Chỉ dịch vụ | Mô hình thực hiện, chu kỳ, nghiệm thu, SLA, nguồn lực, chi phí |

Phương án lưu: **bảng mở rộng 1-1** cho dịch vụ (khóa theo `material_id`, chỉ có dòng khi `kind = SERVICE`), không thêm
cột vào `materials`, vì bảng này đã khoảng 40 cột và nhiều cột chỉ dành cho tài sản.

### 4.1 Trường bổ sung cho dịch vụ

Mức P0 (thiếu thì không bán và không tính được):

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `service_model` | `TIME_BASED`, `FIXED_PRICE`, `RECURRING` | Cách tính và cách thực hiện |
| `unit` | bắt buộc với dịch vụ | Giờ, ngày công, tháng, gói (hiện chỉ app ép, DB cho NULL) |
| `service_group_id` | tham chiếu nhóm do tenant định nghĩa | `category` đang đóng cho hàng |
| `planned_cost`, `cost_basis` | số; `LABOR`, `SUBCONTRACT`, `MIXED` | Thay cho việc dùng tạm `purchase_price` |
| `acceptance_required` | boolean | Quyết định thời điểm ghi nhận doanh thu |

Mức P1: `revenue_recognition`, `executor_type`, `default_subcontractor`, `required_skill`, `estimated_effort`,
`billing_period`, `min_term_months`, `auto_renew`, `sla_response_hours`, `sla_resolution_hours`, `scope_description`.

Mức P2: `applies_to_material_id`, `service_warranty_months` (tách khỏi `warranty_months` chung), `requires_site_visit`.

### 4.2 Trường bổ sung cho hàng và trường chung

- Hàng: `tracking_mode` (`NONE`, `LOT`, `SERIAL`; xem mục 6.3), `shelf_life_days`, `storage_condition`,
  `default_warehouse_id`, cờ tài sản; `weight`, `dimensions`, `hs_code` chỉ khi tenant cần.
- Chung: `is_sellable`, `is_purchasable`, `tax_code` hoặc `vat_rate`, `description`. Giá bán mặc định chỉ thêm nếu CRM
  không giữ bảng giá (chưa kiểm tra).

### 4.3 Ràng buộc để hai loại không lẫn nhau

- Dịch vụ: `unit` và `service_model` bắt buộc; các cột tồn, serial, QR, người giữ phải trống; có đúng một dòng ở bảng
  mở rộng. Hàng: không có dòng ở bảng mở rộng.
- API: kiểu phân biệt theo `kind`, để request tạo dịch vụ không nhận `serialNumber`, `minStock`.
- Server từ chối giá trị không hợp lệ với `kind`, không lặng lẽ bỏ qua.

## 5. Dịch vụ không dùng `minStock`, `maxStock`, `isSerialized`

Giữ ba cột, dịch vụ không dùng. Không cần migration và không phá API. Việc cần làm:

| Việc | Lý do |
|---|---|
| `updateMaterial` ép ba trường về `0`, `0`, `false` khi `kind = SERVICE`, như lúc tạo | Hiện đường cập nhật lọt |
| Bỏ `requireStockBounds` với dịch vụ | Hiện chạy trước khi xét `kind` |
| Form dịch vụ ẩn ba ô nhập và lựa chọn hình thức quản lý | Hiện form gửi 0 nhưng chưa rõ có ẩn ô |
| Chặn `category = CONSUMABLE` cho dịch vụ | Tránh dịch vụ bị coi là "theo lô" qua đường mã hóa ngược |
| Kiểm tra đường nhập Excel | [postgres-inventory-store.ts:946](../../packages/modules/inventory/src/lib/infrastructure/postgres-inventory-store.ts#L946) có `INSERT` chứa ba cột này; cần xem dịch vụ nhập qua file có đi qua `createMaterial` không |

Dữ liệu trả về giữ nguyên (`minStock`, `maxStock`, `isSerialized` trả 0 và false cho dịch vụ), nên không đổi hợp đồng
API và không ảnh hưởng CRM.

**Ngưỡng cảnh báo riêng cho dịch vụ (nếu cần):** dịch vụ không có tồn nên Kho không tự tính được. Ngưỡng phải mang nghĩa
nghiệp vụ (năng lực tối đa mỗi kỳ, số giờ còn lại của gói, mốc hết hạn), dữ liệu để so sánh nằm ở CRM. Kho lưu giá trị
trên mặt hàng, CRM so sánh và phát thông báo qua sự kiện. **Không tái dùng `inventory.stock.low`** (mang nghĩa tồn dưới
ngưỡng, gắn quyền `inventory.manage`, gộp theo `materialId`, và luật 5 cấm đổi tên loại sự kiện đã phát); dịch vụ cần
loại sự kiện mới. Việc này chưa chốt nghĩa của ngưỡng nên chưa làm trong đợt này.

## 6. Các phương án và khuyến nghị theo chủ đề

### 6.1 Chỉ phân biệt bằng nhóm, bỏ `kind`: không chọn

Mọi truy vấn lọc `kind`, trigger, hai chỗ ném `ServiceMaterialNotStockedError`, bộ lọc form chứng từ sẽ phải đổi. Dòng
CRM đã chụp `material_kind = 'SERVICE'` (bảo hành, giao hàng đang đọc giá trị đó) sẽ lệch. Luật "dịch vụ không có tồn"
cần một giá trị cố định; nhóm do tenant tự sửa nên không làm căn cứ chặn được. **Giữ `kind` làm trường hành vi (cố định,
ít giá trị), dùng nhóm làm trường phân loại.**

### 6.2 Xóa ngay ba cột bằng migration: không chọn

| Phương án | Rủi ro |
|---|---|
| A. Giữ cột, dịch vụ không dùng | Thấp. **Chọn cho đợt này** |
| B. Mở rộng rồi thu hẹp (thêm cột thay thế, chuyển code, xóa cột cũ ở đợt sau) | Trung bình. Làm khi đã chốt các câu hỏi mở |
| C. Xóa ngay | Cao. Vi phạm mục 5 của [erp-migrations](../../.agents/skills/erp-migrations/SKILL.md) (không `DROP` cột còn được đọc trong cùng đợt; rollback chỉ lùi image nên bản cũ lỗi), mất dữ liệu không khôi phục, cột là của cả bảng nên hàng hóa cũng mất |

`is_serialized` là mất mát nặng nhất vì không dựng lại được từ dữ liệu khác. Migration SQL (trừ Bảo trì) chỉ nhắc ba
cột ở `0001` và `0006`, không thấy view, trigger hay index phụ thuộc.

Nếu theo B, thứ tự: migration thêm cột mới và sao chép dữ liệu; chuyển code đọc ghi sang cột mới (API vẫn chấp nhận
trường cũ một thời gian); deploy, quan sát ở mọi tenant; đợt sau xóa cột cũ; nhập Excel chấp nhận cột cũ nhưng bỏ qua.

### 6.3 "Hình thức quản lý" (lô, sê-ri) cho dịch vụ

Với hàng, trường trả lời "hai đơn vị cùng mặt hàng nhưng khác đợt nhập, phân biệt thế nào". Dịch vụ không có đợt nhập;
câu hỏi tương ứng là "hai lần bán cùng một dịch vụ, phân biệt thế nào", và phần lớn đã được dòng đơn hoặc dòng hợp đồng
của CRM trả lời. Chỉ cần giá trị khác `NONE` khi một lần cung cấp có vòng đời riêng:

| Tình huống | Cần định danh riêng? |
|---|---|
| Ngày công, tư vấn, lắp đặt một lần | Không |
| Hợp đồng bảo trì có hiệu lực từ ngày đến ngày | Có (mã, hiệu lực, trạng thái) |
| Giấy chứng nhận, chứng chỉ kiểm định theo đợt thiết bị | Có (số chứng chỉ, hạn) |
| Bảo hành mở rộng cho một serial hàng | Có (tham chiếu serial) |

| Phương án | Giá trị cho dịch vụ | Đánh giá |
|---|---|---|
| A. Ẩn trường, mặc định `NONE` | Chỉ `NONE` | **Chọn cho đợt này** |
| B. Một trường, bộ giá trị theo loại | Hàng: `NONE`, `LOT`, `SERIAL`; dịch vụ: `NONE`, `BATCH`, `INSTANCE` | Khi đã có nhu cầu thật; ràng buộc DB theo `kind` |
| C. Dùng lại `LOT`, `SERIAL` cho dịch vụ | Giống hàng | Không chọn: kéo theo kho, chứng từ, kiểm kê |

Không cho dịch vụ vào `serial_tracking` hay `lots`: phá bất biến "dịch vụ không có tồn". Nếu sau này cần bản ghi từng lần
cung cấp, **không đặt ở Kho** (Kho chỉ giữ danh mục); đặt ở module bán và thực hiện (CRM, có thể Bảo trì), liên kết bằng
`material_id` và tùy chọn serial của hàng. Bảo hành CRM hiện loại dịch vụ, cần quyết định riêng nếu dịch vụ có serial.

Cột thật `materials.tracking_mode` (mặc định `NONE`, không bắt buộc) đã nằm trong
[DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT.md](../DE_XUAT_QUAN_LY_LO_SERIES_THEO_TENANT.md) mục 3.2 và thay cách suy ngược
qua `category`. Nên làm chung với đề xuất đó, kèm CHECK theo `kind` (hàng nhận `NONE`, `LOT`, `SERIAL`; dịch vụ hiện
chỉ nhận `NONE`). Trong giai đoạn chuyển, `is_serialized` và `tracking_mode` phải được giữ khớp nhau cho hàng.

### 6.4 Tài sản: cờ gán, ở loại hay ở cá thể

| Phương án | Ưu | Nhược |
|---|---|---|
| Cờ ở loại mặt hàng | Đơn giản | Không xử lý cùng một loại mà cái bán, cái tự dùng |
| Cờ ở cá thể, mặc định theo loại | Cho phép chuyển vai, hàng trưng bày | Cần chứng từ khi đổi cờ |

Nghiêng về cờ ở cá thể. Hàng không định danh (chỉ số lượng) không có cờ riêng.

**Cảnh báo ảnh hưởng:** tài sản (`kind = ASSET`) hiện bị loại khỏi danh mục chính chính nhờ bộ lọc
`kind IN ('STOCK','SERVICE')` (mục 3.5). Nếu chuyển tài sản thành cờ trên `kind = STOCK`, tài sản tự xuất hiện trong
danh mục nội bộ, form chứng từ, bộ chọn của CRM và báo cáo tồn. Đây phải là một thay đổi riêng, có kế hoạch lọc theo cờ.

Cấp độ quản lý tài sản khác nhau theo tenant (chỉ theo dõi người giữ; sổ tài sản cố định có khấu hao; thiết bị công trình
cần bảo trì; không dùng). Phần khấu hao nằm ngoài phạm vi, nếu cần thì xuất sang Finance.

## 7. Cấu hình theo tenant

| Tầng | Ví dụ |
|---|---|
| Mẫu ngành (starter) | Thương mại thiết bị, xây lắp, dịch vụ bảo trì |
| Bật tắt khả năng | Tài sản, lô, serial, dịch vụ chu kỳ |
| Loại mặt hàng và nhóm | Tên, bộ đặc tính, thuộc tính riêng |
| Chính sách | Ngưỡng ghi nhận tài sản, cách tính giá vốn, ai duyệt |

Kho đã có `inventory_schema.module_settings` (migration `0003`, khóa lạc quan theo phiên bản, `GET /v1/settings`,
`PUT /v1/settings/:key`) và đề xuất lô/sê-ri đã dùng nó cho công tắc `tracking.lot.enabled`, `tracking.serial.enabled`.
Dùng lại cơ chế này cho các công tắc mới, không tạo cơ chế thứ hai (cũng khớp luật 3 về danh sách quyền).

Ràng buộc: một schema chung; thuộc tính tùy biến lưu JSONB có mô tả kiểu và kiểm tra ở server; cấu hình có quyền riêng;
không cho đổi hoặc xóa đặc tính cốt lõi khi đã có dữ liệu; tên sự kiện giữ nguyên cho mọi tenant.

## 8. Kế hoạch triển khai

| Giai đoạn | Nội dung | Migration | Rủi ro |
|---|---|---|---|
| 0. Chốt | Các câu hỏi mở ở mục 10; nhờ người phụ trách Bảo trì xác nhận module có đọc `min_stock`, `max_stock`, `is_serialized`, `kind` | Không | Thấp |
| 1. Chuẩn hóa dịch vụ (mục 5) | Ép ba trường ở đường cập nhật; bỏ kiểm định mức với dịch vụ; ẩn ô ở form; chặn `CONSUMABLE` cho dịch vụ; kiểm đường nhập Excel; test | Không | Thấp |
| 2. Bảng mở rộng dịch vụ (mục 4) | Bảng 1-1, trường P0; nhóm dịch vụ do tenant định nghĩa; `unit` bắt buộc ở DB cho dịch vụ; kiểu API theo `kind`; ràng buộc cột tài sản phải trống | Có (file mới, chạy lại được) | Trung bình; dòng dịch vụ cũ cần giá trị mặc định |
| 3. `tracking_mode` thật và công tắc tenant | Làm chung với đề xuất lô/sê-ri; CHECK theo `kind`; dịch vụ chỉ `NONE` | Có | Trung bình; đụng chứng từ, kiểm kê |
| 4. Cờ tài sản ở cá thể | Kế hoạch lọc theo cờ thay cho `kind = ASSET`; chứng từ chuyển vai | Có | Cao; lọt tài sản vào danh mục nếu sót bộ lọc |
| 5. Dọn cột cũ (nếu muốn) | Expand/contract theo mục 6.2 | Có, ở đợt sau cùng | Cao; chỉ làm khi không còn bên đọc |
| Khi có nhu cầu | `identification_mode` cho dịch vụ, ngưỡng cảnh báo dịch vụ (sự kiện mới), bản ghi từng lần cung cấp ở CRM | Tùy | Tùy |

Mỗi giai đoạn có test cho logic mới (Jest, file `*.spec.ts` cạnh code) và chạy trước khi mở PR:

```bash
pnpm nx affected -t lint typecheck test --base=origin/dev/release
pnpm nx sync:check
node tools/check-migrations.mjs
node tools/check-ui-rules.mjs
node tools/sync-agent-skills.mjs --check
```

Ràng buộc chung: không sửa migration đã merge (`0006`, `0017`, `0019`...); mọi API kiểm quyền ở server; không ghi vào
schema phân hệ khác; sự kiện đi qua outbox; giao diện dùng `SearchableSelect`, không dùng emoji.

## 9. Ngoài phạm vi đợt này: tình trạng, bảo trì, thí nghiệm

Hướng đã bàn, chưa chốt: Kho định nghĩa loại phép kiểm và các giai đoạn, giữ tình trạng của lô và cá thể, ghi biên bản
(chỉ ghi thêm); Bảo trì giữ lịch định kỳ, nhắc việc và sự cố, kích hoạt lượt thực hiện theo các giai đoạn của Kho. Hai
module trao đổi qua API nội bộ hoặc sự kiện, không ghi vào schema của nhau. Giai đoạn do tenant cấu hình (tên, thứ tự,
hệ quả: đổi trạng thái chất lượng, chặn cấp phát hoặc xuất, bắt buộc đính kèm chứng chỉ, giai đoạn cần duyệt qua Quy
trình). Hiện có `asset_test_records` (chỉ cho tài sản, `test_type` là chữ tự do, thông số JSONB) và `lot_quality_events`;
nếu mỗi nơi tự phát triển thì khó có màn hình tình trạng tổng hợp. Tenant không bật Bảo trì vẫn phải kiểm tra được,
nên phải chốt ai nhắc đến hạn khi không có lịch.

Phần này dựa trên mô tả của người yêu cầu về Bảo trì; **module Bảo trì chưa được đọc** theo yêu cầu.

## 10. Câu hỏi mở

1. Ngưỡng cảnh báo của dịch vụ (nếu có) đo cái gì: năng lực tối đa mỗi kỳ, số giờ còn lại của gói, hay mốc hết hạn?
   Câu trả lời quyết định tên, kiểu trường và module phát thông báo.
2. Dịch vụ có cần định danh từng lần cung cấp không (hợp đồng bảo trì, chứng chỉ, bảo hành mở rộng)? Nếu có thì bản
   ghi nằm ở CRM hay Bảo trì?
3. `kind` cuối cùng còn hai giá trị (hàng, dịch vụ) kèm cờ tài sản, hay giữ ba giá trị?
4. Bộ (kit) và hàng thuộc sở hữu của bên khác (ký gửi, gia công) có vào phạm vi không? Hai hình thức này ảnh hưởng nhiều
   nhất đến giá trị tồn và doanh thu.
5. Khấu hao và sổ tài sản cố định thuộc nền tảng hay xuất sang Finance?
6. Giá bán và thuế do Kho hay CRM, Finance giữ?
7. Tenant không bật Bảo trì thì ai nhắc đến hạn kiểm định?

## 11. Chưa kiểm chứng

- **Bảo trì:** hai migration của module (`0002-inventory-integration.sql`, `0004-maintenance-settings.sql`) nhắc
  `inventory_schema`; chưa mở nên chưa loại trừ được việc module đọc các cột hoặc giá trị `kind` của Kho.
- **Quy trình:** `http-inventory-task-template.resolver.ts` có vẻ đọc `task_template`; chưa xác nhận nó gọi với `kind` nào.
- **Đọc cột ở module khác:** kết quả tìm kiếm bị cắt ở 70 dòng nên "không module nào ngoài Kho dùng ba cột" chưa tuyệt đối.
- **Form dịch vụ:** chưa mở phần hiển thị; chưa biết có ẩn lựa chọn hình thức quản lý và `category` không.
- **Đường nhập Excel** cho dịch vụ (mục 5); **`requireStockBounds`** có kiểm `min <= max` hay chỉ kiểm không âm; **số dòng
  `SERVICE` và số mặt hàng bật `is_serialized`** trên các tenant thật; **`traceability-policy.ts`**.
- Số hiệu migration kế tiếp (đã thấy `0020`; nhánh khác có thể đã dùng số cao hơn).
