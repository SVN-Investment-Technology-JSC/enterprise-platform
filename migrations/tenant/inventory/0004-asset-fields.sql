SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Bốn trường bổ sung cho hồ sơ thiết bị, theo yêu cầu 21/8.
--
-- "Tình trạng" KHÔNG thêm cột mới: `assets.status` đã có sẵn từ 0001 với đủ bốn
-- giá trị OPERATING/STOPPED/MAINTENANCE/DISPOSED, chỉ là chưa có giao diện nào
-- sửa nó. Thêm cột thứ hai cùng nghĩa sẽ tạo ra hai nguồn sự thật.
--
-- Giá lưu kèm mã tiền tệ thay vì giả định VND: một tenant có thể nhập thiết bị
-- theo ngoại tệ, và số tiền không mang mã tiền thì không đối chiếu được.
-- Không đặt DEFAULT cho giá — 0 và "chưa khai báo" là hai chuyện khác nhau.
ALTER TABLE inventory_schema.assets
  ADD COLUMN IF NOT EXISTS unit varchar(50),
  ADD COLUMN IF NOT EXISTS purchase_price numeric(18,4),
  ADD COLUMN IF NOT EXISTS currency varchar(8),
  ADD COLUMN IF NOT EXISTS warranty_until date;

CREATE INDEX IF NOT EXISTS idx_inventory_assets_warranty
  ON inventory_schema.assets (warranty_until)
  WHERE warranty_until IS NOT NULL;
