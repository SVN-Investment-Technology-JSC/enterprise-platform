SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Thêm cột deleted_at cho danh mục ca (shift_definitions) để hỗ trợ xóa mềm (soft delete).
-- Ca đã phát sinh dữ liệu (lịch phân ca / chấm công / mẫu ca) khi xóa sẽ được đặt deleted_at = now() và status = 'INACTIVE',
-- không còn hiển thị trên danh mục ca nhưng giữ toàn vẹn dữ liệu lịch sử liên kết.
ALTER TABLE hrm_schema.shift_definitions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Đổi ràng buộc UNIQUE code sang partial index chỉ xét các ca chưa xóa (deleted_at IS NULL).
ALTER TABLE hrm_schema.shift_definitions
  DROP CONSTRAINT IF EXISTS uq_hrm_shift_definitions_code;

CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_shift_definitions_tenant_code_live
  ON hrm_schema.shift_definitions (tenant_id, lower(code))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hrm_shift_definitions_tenant_live
  ON hrm_schema.shift_definitions (tenant_id, status)
  WHERE deleted_at IS NULL;
