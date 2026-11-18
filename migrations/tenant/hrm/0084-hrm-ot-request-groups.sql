-- Đơn làm thêm nhiều khoảng: các khoảng của một lần gửi dùng chung `group_id` (bằng id của khoảng chính). Khoảng chính nối quy
-- trình duyệt; duyệt hoặc từ chối khoảng chính thì cả nhóm đổi trạng thái cùng lúc. Chỉ thêm cột và chỉ mục.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS group_id uuid;
CREATE INDEX IF NOT EXISTS idx_hrm_ot_requests_group
  ON hrm_schema.ot_requests (tenant_id, group_id) WHERE group_id IS NOT NULL;
