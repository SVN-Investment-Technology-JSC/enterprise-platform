SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Tuỳ chọn riêng của từng người dùng trong module Bảo trì (hiện chỉ có danh sách thẻ trang Tổng quan).
-- Khác module_settings (cấu hình chung của tenant, chỉ quản lý sửa): mỗi người tự đổi cho mình, không cần quyền.
-- user_id là TEXT vì định danh người dùng đến từ trusted context, không ép kiểu UUID ở đây.
-- Ghi đè theo người, không cần version: một người chỉ sửa trên vài thiết bị của chính mình.
CREATE TABLE IF NOT EXISTS maintenance_schema.user_preferences (
    user_id     TEXT         NOT NULL,
    key         VARCHAR(120) NOT NULL,
    value       JSONB        NOT NULL,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
);
