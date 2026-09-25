-- Tên thư mục chỉ cần duy nhất trong số thư mục CÒN HOẠT ĐỘNG.
--
-- Gỡ thư mục là `is_active = false` chứ không xoá dòng, nên ràng buộc cũ vẫn
-- tính cả những thư mục đã gỡ: xoá "Hợp đồng" rồi tạo lại "Hợp đồng" sẽ bị từ
-- chối vì trùng tên với một thư mục người dùng không còn nhìn thấy nữa.
--
-- Hai chỉ mục cùng phủ (project_id, parent_id, name): một sinh từ ràng buộc
-- UNIQUE lúc tạo bảng, một thêm ở `0008`. Bỏ cả hai rồi dựng lại đúng một chỉ
-- mục có điều kiện.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.document_folders
  DROP CONSTRAINT IF EXISTS document_folders_project_id_parent_id_name_key;

DROP INDEX IF EXISTS workspace_schema.uq_document_folders_scope_name;

-- `NULLS NOT DISTINCT`: thư mục cấp đơn vị có `project_id` rỗng và thư mục gốc
-- có `parent_id` rỗng; thiếu mệnh đề này thì Postgres coi mọi NULL là khác
-- nhau và ràng buộc mất tác dụng đúng ở hai chỗ cần nó nhất.
CREATE UNIQUE INDEX uq_document_folders_scope_name
  ON workspace_schema.document_folders (project_id, parent_id, name)
  NULLS NOT DISTINCT
  WHERE is_active;
