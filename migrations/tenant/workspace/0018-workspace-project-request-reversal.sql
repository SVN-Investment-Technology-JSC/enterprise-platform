SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Đơn từ bị huỷ hiệu lực: HRM báo trạng thái REVERSED kèm lý do. Workspace
-- chỉ ghi lại; yêu cầu huỷ từ tab "Đơn từ" đi qua sự kiện, module nguồn mới là
-- nơi thật sự huỷ đơn.
ALTER TABLE workspace_schema.project_requests
  DROP CONSTRAINT IF EXISTS chk_project_requests_status;
ALTER TABLE workspace_schema.project_requests
  ADD CONSTRAINT chk_project_requests_status
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVERSED'));

ALTER TABLE workspace_schema.project_requests
  -- Lý do module nguồn báo kèm trạng thái (hiện chỉ có khi huỷ hiệu lực).
  ADD COLUMN IF NOT EXISTS status_note             TEXT,
  -- Yêu cầu huỷ hiệu lực đã gửi từ Workspace, đang chờ module nguồn xử lý.
  ADD COLUMN IF NOT EXISTS reversal_requested_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_requested_by   UUID,
  ADD COLUMN IF NOT EXISTS reversal_requested_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS reversal_reason         TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_requested    BOOLEAN NOT NULL DEFAULT false,
  -- Module nguồn từ chối huỷ (vd vừa chốt kỳ lương): hiện cho người dùng biết.
  ADD COLUMN IF NOT EXISTS reversal_error          TEXT;
