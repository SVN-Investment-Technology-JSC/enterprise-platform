-- WS-U5: xoá công việc vẫn ghi lại trong nhật ký hoạt động của dự án.
-- Dòng ghi "đã xoá" có work_item_id = NULL (công việc đã bị gỡ), chỉ neo theo
-- project_id nên không bị ON DELETE CASCADE cuốn theo khi xoá công việc.
ALTER TABLE workspace_schema.work_item_status_history
    ALTER COLUMN work_item_id DROP NOT NULL;
