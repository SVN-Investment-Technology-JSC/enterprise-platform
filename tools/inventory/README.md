# Công cụ dữ liệu Kho

## Dò serial trùng trước migration 0013

Migration `migrations/tenant/inventory/0013-serial-quality.sql` thêm unique `(material_id, serial)` cho
`inventory_schema.serial_tracking`. Nếu DB tenant còn serial trùng trong cùng một mặt hàng, migration dừng với thông
báo "Không chạy được migration 0013-serial-quality: còn N nhóm serial trùng..." và cả lượt migrate của tenant đó
không chạy tiếp. Chạy script dưới đây trước, trên bản sao dữ liệu hoặc trực tiếp (script chỉ đọc):

```bash
node tools/inventory/find-duplicate-serials.mjs --database-url=postgres://user:pass@host:5432/<db tenant> > serial-trung.csv
# hoặc
INVENTORY_DATABASE_URL=postgres://... node tools/inventory/find-duplicate-serials.mjs > serial-trung.csv
```

- Hai serial coi là trùng khi cùng `material_id` và giống nhau sau khi bỏ khoảng trắng hai đầu, không phân biệt hoa
  thường (`upper(btrim(serial_number))`), đúng biểu thức của unique index trong 0013. Ví dụ `SN001`, ` sn001` là trùng.
- CSV ra stdout, mỗi dòng một bản ghi thuộc nhóm trùng: `group_no`, `group_size`, mã và tên vật tư,
  `normalized_serial`, `serial_id`, `serial_number` như đang lưu, `internal_code`, `current_status`, `location_type`,
  kho hiện tại, `current_asset_id`, `created_at`. Tóm tắt in ra stderr.
- Mã thoát: 0 khi chạy được (kể cả có trùng), 1 khi lỗi tham số hoặc kết nối. Thêm `--fail-on-duplicates` để thoát 2
  khi còn trùng.
- Script mở transaction `READ ONLY`, không ghi gì. URL DB tenant lấy từ cấu hình tenant trên Platform; không ghi URL có
  mật khẩu vào repo hay lịch sử shell dùng chung.

Xử lý: thủ kho xem từng nhóm, quyết định giữ bản nào (thường là bản đang ở kho hoặc đang lắp vào thiết bị), sửa bản còn
lại cho đúng số serial thật hoặc xoá bản khai nhầm. Sửa xong chạy lại script đến khi báo "Không có serial trùng", rồi
mới deploy migration (kế hoạch `docs/crm/plan_crm.md` mục 4.4, TC-MIG-03).

## Khởi tạo giá vốn bình quân sau migration 0016

Migration `migrations/tenant/inventory/0016-costing.sql` thêm `material_inventory.avg_cost` (giá vốn bình quân gia quyền
của từng dòng tồn kho, vật tư) với giá trị 0 cho dữ liệu cũ. Từ bản này mỗi lần ghi sổ chứng từ tự cập nhật bình quân;
dòng tồn có từ trước cần tính lại một lần từ sổ kho bằng script dưới đây (T1-22, TC-MIG-04):

```bash
# Xem trước, không ghi gì (transaction READ ONLY):
node tools/inventory/init-avg-cost.mjs --database-url=postgres://user:pass@host:5432/<db tenant> --dry-run
# Ghi avg_cost:
node tools/inventory/init-avg-cost.mjs --database-url=postgres://user:pass@host:5432/<db tenant>
# Hoặc đặt INVENTORY_DATABASE_URL; thêm --json để nhận kết quả dạng JSON.
```

- Script đọc `inventory_schema.inventory_transactions` theo thứ tự thời gian cho từng dòng tồn (kho, vật tư) và áp
  đúng quy tắc lúc ghi sổ (`packages/modules/inventory/src/lib/domain/costing.ts`): nhập có đơn giá thì
  `bình quân = (tồn × bình quân + số nhập × đơn giá) / (tồn + số nhập)`; nhập không ghi đơn giá (0) giữ nguyên bình
  quân; vế nhập điều chuyển lấy giá vế xuất ở kho đi; xuất theo bình quân hiện tại, chứng từ đảo xuất ở giá dòng gốc.
  Bình quân giữ 4 chữ số thập phân, làm tròn nửa xa số 0.
- Bảng ra stdout: kho, mặt hàng, tồn hiện tại, tồn cộng từ sổ, bình quân đang lưu, bình quân tính lại, có đổi không.
  Tóm tắt ra stderr; cảnh báo nếu tồn lệch sổ kho (cần đối soát trước khi tin giá).
- Chạy lại cho cùng kết quả: bình quân chỉ phụ thuộc sổ kho (chỉ ghi thêm), không đọc giá đang lưu. Khi ghi thật, script
  khoá mọi dòng tồn trong lúc tính nên chứng từ ghi sổ cùng lúc phải chờ; chạy ngoài giờ làm việc.
- Mã thoát: 0 khi chạy được, 1 khi lỗi tham số, kết nối hoặc DB chưa chạy 0016.
- Kế toán đối chiếu bảng `--dry-run` với bảng tính tay của 5 mặt hàng mẫu trước khi ghi (TC-MIG-04).

## Đối soát tồn kho trước, sau UAT (T8-02)

`tools/inventory/reconcile-stock.mjs` chụp tồn kho của một DB tenant theo từng cặp (kho, mặt hàng) rồi so hai bản chụp,
để chứng minh UAT hoặc một lần deploy không làm lệch tồn ngoài các chứng từ đã biết. Script chỉ đọc: mở transaction
`REPEATABLE READ READ ONLY` (kiểm `transaction_read_only = on` trước khi đọc, rồi `ROLLBACK`), không ghi gì.

```bash
# Chụp (JSON mặc định; --format=csv để mở bằng bảng tính; --out=<file> thay cho stdout):
node tools/inventory/reconcile-stock.mjs --tenant=svn --out=/tmp/svn-truoc.json
node tools/inventory/reconcile-stock.mjs --database-url=postgres://user:pass@host:5432/<db tenant> --format=csv > ton.csv
# So với bản chụp trước:
node tools/inventory/reconcile-stock.mjs --tenant=svn --compare=/tmp/svn-truoc.json
```

- `--tenant=<tên DB>` lấy URL từ `TENANT_DATABASE_URL_TEMPLATE` (biến môi trường hoặc `.env` ở gốc repo, thay
  `{databaseName}`); hoặc `--database-url`, hoặc biến `INVENTORY_DATABASE_URL`. Dòng tóm tắt ra stderr, mật khẩu che `***`.
- Mỗi dòng (khoá `warehouse_code/material_code`; serial đã xuất khỏi kho nằm ở kho `-`):
  - `quantity`, `quantity_reserved`, `quantity_blocked`, `available`: cộng mọi vị trí của `material_inventory`;
    `avg_cost` là giá vốn bình quân đang lưu (nhiều vị trí thì bình quân theo tồn).
  - `ledger_quantity`, `ledger_entries`: tổng số lượng có dấu và số dòng của sổ kho `inventory_transactions`
    (nhập dương, xuất âm); `ledger_diff` = `quantity - ledger_quantity`, phải bằng 0.
  - `serials`: số serial theo `stock_state|quality_status` ở kho hiện tại (`serial_tracking`); `serials_in_stock`: số
    serial `IN_STOCK`.
  - `lot_count`, `lot_quantity`, `lot_reserved`, `lot_blocked`: cộng `lot_balances` của các lô thuộc mặt hàng.
- `summary` liệt kê dòng lệch: `ledgerMismatch` (tồn khác sổ kho), `serialMismatch` (mặt hàng quản lý serial có số serial
  `IN_STOCK` khác tồn), `lotMismatch` (mặt hàng có lô mà tổng lô khác tồn, ví dụ tồn cũ nhập trước khi quản lý lô).
  Đây là thông tin để thủ kho xem, không làm script thất bại.
- `--compare` so mọi chỉ số trên theo từng khoá (bỏ qua `takenAt`), in từng khác biệt dạng
  `kho/mặt hàng: chỉ số cũ -> mới`.
- Mã thoát: 0 khi chụp xong hoặc so khớp; 1 khi `--compare` thấy khác biệt; 2 khi lỗi tham số, kết nối hoặc DB chưa có
  phân hệ Kho.
- Tự kiểm: chụp hai lần liên tiếp khi không ai ghi sổ rồi `--compare` phải báo "Khớp".
