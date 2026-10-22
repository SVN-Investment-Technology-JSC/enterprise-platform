-- Danh mục nhóm dự án (trước gọi là "loại dự án"): tenant tự thêm, sửa, xoá ở Cài đặt.
-- Dự án vẫn trỏ tới nhóm qua cột chữ projects.project_type để bản app cũ chạy được với schema mới;
-- đổi tên nhóm thì tầng application cập nhật cột đó trong cùng transaction.
-- Dữ liệu cũ: mọi giá trị project_type đang dùng được đưa vào danh mục.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS workspace_schema.project_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(80) NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 100,
    created_by  UUID,
    updated_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tên nhóm không trùng, không phân biệt hoa thường.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_groups_name
    ON workspace_schema.project_groups (lower(name));

INSERT INTO workspace_schema.project_groups (name)
SELECT DISTINCT trim(project_type)
  FROM workspace_schema.projects
 WHERE project_type IS NOT NULL AND trim(project_type) <> ''
ON CONFLICT DO NOTHING;
