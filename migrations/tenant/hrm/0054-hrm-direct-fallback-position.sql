SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Cấu hình duyệt trực tiếp (mode DIRECT) có thể chọn một chức danh duyệt dự phòng (fallback_position_id).
-- Quản lý trực tiếp hoặc người đang giữ chức danh này đều có thể nhận và duyệt đơn.
ALTER TABLE hrm_schema.request_procedure_bindings
  ADD COLUMN IF NOT EXISTS fallback_position_id uuid;
