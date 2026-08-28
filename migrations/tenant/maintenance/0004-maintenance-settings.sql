SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Cấu hình module Bảo trì. Cùng khuôn với inventory_schema.module_settings: một
-- bảng khoá–giá trị cho cả module, nên danh mục tần suất và mọi cấu hình về sau
-- chỉ là một khoá mới chứ không phát sinh bảng và không phải sửa danh sách
-- migration trong apps/migrator nữa.
--
-- Khoá là union đóng trong contracts-maintenance và mỗi khoá có giá trị mặc
-- định có kiểu, nên một dòng hỏng rơi về mặc định thay vì làm chết màn hình.
CREATE TABLE IF NOT EXISTS maintenance_schema.module_settings (
    key         VARCHAR(120) PRIMARY KEY,
    value       JSONB        NOT NULL,
    -- Tăng sau mỗi lần ghi, để hai admin sửa cùng lúc không ghi đè im lặng.
    version     INTEGER      NOT NULL DEFAULT 1,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by  UUID
);
