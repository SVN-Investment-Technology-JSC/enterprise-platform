-- Mã dự án tự sinh theo quy tắc do tenant đặt ở Cài đặt (vd DA_{NHOM}_{SO:4} → DA_DVTN_0001).
--  · project_groups.code: mã viết tắt của nhóm dự án, dùng cho token {NHOM}. Cột mới, để trống được; bản app cũ bỏ qua.
--  · workspace_settings: cài đặt dùng chung toàn tenant dạng khoá → giá trị JSON; chưa có dòng nào thì app dùng quy
--    tắc mặc định. Dự án cũ giữ nguyên mã.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.project_groups
    ADD COLUMN IF NOT EXISTS code VARCHAR(16);

-- Mã viết tắt không trùng giữa các nhóm (không phân biệt hoa thường); nhóm chưa đặt mã thì không tính.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_groups_code
    ON workspace_schema.project_groups (upper(code))
    WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_schema.workspace_settings (
    key         VARCHAR(64) PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
