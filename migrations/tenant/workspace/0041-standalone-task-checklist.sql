-- Đầu việc (checklist) cho Công việc khác (việc ngoài dự án), cùng chuẩn với work_item_checklist_items (xem 0039):
-- tiến độ của việc lẻ không có việc con được tính theo tỷ lệ đầu việc đã tích. Việc lẻ không có "cách tính tiến độ",
-- nên bảng này chỉ lưu đầu việc; tầng ứng dụng tự ghi phần trăm khi có đầu việc.
--  · Dữ liệu cũ không đổi (việc chưa có đầu việc giữ nguyên số nhập tay).
--  · Bản app cũ bỏ qua bảng mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS workspace_schema.standalone_task_checklist_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES workspace_schema.standalone_tasks(id) ON DELETE CASCADE,
    title      VARCHAR(200) NOT NULL,
    done       BOOLEAN NOT NULL DEFAULT FALSE,
    done_at    TIMESTAMPTZ,
    done_by    UUID,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standalone_task_checklist_items_task
    ON workspace_schema.standalone_task_checklist_items (task_id, sort_order, created_at);
