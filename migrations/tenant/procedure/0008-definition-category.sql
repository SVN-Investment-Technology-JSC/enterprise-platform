SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Nhóm của quy trình, ví dụ "Kỹ thuật", "Tài chính".
--
-- Đây là HÌNH CHIẾU để truy vấn và lọc ở tầng SQL. Nguồn sự thật vẫn là
-- `procedure_schema.versions.snapshot` — toàn bộ object định nghĩa được ghi lại
-- ở đó mỗi lần lưu, và `readNormalized` đọc ra từ đó. Thêm cột mà quên đưa
-- trường vào snapshot thì dữ liệu sẽ bị lần đồng bộ kế tiếp xoá sạch.
--
-- Cố ý KHÔNG đặt NOT NULL: 18 quy trình đã công bố trước đợt này chưa có nhóm.
-- Ràng buộc "phải có nhóm mới công bố được" nằm ở tầng ứng dụng, chỉ áp cho lần
-- công bố tiếp theo, nên bản đã công bố cũ vẫn chạy bình thường.
--
-- Danh mục nhóm không nằm ở đây mà là một khoá trong
-- `procedure_schema.module_settings` (`catalog.group`), để admin thêm/xoá nhóm
-- mà không cần migration.
ALTER TABLE procedure_schema.definitions
  ADD COLUMN IF NOT EXISTS category varchar(80);

CREATE INDEX IF NOT EXISTS definitions_category_idx
  ON procedure_schema.definitions (category)
  WHERE category IS NOT NULL;
