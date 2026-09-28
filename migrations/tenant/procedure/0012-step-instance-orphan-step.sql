SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Hồ sơ cũ trỏ vào một bước đã bị bỏ khỏi định nghĩa.
--
-- `step_instances` là bảng CHIẾU, dựng lại từ `instances.snapshot` ở mỗi lần
-- ghi, còn bảng `steps` chỉ chứa các bước của định nghĩa HIỆN TẠI. Sửa quy trình
-- (đưa về nháp, bỏ một bước, công bố lại) làm hồ sơ đã hoàn tất theo luật cũ trỏ
-- vào bước không còn tồn tại: khoá ngoại vỡ và MỌI lần ghi của tenant trả 500.
--
-- Cho phép `step_id` NULL: bước không còn trong định nghĩa hiện tại thì bản chiếu
-- ghi NULL. Khoá ngoại vẫn giữ cho mọi bước còn tồn tại. Không mất dữ liệu —
-- bước đầy đủ của hồ sơ vẫn nằm trong `instances.snapshot`.
ALTER TABLE procedure_schema.step_instances
  ALTER COLUMN step_id DROP NOT NULL;
