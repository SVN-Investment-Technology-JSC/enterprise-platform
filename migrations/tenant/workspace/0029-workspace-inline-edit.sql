-- Sửa nhanh công việc và dự án ngay trên danh sách.
--  · manual_progress_percent: tiến độ người dùng tự nhập cho công việc và dự án. Có giá trị thì được dùng thay cho
--    tiến độ tự tính; NULL là dùng tiến độ tự tính như trước. Cột mới để trống, bản app cũ bỏ qua.
--  · Bỏ CHECK cố định của priority: mức ưu tiên do tenant tự đặt ở Cài đặt; app kiểm giá trị theo danh mục đó.
--  · work_item_change_log: nhật ký sửa các trường của công việc (tên, hạn, ưu tiên, người làm…). Tách khỏi
--    work_item_status_history vì bảng đó còn được đếm "đã hoàn thành" theo to_status.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.work_items
    ADD COLUMN IF NOT EXISTS manual_progress_percent SMALLINT
        CHECK (manual_progress_percent BETWEEN 0 AND 100);

ALTER TABLE workspace_schema.projects
    ADD COLUMN IF NOT EXISTS manual_progress_percent SMALLINT
        CHECK (manual_progress_percent BETWEEN 0 AND 100);

ALTER TABLE workspace_schema.work_items
    DROP CONSTRAINT IF EXISTS work_items_priority_check;

ALTER TABLE workspace_schema.standalone_tasks
    DROP CONSTRAINT IF EXISTS standalone_tasks_priority_check;

CREATE TABLE IF NOT EXISTS workspace_schema.work_item_change_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    project_id   UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    -- Mảng [{ field, from, to }], giá trị thô (id người, id nhãn, ngày ISO…); giao diện tự đổi ra chữ.
    changes      JSONB NOT NULL,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_item_change_log_item
    ON workspace_schema.work_item_change_log (work_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_item_change_log_project
    ON workspace_schema.work_item_change_log (project_id, created_at DESC);
