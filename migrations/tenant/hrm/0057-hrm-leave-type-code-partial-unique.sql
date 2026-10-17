SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Mã loại nghỉ chỉ cần duy nhất trong các loại còn hoạt động: loại đã xóa mềm (deleted_at) không giữ chỗ mã nữa,
-- để quản trị có thể tạo lại loại cùng mã. Dòng đã xóa vẫn còn nguyên cho đơn và sổ phép cũ trỏ về.
ALTER TABLE hrm_schema.leave_types
  DROP CONSTRAINT IF EXISTS uq_hrm_leave_types_code;

DROP INDEX IF EXISTS hrm_schema.uq_hrm_leave_types_code;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_leave_types_tenant_code_live
  ON hrm_schema.leave_types (tenant_id, code)
  WHERE deleted_at IS NULL;
