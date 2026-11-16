-- Báo cáo tiến độ công việc (bám 1Office): mỗi lần người làm báo tiến độ là một dòng lịch sử, kèm ngày, người báo,
-- phần trăm và mô tả. Tiến độ hiện tại của công việc vẫn nằm ở work_items (manual_progress_percent / progress_percent);
-- bảng này là lịch sử, không phải nguồn tính tiến độ, nên xoá hết dòng cũng không làm đổi số liệu.
--  · Bản app cũ bỏ qua bảng mới.
--  · Tiến độ nhập tay có sẵn trước đây được chuyển thành một dòng báo cáo mỗi công việc, để lịch sử không bắt đầu
--    từ trống khi đã có số. Chạy lại không sinh thêm dòng (chỉ chuyển công việc chưa có báo cáo nào).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS workspace_schema.work_item_progress_reports (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    project_id   UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    -- Ngày người dùng báo cáo (mặc định hôm nay theo múi giờ tenant), khác created_at khi báo bù.
    reported_on  DATE NOT NULL,
    reported_by  UUID NOT NULL,
    percent      SMALLINT NOT NULL CHECK (percent BETWEEN 0 AND 100),
    description  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_item_progress_reports_item
    ON workspace_schema.work_item_progress_reports (work_item_id, created_at DESC);

INSERT INTO workspace_schema.work_item_progress_reports
    (work_item_id, project_id, reported_on, reported_by, percent, description)
SELECT w.id, w.project_id, w.updated_at::date, COALESCE(w.assignee_user_id, w.created_by),
       w.manual_progress_percent, 'Chuyển từ tiến độ nhập tay trước đây.'
  FROM workspace_schema.work_items w
 WHERE w.manual_progress_percent IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM workspace_schema.work_item_progress_reports r WHERE r.work_item_id = w.id);
