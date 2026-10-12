SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Mẫu lọc cho tab "Đơn từ" của dự án: thêm `project_requests` vào danh sách
-- màn hình được lưu mẫu lọc (khớp `SAVED_FILTER_VIEWS` trong contracts).
ALTER TABLE workspace_schema.saved_filters
    DROP CONSTRAINT IF EXISTS saved_filters_view_key_check;
ALTER TABLE workspace_schema.saved_filters
    ADD CONSTRAINT saved_filters_view_key_check
        CHECK (view_key IN ('projects', 'work_items', 'documents', 'calendar', 'reports', 'project_requests'));
