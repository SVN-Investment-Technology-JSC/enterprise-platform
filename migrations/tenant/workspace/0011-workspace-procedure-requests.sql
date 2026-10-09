SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- YÊU CẦU MỞ HỒ SƠ QUY TRÌNH CHO CÔNG VIỆC
--
-- Workspace không gọi sang module Quy trình. Công việc "Theo quy trình" ghi
-- một yêu cầu ở đây và phát sự kiện; Quy trình tự kiểm quyền, mở hồ sơ rồi
-- báo kết quả về, và dòng này chuyển sang started / rejected.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.work_item_procedure_requests (
  work_item_id  UUID PRIMARY KEY REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
  definition_id UUID NOT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'pending',
  instance_id   UUID,
  error         TEXT,
  requested_by  UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_work_item_procedure_requests_status
    CHECK (status IN ('pending', 'started', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_work_item_procedure_requests_project
  ON workspace_schema.work_item_procedure_requests (project_id);
