SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- NGƯỜI THỰC HIỆN CÙNG
--
-- `work_items.assignee_user_id` vẫn là người PHỤ TRÁCH chính — người chịu
-- trách nhiệm, nhận thông báo giao việc. Bảng này giữ những người cùng làm
-- việc đó (1Office gọi là "người thực hiện"). Họ thấy việc trong "Việc của
-- tôi" và được cập nhật việc như người phụ trách; tầng ứng dụng bắt họ phải
-- là thành viên dự án, cùng luật với người phụ trách.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.work_item_participants (
    work_item_id UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (work_item_id, user_id)
);

-- "Việc của tôi": tìm mọi việc một người đang cùng thực hiện.
CREATE INDEX IF NOT EXISTS idx_work_item_participants_user
    ON workspace_schema.work_item_participants (user_id);

-- ===========================================================================
-- LOẠI DỰ ÁN
--
-- Chữ tự do (Dịch vụ thí nghiệm, Bảo trì, Kỹ thuật…), gợi ý từ các loại đã
-- dùng; không có bảng danh mục riêng để không phải dựng thêm màn quản trị.
-- ===========================================================================
ALTER TABLE workspace_schema.projects
    ADD COLUMN IF NOT EXISTS project_type VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_projects_type
    ON workspace_schema.projects (project_type);
