-- Sửa nhanh công việc ngoài dự án (Công việc khác), cùng cách với công việc dự án ở 0029.
--  · manual_progress_percent: tiến độ người dùng tự nhập; có giá trị thì dùng thay tiến độ tự tính từ việc con.
--    NULL là dùng tiến độ tự tính như trước. Cột mới để trống, bản app cũ bỏ qua.
--  · standalone_task_change_log: nhật ký sửa các trường (tên, hạn, ưu tiên, người làm…), tách khỏi
--    standalone_task_history vốn chỉ ghi đổi trạng thái (to_status bắt buộc).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.standalone_tasks
    ADD COLUMN IF NOT EXISTS manual_progress_percent SMALLINT
        CHECK (manual_progress_percent BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS workspace_schema.standalone_task_change_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES workspace_schema.standalone_tasks(id) ON DELETE CASCADE,
    -- Mảng [{ field, from, to }], giá trị thô (id người, ngày ISO…); giao diện tự đổi ra chữ.
    changes     JSONB NOT NULL,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standalone_task_change_log_task
    ON workspace_schema.standalone_task_change_log (task_id, created_at DESC);
