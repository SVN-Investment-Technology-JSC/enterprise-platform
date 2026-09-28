SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Người duyệt động: "Quản lý trực tiếp của người khởi tạo".
--
-- Assignment kiểu `initiator_manager` không trỏ vào ai cố định — nó được phân
-- giải thành một chức danh lúc bước được kích hoạt. Trong bảng chiếu của định
-- nghĩa nó vì vậy không có `subject_id`. Nguồn sự thật vẫn là
-- `versions.snapshot`; đây chỉ là bản chiếu để truy vấn.
--
-- CHECK cũ có hai tên tuỳ đường tạo bảng: `procedure_raci_subject_check` (tạo
-- từ 0001 của module) hoặc tên Postgres tự đặt khi CHECK viết inline
-- (0002-normalized-model). Gỡ cả hai rồi đặt lại một tên cố định.
ALTER TABLE procedure_schema.raci_assignments
  ALTER COLUMN subject_id DROP NOT NULL;

ALTER TABLE procedure_schema.raci_assignments
  DROP CONSTRAINT IF EXISTS procedure_raci_subject_check;

ALTER TABLE procedure_schema.raci_assignments
  DROP CONSTRAINT IF EXISTS raci_assignments_subject_type_check;

ALTER TABLE procedure_schema.raci_assignments
  ADD CONSTRAINT procedure_raci_subject_check
  CHECK (subject_type IN ('organization_unit', 'position', 'user', 'initiator_manager'));

-- Chủ thể cố định thì vẫn phải có id; chỉ chủ thể động được để trống.
ALTER TABLE procedure_schema.raci_assignments
  DROP CONSTRAINT IF EXISTS procedure_raci_subject_id_check;

ALTER TABLE procedure_schema.raci_assignments
  ADD CONSTRAINT procedure_raci_subject_id_check
  CHECK (subject_type = 'initiator_manager' OR subject_id IS NOT NULL);
