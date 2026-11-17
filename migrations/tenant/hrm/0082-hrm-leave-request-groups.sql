-- Đơn nghỉ nhiều khoản: các khoản của một lần gửi dùng chung `group_id` (bằng id của khoản chính). Khoản chính nối quy trình
-- duyệt; duyệt, từ chối hoặc hủy một khoản thì cả nhóm đổi trạng thái cùng lúc. Chỉ thêm cột và chỉ mục.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS idx_hrm_leave_requests_group
  ON hrm_schema.leave_requests (tenant_id, group_id) WHERE group_id IS NOT NULL;
