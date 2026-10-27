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
