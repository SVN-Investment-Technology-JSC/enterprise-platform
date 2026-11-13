-- Thư mục gốc do một phân hệ khác dựng và quản lý (ví dụ Văn thư lưu hồ sơ công văn vào kho tài liệu).
-- `system_module` là mã phân hệ đó; phân hệ tìm lại thư mục gốc của mình theo mã này dù người dùng đã đổi tên.
-- Thư mục cũ để trống cột này nên không đổi gì.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE shared_schema.folders
    ADD COLUMN IF NOT EXISTS system_module VARCHAR(40);

-- Mỗi phân hệ một thư mục gốc đang dùng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_folders_system_module
    ON shared_schema.folders (system_module)
    WHERE system_module IS NOT NULL AND parent_id IS NULL AND deleted_at IS NULL;
