-- Hoàn tác công việc đã hoàn thành: người tạo việc chọn ai được mở lại.
--  · work_items.reopen_policy: 'assignee' = người phụ trách / cùng thực hiện và quản lý dự án (hành vi cũ, nên là
--    mặc định cho mọi việc đã có), 'manager' = chỉ quản lý dự án, 'none' = không hoàn tác được.
-- Bản app cũ bỏ qua cột mới. Cách xử lý dự án đã Hoàn thành khi có việc được hoàn tác là cài đặt của tenant, lưu ở
-- workspace_settings nên không cần cột.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.work_items
    ADD COLUMN IF NOT EXISTS reopen_policy VARCHAR(16) NOT NULL DEFAULT 'assignee';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_work_items_reopen_policy'
    ) THEN
        ALTER TABLE workspace_schema.work_items
            ADD CONSTRAINT chk_work_items_reopen_policy CHECK (reopen_policy IN ('assignee', 'manager', 'none'));
    END IF;
END $$;
