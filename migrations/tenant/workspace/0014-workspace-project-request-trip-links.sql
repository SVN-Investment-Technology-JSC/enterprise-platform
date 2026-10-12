SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- ĐƠN TỰ GẮN THEO ĐƠN CÔNG TÁC
--
-- Một đơn (vd. nghỉ phép) rơi vào nhiều đợt công tác thì hiện ở mọi dự án liên
-- quan, mỗi dự án một mã DT riêng. `linked_via_*` trỏ tới đơn công tác đã kéo
-- đơn này vào dự án; rỗng nghĩa là người gửi tự chọn dự án.
-- ===========================================================================
ALTER TABLE workspace_schema.project_requests
    ADD COLUMN IF NOT EXISTS linked_via_kind VARCHAR(40),
    ADD COLUMN IF NOT EXISTS linked_via_source_id UUID;

ALTER TABLE workspace_schema.project_requests
    DROP CONSTRAINT IF EXISTS project_requests_source_module_source_kind_source_id_key;
ALTER TABLE workspace_schema.project_requests
    DROP CONSTRAINT IF EXISTS uq_project_requests_project_source;
ALTER TABLE workspace_schema.project_requests
    ADD CONSTRAINT uq_project_requests_project_source
        UNIQUE (project_id, source_module, source_kind, source_id);

-- Cập nhật trạng thái tìm theo nguồn, không theo dự án.
CREATE INDEX IF NOT EXISTS idx_project_requests_source
    ON workspace_schema.project_requests (source_module, source_kind, source_id);
