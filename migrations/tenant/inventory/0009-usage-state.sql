-- "Đang ở đâu" của một vật tư: đang vận hành, cho mượn thí nghiệm, gửi đi sửa…
--
-- Khác hẳn `status` (tình trạng: còn tốt / hỏng / đang bảo trì). Hai câu hỏi
-- độc lập nhau: một máy biến áp có thể vừa "còn tốt" vừa "đang cho mượn". Gộp
-- vào một cột sẽ buộc người dùng chọn một trong hai và mất vế còn lại.
--
-- Cũng khác `warehouse_locations` — cột đó là vị trí VẬT LÝ trong một kho (kệ,
-- ô), còn cột này là trạng thái SỬ DỤNG, dùng được cả khi hàng không ở kho nào.
--
-- Không đặt CHECK: danh sách giá trị do admin tenant khai trong Cài đặt, mỗi
-- tenant một khác. Đặt CHECK ở đây là khoá cứng đúng thứ vừa mở ra cho họ.
ALTER TABLE inventory_schema.materials
  ADD COLUMN IF NOT EXISTS usage_state varchar(50);

-- Gỡ hai CHECK đang khoá cứng giá trị của hàng theo sê-ri.
--
-- `serial_tracking` sinh ra từ migration đầu tiên với danh sách giá trị viết
-- thẳng vào ràng buộc. Chừng nào chúng còn đó thì admin không thêm được giá trị
-- của riêng mình — thêm "mượn thí nghiệm" là database từ chối, và lỗi hiện ra
-- dưới dạng 500 chứ không phải một câu giải thích.
--
-- Bỏ ràng buộc KHÔNG làm mất dữ liệu: bảng chỉ có thêm giá trị hợp lệ, mọi dòng
-- đang có vẫn đúng như trước.
ALTER TABLE inventory_schema.serial_tracking
  DROP CONSTRAINT IF EXISTS serial_tracking_current_status_check,
  DROP CONSTRAINT IF EXISTS serial_tracking_location_type_check;

-- `assets` là VIEW với danh sách cột CỐ ĐỊNH (xem 0006, 0008). Thêm cột vào
-- bảng gốc không tự đưa nó vào view, nên phải dựng lại — nếu không thì mọi
-- SELECT/UPDATE qua view đều không thấy `usage_state`.
CREATE OR REPLACE VIEW inventory_schema.assets AS
  SELECT id, code, internal_code, name, parent_id, type, org_unit_id, serial_number,
         status, criticality, specs, task_template, qr_code, unit,
         purchase_price, currency, warranty_until, kind, created_at, updated_at,
         manufacture_year, supplier, manufacturer, usage_state
    FROM inventory_schema.materials
   WHERE kind = 'ASSET'
  WITH CASCADED CHECK OPTION;

-- Đặt lại mặc định `kind`: CREATE OR REPLACE VIEW dựng lại định nghĩa nên mặc
-- định cột đặt ở lần trước bị mất, và INSERT qua view sẽ tạo ra dòng STOCK.
ALTER VIEW inventory_schema.assets ALTER COLUMN kind SET DEFAULT 'ASSET';
