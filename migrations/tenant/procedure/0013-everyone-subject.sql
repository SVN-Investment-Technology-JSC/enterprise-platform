SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Chủ thể "Toàn bộ nhân viên": như initiator_manager, không trỏ vào id cụ thể nên subject_id để trống.
-- Chỉ dùng cho vai S (mọi nhân viên đều được khởi tạo hồ sơ). Nguồn sự thật vẫn là versions.snapshot.
ALTER TABLE procedure_schema.raci_assignments
  DROP CONSTRAINT IF EXISTS procedure_raci_subject_check;
ALTER TABLE procedure_schema.raci_assignments
  ADD CONSTRAINT procedure_raci_subject_check
  CHECK (subject_type IN ('organization_unit', 'position', 'user', 'initiator_manager', 'everyone'));

ALTER TABLE procedure_schema.raci_assignments
  DROP CONSTRAINT IF EXISTS procedure_raci_subject_id_check;
ALTER TABLE procedure_schema.raci_assignments
  ADD CONSTRAINT procedure_raci_subject_id_check
  CHECK (subject_type IN ('initiator_manager', 'everyone') OR subject_id IS NOT NULL);
