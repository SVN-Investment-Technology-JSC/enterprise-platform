-- Báo cáo tiến độ cho Công việc khác (việc ngoài dự án), cùng chuẩn với công việc trong dự án (xem 0038): mỗi lần người
-- làm báo tiến độ là một dòng lịch sử gồm ngày, người báo, phần trăm và mô tả. Tiến độ hiện tại vẫn nằm ở
-- standalone_tasks (manual_progress_percent / progress_percent); bảng này chỉ là lịch sử nên xoá dòng không đổi số liệu.
--  · Bản app cũ bỏ qua bảng mới.
--  · Số nhập tay có sẵn được chuyển thành một dòng báo cáo mỗi việc; chạy lại không sinh thêm dòng.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS workspace_schema.standalone_task_progress_reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES workspace_schema.standalone_tasks(id) ON DELETE CASCADE,
    reported_on DATE NOT NULL,
    reported_by UUID NOT NULL,
    percent     SMALLINT NOT NULL CHECK (percent BETWEEN 0 AND 100),
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standalone_task_progress_reports_task
    ON workspace_schema.standalone_task_progress_reports (task_id, created_at DESC);

INSERT INTO workspace_schema.standalone_task_progress_reports
    (task_id, reported_on, reported_by, percent, description)
SELECT t.id, t.updated_at::date, COALESCE(t.assignee_user_id, t.created_by),
       t.manual_progress_percent, 'Chuyển từ tiến độ nhập tay trước đây.'
  FROM workspace_schema.standalone_tasks t
 WHERE t.manual_progress_percent IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM workspace_schema.standalone_task_progress_reports r WHERE r.task_id = t.id);
