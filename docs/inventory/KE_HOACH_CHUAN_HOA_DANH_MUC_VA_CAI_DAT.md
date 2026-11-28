# Kế hoạch chuẩn hoá danh mục và cài đặt giữa các phân hệ (bản nháp tạm thời)

Trạng thái: nháp để thảo luận, chưa có quyết định nào được chốt. Người lập: nhóm Kho. Ngày khảo sát: 23/11/2026.
Phạm vi khảo sát: cấu trúc bảng của 8 schema trong một DB tenant (core, crm, finance, hrm, inventory, maintenance,
procedure, social, workspace, shared). Chưa đọc từng màn hình của finance, social, workspace, maintenance.

## 1. Vì sao cần

1. Danh mục của Kho (đơn vị tính, nhóm hàng hoá và dịch vụ, trạng thái sử dụng) lưu thành mảng chuỗi trong JSON ở
   `inventory_schema.module_settings`. Vật tư tham chiếu bằng chữ (`materials.unit`, `materials.trade_category`),
   không có khoá ngoại. Đổi tên hoặc xoá một mục không cập nhật vật tư đang dùng và không biết mục đó đang dùng ở đâu.
2. CRM lưu `material_id` và `material_code` trong báo giá, đơn bán, hợp đồng, bảng giá mà không có khoá ngoại sang Kho
   (khác schema nên không làm được). Xoá hàng ở Kho để lại dòng mồ côi ở CRM.
3. Ba cách lưu khác nhau giữa các phân hệ làm người bảo trì phải học nhiều kiểu.

## 2. Hiện trạng

### 2.1 Cài đặt dạng khoá và giá trị (KV)

| Bảng | Cột | Có `version` |
|---|---|---|
| `inventory.module_settings`, `crm.settings`, `procedure.module_settings`, `maintenance.module_settings` | key, value, version, updated_by, updated_at | Có |
| `workspace.workspace_settings`, `social.settings` | key, value, updated_by, updated_at | Không |
| `finance.settings` | chưa xem cột | Chưa rõ |

`maintenance.user_preferences` là cài đặt theo người dùng, giữ riêng.

### 2.2 Danh mục dạng bảng riêng

| Phân hệ | Bảng ví dụ | `code` | Cột bật tắt | `sort_order` | Xoá mềm | `tenant_id` |
|---|---|---|---|---|---|---|
| core | `organization_node_types` | Có | `is_active` | Có | Có | Có |
| hrm | `leave_types`, `request_reasons`, `request_reason_categories` | Có | `active` | Có | Có | Có |
| crm | `pipelines`, `customer_kinds`, `document_types`, `quote_types`, `tender_partners` | Phần lớn có; `quote_types`, `tender_partners` không | `active` | Có | Không | Không |
| workspace | `project_groups`, `project_role_definitions` | Chỉ `project_groups` | Không | Có | Không | Không |
| finance | `counterparty_groups` | chưa xem | | | | |
| inventory | không có bảng, mảng JSON | Không | Không | Theo thứ tự mảng | Không | Không |

### 2.3 Điểm lệch cần thống nhất

- Tên cột bật tắt: `active` (CRM, HRM) và `is_active` (core, các bảng gốc của Kho).
- Xoá mềm chỉ có ở core và HRM; CRM xoá cứng; Kho xoá phần tử khỏi mảng.
- `tenant_id` chỉ còn ở HRM và core, vô nghĩa khi mỗi tenant một DB.
- `version` chống ghi đè chỉ có ở KV, không có ở bảng danh mục nào.
- Liên kết: Kho dùng chữ, HRM và CRM dùng mã hoặc id.

### 2.4 Không phân hệ nào làm chuẩn nguyên bản được

- HRM tốt nhất về dữ liệu (có `code`, xoá mềm, phân cấp, cờ nghiệp vụ). Điểm trừ: `tenant_id` thừa.
- CRM tốt nhất về điều hướng cài đặt (nhóm tab theo hash) và KV có `version`. Điểm trừ: xoá cứng, thiếu `code`.
- Kho yếu nhất về danh mục; chỉ tốt ở khoá lạc quan trên KV.

## 3. Chuẩn chung đề xuất

### A. Chọn nơi lưu

- Dữ liệu mà bản ghi khác tham chiếu tới (đơn vị tính, nhóm hàng, loại đơn, giai đoạn bán hàng): bảng riêng.
- Tham số đơn lẻ không ai tham chiếu (số ngày nhắc, tiền tố mã, bật tắt tính năng): KV.

### B. Bảng danh mục

Mỗi phân hệ tự sở hữu bảng của mình (luật cứng 4: không ghi vào schema phân hệ khác), nên chuẩn là quy ước cột, không
phải một bảng dùng chung.

- Cột bắt buộc: `id`, `code`, `name`, `active`, `sort_order`, `deleted_at`, `version`, `created_at`, `updated_at`,
  `updated_by`. Không có `tenant_id`.
- Chỉ mục duy nhất theo `lower(code)` khi `deleted_at IS NULL`. Mã không đổi được sau khi đã có dữ liệu dùng.
- Cột riêng của phân hệ thêm bên cạnh (như `paid`, `rate_multiplier` ở HRM).
- Bảng mới dùng `active`. Bảng cũ có `is_active` giữ nguyên, không đổi tên.

### C. Bảng KV

`module_settings(key text primary key, value jsonb, version int, updated_by, updated_at)`, đúng mẫu Kho, CRM,
Procedure, Maintenance. Workspace, social và finance bổ sung `version` khi có việc chạm tới.

### D. Liên kết

- Cùng schema: id có khoá ngoại.
- Khác phân hệ: tham chiếu bằng mã; đọc qua API `/v1/internal/` hoặc sự kiện (outbox). Phân hệ sở hữu phát sự kiện mới
  khi một mục bị xoá hoặc ngừng dùng. Không đổi tên sự kiện đã phát (luật cứng 5).
- Xoá mục đang được dùng: chỉ xoá mềm; giao diện báo số bản ghi đang dùng.

### E. Giao diện và API dùng chung

- Kiểu `CatalogItem` và lỗi xung đột phiên bản (409) đặt ở `packages/shared`.
- Component `CatalogEditor` ở `shared-ui`: danh sách, thêm, đổi tên, sắp xếp, tắt/bật, nhãn "đang dùng bởi n".
  Mỗi phân hệ truyền cột riêng và API của mình. Tuân theo skill `ui-design` (dùng `SearchableSelect`, không `<select>`).

## 4. Lộ trình

Nguyên tắc: không chuyển hàng loạt; chỉ ép chuẩn khi chạm tới. Không đổi tên cột hay bảng đang chạy; thêm cột mới, giữ
cột cũ một đợt (luật tương thích ngược của migration).

| Bước | Việc | Phạm vi |
|---|---|---|
| 1 | Chốt quyết định ở mục 6 và đưa chuẩn A đến E thành tài liệu chính thức trong `docs/` | Tài liệu |
| 2 | Thí điểm ở Kho: bảng `inventory_schema.catalog_items` (`kind` gồm UNIT, TRADE_GOODS, TRADE_SERVICE; mở rộng sau), thêm `unit_id`, `trade_category_id` cho `materials`, giữ cột chữ cũ | Kho |
| 3 | Migration chuyển dữ liệu: đọc mảng trong `module_settings`, chèn vào `catalog_items`, điền id theo chữ; giá trị không khớp thì thêm mục "chưa chuẩn hoá", không mất dữ liệu; chạy lại được | Kho |
| 4 | Sửa mọi chỗ đang đọc chữ: màn Cài đặt, form vật tư, nhập Excel, báo cáo, tìm kiếm | Kho |
| 5 | Dựng `CatalogEditor` chung từ bước 2 đến 4 | shared-ui |
| 6 | Áp chuẩn cho phân hệ khác khi có việc liên quan: CRM thêm `deleted_at`, `version`; workspace thêm `code`, `active`; HRM bỏ phụ thuộc `tenant_id` ở đợt sau | Từng phân hệ |
| 7 | Đợt sau: bỏ cột chữ và mảng JSON cũ của Kho | Kho |

Số migration kế tiếp của Kho là 0030 (0029 là số cao nhất hiện tại). Đăng ký trong
`packages/platform/entitlement/src/lib/tenant-migrations.ts` và chạy `node tools/check-migrations.mjs`.

Với CRM (bước liên phân hệ): thêm route nội bộ `/v1/internal/catalog-items` ở Kho để CRM đọc nhóm hàng thay vì lấy từ
cài đặt Kho; thêm quyền và guard theo skill `erp-permissions`. Làm sau, chỉ khi dòng mồ côi ở CRM gây vấn đề thật.

## 5. Rủi ro

- Phạm vi toàn bộ phân hệ lớn; ép chuẩn một lần sẽ tạo PR quá to và dễ vỡ.
- Bước 4 đụng khoảng 15 đến 20 file; nhập Excel dễ sót nhất vì gõ chữ trực tiếp.
- HRM có `tenant_id` trong nhiều bảng; bỏ cần migration cẩn thận, không sửa file đã merge.
- `CatalogEditor` chung cần thống nhất giao diện với những người làm UI các phân hệ khác.
- Thay đổi chưa động tới dữ liệu CRM; dòng mồ côi sẵn có (ví dụ sau khi xoá dữ liệu Kho thử) cần xử lý riêng.

## 6. Quyết định cần chốt

1. Đồng ý quy tắc A (bảng riêng khi có tham chiếu, KV khi là tham số)?
2. Tên cột chuẩn là `active` hay `is_active`? Đề xuất `active`.
3. Danh mục nào của Kho vào bảng chung ở bước 2: chỉ đơn vị tính và nhóm hàng, hay cả trạng thái sử dụng và loại thiết
   bị?
4. Làm đủ cả lộ trình hay chỉ bước 1 đến 5?
5. Thứ tự so với tính năng tự đánh số serial (độc lập về code, nên làm một việc mỗi lần để PR gọn).

## 7. Ngoài phạm vi kế hoạch này

- Đồng bộ dữ liệu giữa các tenant.
- Đổi cấu trúc danh mục nhà cung cấp của Kho (đã có kế hoạch riêng ở nhánh supplier-catalog).
- Sửa dòng mồ côi ở CRM bằng cách ghi vào schema CRM (trái luật cứng 4).
