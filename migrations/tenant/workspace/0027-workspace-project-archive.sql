-- Lưu trữ dự án: dự án hoàn thành tự được lưu trữ (ẩn khỏi danh sách dự án đang làm và thanh bên), người dùng
-- "Mở lưu trữ" khi cần thêm công việc thì dự án về lại "Đang chạy". Cột mới, bản app cũ bỏ qua được.
-- Dữ liệu cũ: dự án đang ở trạng thái hoàn thành được lưu trữ luôn, mốc là lần cập nhật cuối.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.projects
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_projects_archived_at
    ON workspace_schema.projects (archived_at);

UPDATE workspace_schema.projects
   SET archived_at = updated_at
 WHERE status = 'completed' AND archived_at IS NULL;
