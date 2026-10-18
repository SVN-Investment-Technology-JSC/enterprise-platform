SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- HỢP ĐỒNG GẮN DỰ ÁN
--
-- Một hợp đồng có thể trỏ tới một dự án qua `project_id` (tuỳ chọn). ON DELETE
-- SET NULL: xoá dự án thì hợp đồng mất con trỏ chứ không mất hợp đồng.
-- ===========================================================================
ALTER TABLE workspace_schema.contracts
    ADD COLUMN IF NOT EXISTS project_id UUID
        REFERENCES workspace_schema.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_project
    ON workspace_schema.contracts (project_id);
