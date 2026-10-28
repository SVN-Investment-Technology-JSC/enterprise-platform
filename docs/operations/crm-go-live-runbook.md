# Runbook go-live phân hệ Bán hàng (CRM) và nâng cấp Kho

## Phạm vi và nguyên tắc

Runbook này dùng khi đưa nhánh Bán hàng (`crm`) và bản nâng cấp Kho lên môi trường thật. Nội dung gồm: điều kiện trước, hai đợt deploy, thứ tự migration, kiểm tra trước và sau, bật phân hệ cho từng tenant, chuyển khách hàng Workspace, thay đổi người dùng sẽ thấy, rollback, hạn chế còn mở.

- **Không tự deploy.** Merge vào `dev/release` chỉ build image. Người phụ trách deploy chạy deploy trên Coolify. Mỗi lần deploy cả hệ thống dừng khoảng 2 phút, nên phải báo trước cho người dùng và chọn giờ thấp điểm. Trợ lý AI và người viết code không bấm deploy, không sửa cấu hình Coolify.
- Mọi migration chỉ thêm (bảng, cột, index, trigger). Không có migration down. Không sửa, xoá, đổi tên migration đã merge.
- Sai số liệu sau go-live sửa bằng chứng từ đảo, chứng từ điều chỉnh hoặc điều chỉnh công nợ, không sửa thẳng DB.
- Hướng dẫn người dùng: [docs/user-guide/crm/README.md](../user-guide/crm/README.md).

## 1. Điều kiện trước

### 1.1. Dịch vụ mới

| Dịch vụ | Cổng | Healthcheck | Ghi chú |
|---|---|---|---|
| `crm-api` | 3344 | `/api/crm/health/ready` | Chờ `api` healthy và `migrator` hoàn tất |
| `crm-web` | 3012 | `/modules/crm` | Chờ `crm-api` healthy |

Cả hai đã khai báo trong `infrastructure/docker/compose.full.yml` (build) và `compose.coolify.yml` (image `crm-api-${IMAGE_TAG}`, `crm-web-${IMAGE_TAG}`), và trong `tools/deployment/services.json`. Trên Coolify, người phụ trách deploy cần xác nhận hai dịch vụ này đã được tạo cùng stack.

Gateway nginx (`nginx.docker.conf`):

- `^~ /api/crm/` tới `crm-api:3344`; lỗi trả 503 JSON mã `CRM_MAINTENANCE`.
- `= /modules/crm` và `^~ /modules/crm/` tới `crm-web:3012`; lỗi trả trang `/crm-maintenance.html` (đã copy trong Dockerfile nginx).

### 1.2. Biến môi trường theo dịch vụ

Giá trị mặc định trong compose dùng tên dịch vụ nội bộ. Nếu Coolify đặt tên khác, sửa URL tương ứng. Thiếu biến URL thì dịch vụ rơi về `localhost` và gọi liên phân hệ sẽ lỗi, nên phải kiểm đủ.

| Dịch vụ | Biến | Giá trị trong compose | Mới hay có sẵn |
|---|---|---|---|
| `crm-api` | `INVENTORY_API_URL` | `http://inventory-api:3336/api/inventory` | Mới |
| `crm-api` | `PROCEDURE_API_URL` | `http://procedure-api:3334/api/procedure` | Mới |
| `crm-api` | `FINANCE_API_URL` | `http://finance-api:3341/api/finance` | Mới |
| `crm-api` | `INTERNAL_SERVICE_TOKEN` | Từ khối `platform-access-environment` | Dùng chung, phải cùng giá trị với các dịch vụ khác |
| `crm-api` | `TENANT_CORE_ORGANIZATION_CONTEXT_URL` | Từ khối `platform-access-environment` | Dùng chung; phạm vi nhóm của Bán hàng đọc từ đây |
| `crm-api` | `PLATFORM_JWKS_URL`, `PLATFORM_ACCESS_DECISION_URL`, `PLATFORM_TENANT_DATABASE_API_URL`, biến DB | Từ các khối dùng chung | Như các module API khác |
| `procedure-api` | `CRM_API_URL` | `http://crm-api:3344/api/crm` | Mới. Hỏi Bán hàng trước khi thu hồi kết quả duyệt báo giá, hạn mức |
| `workspace-api` | `CRM_API_URL` | `http://crm-api:3344/api/crm` | Mới. Tra khách hàng Bán hàng |
| `worker` | `CRM_API_URL` | `http://crm-api:3344/api/crm` | Mới |
| `worker` | `FINANCE_API_URL` | `http://finance-api:3341/api/finance` | Mới |
| `worker` | `INVENTORY_API_URL`, `INTERNAL_SERVICE_TOKEN`, `TENANT_CORE_ORGANIZATION_CONTEXT_URL` | Có sẵn | Kiểm lại còn đúng |
| `migrator` | `SEED_SUPERADMIN_PASSWORD` | Có sẵn | Bắt buộc; xem mục 3.1 |

`notification-worker`, `inventory-api`, `finance-api` không có biến mới.

Worker tạo queue mới `crm.integrations.v1`, nghe `procedure.instance.completed`, `procedure.instance.reversed`, `inventory.stock.issued`, `inventory.reservation.expired`, `inventory.stock.returned` và sự kiện phiếu Tài chính. Queue Workspace nghe thêm `crm.customer.*`. Tài khoản RabbitMQ của worker phải được tạo queue và bind. Nếu bật chức năng xóa tenant, cân nhắc thêm `crm.integrations.v1` vào `TENANT_DELETION_QUEUES` (xem [tenant-deletion.md](./tenant-deletion.md)).

### 1.3. Người và dữ liệu cần có

| Việc | Người làm | Khi nào |
|---|---|---|
| Danh sách serial trùng đã xử lý xong | Thủ kho từng tenant | Trước đợt 1 |
| Ảnh chụp tồn kho trước deploy | Quản trị hệ thống | Ngay trước đợt 1 |
| Kế toán đối chiếu `init-avg-cost --dry-run` với 5 mặt hàng mẫu | Kế toán | Trước khi ghi giá bình quân |
| UAT trên tenant thí điểm đạt | Nhóm dự án, các vai trò | Trước đợt 2 |
| Quy trình duyệt báo giá, duyệt hạn mức đã công bố (nếu dùng duyệt qua Quy trình) | Quản trị tenant | Trước khi bật Bán hàng cho tenant |
| Danh sách vai trò và người dùng Bán hàng | Quản trị tenant | Trước khi bật Bán hàng cho tenant |

## 2. Hai đợt deploy

| Đợt | Nội dung | Bật cho ai | Điều kiện vào | Kiểm sau |
|---|---|---|---|---|
| 1 | Nâng cấp Kho: migration Inventory 0011–0017, `inventory-api`, `inventory-web`, `worker` (job hết hạn giữ hàng), gateway | Mọi tenant có Kho; **không bật `crm` cho tenant nào** | Đối soát tồn trên tenant thí điểm và trên bản sao dữ liệu thật đạt; serial trùng đã xử lý; giá bình quân được kế toán xác nhận | Mục 5, TC-MIG-02, TC-REG-01 đến 05 |
| 2 | Bán hàng: `crm-api`, `crm-web`, migration Finance 0010, Workspace 0031, CRM 0001–0011 (chỉ tenant bật `crm`) | Tenant thí điểm đầu tiên | UAT trên tenant thí điểm đạt | Mục 5, mục 6 |
| 3 | Mở cho tenant khác | Từng tenant | Thí điểm chạy 2 tuần không có lỗi nghiêm trọng | Như đợt 2 |

Migrator áp mọi migration đã đăng ký trong `packages/platform/entitlement/src/lib/tenant-migrations.ts` cho tenant có phân hệ tương ứng. Nếu đợt 1 dùng image build từ commit đã có cả phần Bán hàng, migrator sẽ áp luôn Finance 0010 và Workspace 0031 cho tenant có hai phân hệ này. Hai migration này chỉ thêm cột, nới độ dài cột và thêm index, code cũ vẫn chạy; khi đó đợt 2 chỉ còn bật entitlement `crm` và cấu hình. CRM 0001–0011 chỉ chạy khi tenant được bật `crm`.

Nếu sau đợt 1 tồn kho không khớp: deploy lại image Inventory trước đó, giữ nguyên schema, không bật Bán hàng, điều tra rồi mới làm lại.

## 3. Migration

### 3.1. Thứ tự migrator chạy

1. Platform SQL 0001 đến 0010 (không có migration Platform mới cho Bán hàng).
2. Schema lõi của tenant, hàng đợi khởi tạo phân hệ (`processProvisioningJobs`, đã nhận `module_key = 'crm'`), nâng cấp phân hệ đang bật (`upgradeActiveEntitlements`).
3. `seedPlatform` (khi không có cờ `--migrate-only`): thêm module `crm` ("Bán hàng", đường dẫn `/modules/crm`) và các quyền `crm.*`; vai trò quản trị tenant tự nhận mọi quyền không phải `platform.%`.

Lưu ý:

- **Không chạy migrator với `--migrate-only` ở đợt 2.** Khi đó `seedPlatform` không chạy và phân hệ `crm` không bao giờ được đăng ký.
- Migration cũ `migrations/platform/0007-remove-crm.sql` (xoá module crm cũ) đã có trong ledger của môi trường đang chạy nên không chạy lại; trên DB mới nó chạy trước seed, không ảnh hưởng.
- Migrator trên Coolify chạy `node main.js`, cần `SEED_SUPERADMIN_PASSWORD`. Seed đặt lại mật khẩu superadmin theo biến này mỗi lần chạy (hành vi có sẵn); xác nhận biến đúng trước khi deploy.

Thứ tự theo phân hệ: Inventory 0011–0017 → Finance 0010 → CRM 0001–0011 (tenant bật `crm`) → Workspace 0031.

### 3.2. Inventory (mọi tenant có Kho)

| File | Nội dung | Rủi ro |
|---|---|---|
| `0011-stock-documents.sql` | Bảng `stock_documents`, `stock_document_lines`; cột `inventory_transactions.document_id`; trigger làm sổ kho chỉ ghi thêm và chặn sửa chứng từ đã ghi sổ | Sau migration, mọi UPDATE/DELETE vào `inventory_transactions` bị chặn, kể cả sửa tay |
| `0012-reservation-source.sql` | `reservations` thêm `source_type`, `source_id`, `idempotency_key`, `request_hash`, unique khoá chống lặp; ràng buộc số đã xuất không vượt số giữ (`NOT VALID`, không quét dòng cũ) | Thấp |
| `0013-serial-quality.sql` | Kiểm serial trùng rồi thêm unique `(material_id, upper(btrim(serial_number)))`; cột `quality_status` (mặc định `PASSED`), `stock_state` (backfill `IN_STOCK` cho serial đang ở kho), bảng `serial_movements`, cột serial trên dòng chứng từ | **Dừng cả lượt migrate của tenant nếu còn serial trùng**, thông báo "Không chạy được migration 0013-serial-quality: còn N nhóm serial trùng..." |
| `0014-lots.sql` | Bảng `lots`, `lot_balances`, `lot_quality_events`; cột `lot_id` trên dòng chứng từ | Lô lưu trong trình duyệt trước đây không được chuyển |
| `0015-quality-blocked.sql` | `material_inventory.quantity_blocked`; tạo lại cột sinh `available = quantity − quantity_reserved − quantity_blocked` | Viết lại bảng `material_inventory` dưới `statement_timeout 30s`; bảng rất lớn cần kiểm thời gian trên bản sao |
| `0016-costing.sql` | `material_inventory.avg_cost` (mặc định 0); `cost_amount`, `source_line_id` trên dòng chứng từ; `request_hash` | Dữ liệu cũ có giá bình quân 0 cho tới khi chạy `init-avg-cost.mjs` |
| `0017-service-kind.sql` | `materials.kind` nhận `SERVICE`; trigger chặn tồn cho mặt hàng dịch vụ; cột `materials.warranty_months` | Thấp |

### 3.3. Finance, Workspace

| File | Nội dung |
|---|---|
| `finance/0010-external-source.sql` | `voucher_sources` thêm `source_module` (mặc định `procedure-engine`), `source_ref`, `idempotency_key`, `request_hash`; `instance_id`, `step_instance_id` cho phép rỗng; CHECK nguồn, hai unique; trạng thái thêm `REVERSED`. Cho phép Bán hàng tạo phiếu thu nháp có nguồn |
| `workspace/0031-crm-customer-link.sql` | `customers` thêm `crm_customer_id`, `crm_version`; nới `code` lên 50, `name` lên 300 ký tự; unique một phần trên `crm_customer_id` |

### 3.4. CRM (chỉ tenant bật `crm`)

Toàn bộ tạo bảng mới trong `crm_schema`, không đụng dữ liệu cũ, có `lock_timeout 3s`, `statement_timeout 30s`.

| File | Nội dung | Cấu hình mặc định sinh ra |
|---|---|---|
| `0001-crm-foundation.sql` | Schema, `settings`, `integration_requests` (hàng lệnh gửi phân hệ khác), `audit_log` | |
| `0002-customers.sql` | Nhóm khách, khách hàng, người liên hệ; sequence mã khách | `customer.code` = tiền tố `KH`, 6 chữ số |
| `0003-leads-opportunities.sql` | Cơ hội, lịch sử giai đoạn, lead | |
| `0004-activities.sql` | Hoạt động (notification-worker đọc để nhắc) | `activity.reminder` = 30 phút |
| `0005-pricing.sql` | Bảng giá, dòng giá, gán nhóm, chính sách, tiêu chí | `pricing.discountCap` = 10% |
| `0006-quotes.sql` | Báo giá, phiên bản, dòng, chính sách đã áp; `procedure_links`; `approval_bindings` | `quote.approval`: nhân viên 5%, trưởng nhóm 15%, quản lý không giới hạn, biên 10% |
| `0007-contracts.sql` | Hợp đồng, dòng, đợt thanh toán | `contract.expiring` = 30 ngày |
| `0008-sales-orders.sql` | Đơn bán, dòng, đợt giao, chứng từ xuất của đợt | `reservation.holdDays` = 7 |
| `0009-receivables.sql` | Sổ công nợ (trigger chặn UPDATE/DELETE), lần thu, phân bổ, điều chỉnh, yêu cầu duyệt hạn mức, cảnh báo | `receivable.recognition` = khi giao; `credit.limit` = đưa đi duyệt |
| `0010-warranty.sql` | Yêu cầu bảo hành, dòng, chứng từ | **Kho cách ly `QA-KHO-CL`, kho lỗi `QA-KHO-LOI` là mã kho kiểm thử; phải đổi cho tenant thật** |
| `0011-sales-facts.sql` | Bảng số liệu báo cáo `sales_facts` và index; backfill từ dòng giao đã có (rỗng với tenant mới) | |

Nếu gặp "Checksum mismatch" ở `crm`: không sửa file migration. Xử lý theo skill `erp-migrations`. Trường hợp đã gặp trên tenant thí điểm là do từng áp bản nháp; khi `crm_schema` chưa có dữ liệu thật thì xoá `crm_schema` và ledger `crm` của tenant đó rồi áp lại, việc này phải được người phụ trách DB đồng ý.

## 4. Kiểm tra trước đợt 1

Chạy trên từng DB tenant có Kho. Lấy URL DB tenant từ cấu hình tenant trên Platform; không ghi URL có mật khẩu vào repo hay lịch sử shell dùng chung.

### 4.1. Serial trùng

```bash
node tools/inventory/find-duplicate-serials.mjs --database-url=postgres://user:pass@host:5432/<db tenant> --fail-on-duplicates > serial-trung.csv
```

- Chỉ đọc (transaction `READ ONLY`). CSV ra stdout, tóm tắt ra stderr.
- Mã thoát 0: không trùng; 2: còn trùng; 1: lỗi tham số hoặc kết nối.
- Thủ kho xem từng nhóm, giữ bản đúng (thường là bản đang ở kho hoặc đang lắp vào thiết bị), sửa số serial thật hoặc xoá bản khai nhầm trên giao diện Kho hiện tại. Chạy lại đến khi báo "Không có serial trùng".

### 4.2. Ảnh chụp tồn kho

Trước đợt 1, chụp tồn bằng `tools/inventory/reconcile-stock.mjs` (chỉ đọc, xem `tools/inventory/README.md`) và đính kèm phiếu deploy; sau deploy chạy lại với `--compare <ảnh trước>`, mã thoát 0 là khớp, 1 là lệch. Nếu không chạy được script, dùng truy vấn chỉ đọc dưới đây:

```sql
-- Tồn theo kho, mặt hàng
SELECT w.code AS warehouse, m.code AS material,
       SUM(mi.quantity) AS quantity, SUM(mi.quantity_reserved) AS reserved
FROM inventory_schema.material_inventory mi
JOIN inventory_schema.warehouses w ON w.id = mi.warehouse_id
JOIN inventory_schema.materials m ON m.id = mi.material_id
GROUP BY w.code, m.code ORDER BY 1, 2;

-- Số serial theo mặt hàng
SELECT m.code, COUNT(*) FROM inventory_schema.serial_tracking s
JOIN inventory_schema.materials m ON m.id = s.material_id GROUP BY m.code ORDER BY 1;

-- Giữ hàng còn mở
SELECT status, COUNT(*) FROM inventory_schema.reservations GROUP BY status;
```

Kiểm tên bảng, cột với schema thực tế của tenant trước khi chạy.

### 4.3. Giá vốn bình quân (sau migration 0016, trước khi mở lại cho người dùng ghi sổ nhiều)

```bash
node tools/inventory/init-avg-cost.mjs --database-url=postgres://... --dry-run
node tools/inventory/init-avg-cost.mjs --database-url=postgres://... --dry-run --json > avg-cost-preview.json
```

- `--dry-run` chỉ đọc. Kết quả là bảng kho, mặt hàng, tồn hiện tại, tồn cộng từ sổ kho, giá đang lưu, giá tính lại, có đổi hay không; cảnh báo khi tồn không khớp sổ.
- Kế toán đối chiếu 5 mặt hàng mẫu tính tay. Đạt thì chạy không có `--dry-run` để ghi. Script khoá dòng tồn khi ghi, nên chạy ngoài giờ làm việc. Chạy lại được, kết quả như nhau.
- Mã thoát 1 khi lỗi hoặc khi 0016 chưa chạy.

Quy tắc tính: bình quân gia quyền di động theo từng dòng tồn (kho, mặt hàng), 4 chữ số thập phân; nhập đơn giá 0 giữ nguyên bình quân; chân nhận của điều chuyển lấy giá chân xuất; xuất lấy bình quân hiện tại; chứng từ đảo lấy giá dòng gốc.

### 4.4. Lệch serial, lô do dữ liệu cũ (sau migration 0013, 0014)

Dữ liệu nhập trước khi Kho quản lý serial và lô theo sổ có thể lệch với tồn dù sổ kho khớp: serial khai trên màn khai serial cũ kèm kho mà không có phiếu nhập được 0013 coi là Trong kho (thừa serial so với tồn); số nhập trước 0014 không có lô vì lô cũ chỉ nằm ở trình duyệt (tổng lô nhỏ hơn tồn). Phát hiện bằng `node tools/inventory/reconcile-stock.mjs --database-url=... > sau-migration.json`: tóm tắt báo `lệch serial`, `lệch lô` theo cặp kho/mặt hàng, còn `lệch sổ kho` bằng 0. Tra serial thừa là serial Trong kho không có dòng nào ở `serial_movements` (chưa từng nhập, xuất theo chứng từ) rồi đối chiếu với kiểm đếm thực tế. Xử lý bằng chứng từ điều chỉnh (thủ kho lập, quản lý kho duyệt, ghi sổ), ghi rõ lý do ở ghi chú, không sửa thẳng DB: serial khai thừa thì một dòng giảm có serial đó và một dòng tăng cùng số lượng không serial (tồn giữ nguyên); phần tồn chưa có lô thì một dòng giảm không lô và một dòng tăng cùng số lượng vào lô tồn cũ (ví dụ `TONCU-<ngày>`). Đơn giá để trống thì lấy bình quân hiện tại nên giá vốn không đổi. Chạy lại script đến khi cả ba loại lệch bằng 0. Ví dụ trên `svn` (T8-10): QA-KHO-HN/QA-KHO-LAP tồn 105 nhưng 106 serial Trong kho do `SN-TRUNG01`; QA-KHO-HN/QA-KHO-MUC tồn 125 nhưng tổng lô 75 do 50 hộp nhập ngày 27/10/2026, trước 0014.

## 5. Kiểm tra sau deploy

### 5.1. Sau đợt 1

| Kiểm | Cách | Đạt khi |
|---|---|---|
| Migration Inventory | Log migrator, ledger migration của tenant | 0011–0017 đã áp cho mọi tenant có Kho |
| Tồn không đổi | Chạy lại truy vấn 4.2 | `quantity`, `reserved` khớp ảnh chụp; `available` bằng `quantity − reserved` (chưa có hàng bị chặn chất lượng) |
| Serial | Truy vấn số serial | Khớp ảnh chụp |
| Giá bình quân | `init-avg-cost.mjs --dry-run` sau khi ghi | Không còn dòng thay đổi |
| Màn Kho | Đăng nhập thủ kho | Thấy menu `Chứng từ kho`, `Duyệt chứng từ`, `Yêu cầu xuất từ đơn bán`, `Báo cáo kho` |
| Ghi sổ | Lập và ghi sổ một chứng từ nhập nhỏ trên kho thử, rồi `Tạo chứng từ đảo` | Tồn tăng rồi về như cũ |
| Hồi quy | TC-REG-01 đến 05 trong kế hoạch kiểm thử | Đạt |
| Worker | Log worker | Không lỗi kết nối; job hết hạn giữ hàng chạy |

### 5.2. Sau đợt 2

| Kiểm | Cách | Đạt khi |
|---|---|---|
| `crm-api`, `crm-web` | Healthcheck, mở `/modules/crm` | Trả 200, không hiện trang bảo trì |
| Đăng ký phân hệ | Platform Admin | Có phân hệ "Bán hàng" để bật cho tenant; quyền `crm.*` có trong màn quyền |
| Finance 0010, Workspace 0031 | Ledger migration | Đã áp |
| Queue | RabbitMQ Management | Có `crm.integrations.v1` với các binding ở mục 1.2, không có message ứ đọng |
| Liên phân hệ | Theo mục 6.4 | Đạt |

## 6. Bật Bán hàng cho một tenant

### 6.1. Bật entitlement

1. Platform Admin → tenant → phân hệ, bật `crm` (Bán hàng). Tenant cần có sẵn `inventory`; nên có `finance` (thu tiền), `procedure-engine` (duyệt qua Quy trình), `workspace` (nếu đang dùng khách hàng Workspace).
2. Worker khởi tạo phân hệ và áp CRM 0001–0011 vào DB tenant. Trong lúc này trang Bán hàng hiện "Dữ liệu Bán hàng của tenant đang được khởi tạo."
3. Kiểm `GET /api/crm/v1/status` bằng tài khoản quản trị tenant: `schemaExists = true`, `tablesReady = true`.

Từ lúc bật `crm`, khách hàng Workspace chỉ đọc: API tạo, sửa, xoá khách Workspace trả 409 `CUSTOMER_MANAGED_BY_CRM`. Chạy mục 6.3 ngay sau bước này.

### 6.2. Vai trò và quyền

Hệ thống không tạo sẵn vai trò nghiệp vụ Bán hàng; chỉ vai trò quản trị tenant có mọi quyền `crm.*`. Quản trị tenant tạo vai trò theo bảng ở [hướng dẫn người dùng, mục 3.2](../user-guide/crm/README.md#32-gợi-ý-gán-quyền-theo-vai-trò). Lưu ý:

- `crm.manage` kèm `crm.read`, `crm.read.all` nhưng không kèm quyền ghi nghiệp vụ.
- Phạm vi nhóm lấy từ quan hệ "Báo cáo cho" trong cơ cấu tổ chức ở Core; phải nhập cơ cấu tổ chức trước để trưởng nhóm thấy dữ liệu nhóm.
- Thủ kho cần thêm `inventory.quality.write`; quản lý kho cần `inventory.document.approve` (đã nằm trong `inventory.manage`).
- Kế toán ghi sổ phiếu thu cần `finance.receipt.approve`.

### 6.3. Cấu hình ban đầu (quản trị bán hàng)

1. `Cấu hình` → `Chung`: nhóm khách, mã khách, nhắc hoạt động, giữ hàng, cảnh báo hợp đồng.
2. `Bảng giá`, `Chính sách chiết khấu`, `Thử tính giá`.
3. `Duyệt báo giá`: ngưỡng duyệt; `Cách duyệt` cho `Báo giá vượt ngưỡng` và `Đơn bán vượt hạn mức công nợ`. Khi chưa cấu hình, cả hai là `Duyệt trực tiếp trong Bán hàng`. Muốn duyệt qua Quy trình (quyết định D5 chọn mặc định này), quản trị tenant phải công bố quy trình trước rồi chọn `Duyệt qua Quy trình` và quy trình tương ứng.
4. `Bảo hành` → `Kho bảo hành`: đổi `Kho cách ly`, `Kho lỗi` khỏi mã kiểm thử `QA-KHO-CL`, `QA-KHO-LOI`; đặt `Kho nhập lại hàng Đạt`.
5. `Công nợ` → `Cấu hình`: cách xử lý vượt hạn mức, người nhận cảnh báo.
6. Đặt hạn mức tín dụng, thời hạn thanh toán trên hồ sơ khách cần kiểm soát.
7. Danh mục Kho: đánh dấu mặt hàng dịch vụ (`SERVICE`), nhập số tháng bảo hành của mặt hàng.

### 6.4. Chuyển khách hàng Workspace sang Bán hàng

Script chỉ gọi API (không ghi chéo schema), đăng nhập bằng quản trị tenant.

```bash
CRM_MIGRATE_ADMIN_EMAIL=<email quản trị tenant> CRM_MIGRATE_ADMIN_PASSWORD=<mật khẩu> \
  node tools/crm/migrate-workspace-customers.mjs --tenant=<slug> --dry-run
node tools/crm/migrate-workspace-customers.mjs --tenant=<slug>
# Khi có mã không hợp lệ và chấp nhận cấp mã mới:
node tools/crm/migrate-workspace-customers.mjs --tenant=<slug> --generate-codes
```

- URL dịch vụ lấy từ biến `WORKSPACE_API_URL`, `CRM_API_URL`, `SVN_SEED_PLATFORM_API_URL` (xem `tools/crm/README.md`).
- Với mỗi khách Workspace chưa gắn: tìm khách Bán hàng cùng mã (viết hoa), chưa có thì tạo giữ nguyên mã, rồi gắn qua `POST /api/workspace/v1/crm-customers/:id/link`. Dự án, hợp đồng Workspace vẫn trỏ đúng khách.
- Mã không hợp lệ ở Bán hàng (có dấu, khoảng trắng, ký tự lạ, dài quá 50; phải khớp `^[A-Z0-9._-]{1,50}$`) bị bỏ qua và báo "cần xử lý tay". `--generate-codes` cho Bán hàng cấp mã mới, mã cũ ghi vào ghi chú.
- Chạy lại được; mã thoát 1 nếu có lỗi hoặc còn mã không hợp lệ. Lưu output cuối lượt (số khách đã gắn, tạo mới, lỗi) vào phiếu deploy.

### 6.5. Kiểm liên phân hệ trên tenant vừa bật

1. Lập báo giá vượt ngưỡng, gửi duyệt; nếu duyệt qua Quy trình thì hồ sơ được tạo và kết quả quay về báo giá.
2. Chuyển báo giá thành hợp đồng, đơn; xác nhận đơn: Kho có giữ hàng, tồn khả dụng giảm.
3. Yêu cầu xuất kho; thủ kho ghi sổ: đơn cập nhật số đã giao, serial; sổ công nợ có dòng `Phát sinh nợ`.
4. Ghi nhận thu tiền: Tài chính có phiếu thu nháp; kế toán ghi sổ: lần thu `Đã ghi sổ`, dư nợ giảm.
5. Tra bảo hành theo serial vừa giao.

## 7. Thay đổi người dùng sẽ thấy

Báo trước cho thủ kho, kế toán, người dùng Workspace:

| Thay đổi | Ảnh hưởng |
|---|---|
| Xuất tự do dùng tồn khả dụng | Xuất dự án, xuất khác, điều chuyển chỉ lấy được `Thực tế − Đã giữ − Chờ kiểm định/không đạt`. Trước đây có thể xuất cả phần đã giữ. |
| Hàng đã giữ được bảo vệ | Phần giữ cho đơn bán, hợp đồng không bị phiếu khác lấy; hết hạn giữ thì tự trả về khả dụng. |
| Serial duy nhất | Serial duy nhất theo mặt hàng, không phân biệt hoa thường và khoảng trắng đầu cuối; khai trùng bị từ chối. |
| Lô lưu trên server | Lô, hạn dùng lưu trên server và chọn theo FEFO khi xuất. Lô khai trong trình duyệt trước đây không còn; khai lại lô thật bằng chứng từ. |
| Chất lượng | Lô không ở trạng thái `Đạt` không tính khả dụng, không xuất bán được. |
| Chứng từ nhiều dòng, duyệt | Nhập khác, xuất khác, điều chỉnh phải được người khác duyệt trước khi ghi sổ. |
| Không sửa số liệu đã ghi sổ | Sổ kho và sổ công nợ chỉ ghi thêm; sai thì tạo chứng từ đảo hoặc điều chỉnh. |
| Mã chứng từ, mã dòng sổ kho | Chứng từ mới có mã `PN`, `PX`, `PC`, `PDC` + `-<dấu thời gian>-<6 ký tự>`; dòng sổ kho `TXN-<dấu thời gian>-<8 ký tự>`; giữ hàng `RES-...`. Mã không liên tục. Mã Bán hàng dạng `<tiền tố><2 số năm><5 số>` (`BG`, `HD`, `DH`, `TT`, `DC`, `BH`), đợt giao `<mã đơn>-NN`; sequence không đặt lại theo năm. |
| Mặt hàng dịch vụ | Mặt hàng `SERVICE` không có tồn, không vào chứng từ kho. |
| Khách hàng Workspace chỉ đọc | Tạo, sửa khách ở Bán hàng; Workspace giữ bản sao. |
| Giá vốn | Phiếu xuất có giá vốn theo bình quân gia quyền. |

## 8. Rollback

| Tình huống | Cách xử lý |
|---|---|
| Lỗi chức năng Bán hàng ở một tenant | Tắt entitlement `crm` của tenant trong Platform Admin. Dữ liệu `crm_schema` giữ nguyên. Workspace quay về dùng bảng khách cũ. Bật lại khi đã sửa. |
| Lỗi `crm-api`/`crm-web` toàn hệ thống | Người phụ trách deploy chuyển hai dịch vụ về image trước (hoặc dừng); gateway trả trang bảo trì `CRM_MAINTENANCE` cho đường dẫn Bán hàng, phân hệ khác chạy bình thường. |
| Lỗi Kho sau đợt 1 | Deploy lại image Inventory (và worker) trước đó. Schema mới tương thích ngược vì chỉ thêm; không chạy migration down. Không bật Bán hàng. |
| Sai số liệu nghiệp vụ | Không sửa DB. Dùng chứng từ đảo, chứng từ điều chỉnh, điều chỉnh công nợ, phiếu đảo bên Tài chính. |

Chỉ rollback bằng image. Không xoá bảng, không xoá dòng ledger migration để "làm lại" trên tenant đã có dữ liệu thật. Mỗi lần đổi image vẫn làm hệ thống dừng khoảng 2 phút và do người phụ trách deploy thực hiện. Giữ ảnh chụp tồn và biên bản đối soát cùng phiếu deploy.

## 9. Hạn chế đã biết và việc còn mở

| Mục | Ghi chú |
|---|---|
| R15: phạm vi nhóm với tenant không bật HRM | Snapshot tổ chức ở Tenant Core JOIN thẳng `hrm_schema`, có thể lỗi với tenant không bật HRM; đang chờ nhóm Platform sửa. Khi Core lỗi, Bán hàng trả lỗi tạm thời chứ không mở rộng phạm vi. Trước khi bật cho tenant không có HRM, phải kiểm thử. |
| Đối soát tồn tự động | Đã có `tools/inventory/reconcile-stock.mjs` (mục 4.2). Biên bản đối soát trên bản sao dữ liệu production chưa làm. |
| UAT, hồi quy | T8-01 đến T8-05 chưa xong; đợt 2 chỉ chạy khi UAT đạt. |
| Thu hồi duyệt sau khi khách chấp nhận | Quy trình thu hồi kết quả duyệt của báo giá đã được khách chấp nhận chưa được xử lý tự động. |
| Gia hạn hợp đồng | Không tự gia hạn phần giữ hàng của hợp đồng (P2). |
| Ngày giao | Lấy theo thời điểm Kho ghi sổ chứng từ xuất, không theo ngày chứng từ; không ghi lùi ngày giao được. Ảnh hưởng hạn bảo hành và hạn nợ. |
| Phân bổ tiền trả trước | Có API nhưng chưa có nút trên giao diện. |
| Bảo hành hàng không theo serial | Màn tiếp nhận chỉ nhận theo serial. |
| Chất lượng từng serial | Chưa có màn đổi chất lượng serial bằng tay; chỉ đổi qua chứng từ bảo hành. Lô đổi được trên màn Kho. |
| Duyệt chứng từ kho theo giá trị | Không có ngưỡng theo giá trị; duyệt theo loại chứng từ. |
| Kho bảo hành mặc định | Mã kho kiểm thử, phải cấu hình lại cho từng tenant (mục 6.3). |
| Seed tenant thí điểm | `tools/crm/seed-svn.mjs`, `seed-perf.mjs`, `measure-perf.mjs` chỉ dùng cho local/thí điểm; không chạy trên môi trường thật. |

## 10. Bảng kiểm nhanh cho người phụ trách deploy

Đợt 1:

1. [ ] Serial trùng = 0 trên mọi tenant có Kho.
2. [ ] Ảnh chụp tồn đã lưu.
3. [ ] Biến môi trường mới đã đặt (mục 1.2); `SEED_SUPERADMIN_PASSWORD` đúng.
4. [ ] Thông báo người dùng về thời gian dừng khoảng 2 phút.
5. [ ] Deploy trên Coolify.
6. [ ] Migrator hoàn tất, không lỗi 0013.
7. [ ] `init-avg-cost.mjs --dry-run`, kế toán xác nhận, chạy ghi.
8. [ ] Kiểm mục 5.1.

Đợt 2:

1. [ ] UAT đạt.
2. [ ] `crm-api`, `crm-web` có trên Coolify; gateway có route Bán hàng.
3. [ ] Deploy; migrator chạy đầy đủ (không `--migrate-only`).
4. [ ] Kiểm mục 5.2.
5. [ ] Bật `crm` cho tenant thí điểm; làm mục 6.1 đến 6.5.
