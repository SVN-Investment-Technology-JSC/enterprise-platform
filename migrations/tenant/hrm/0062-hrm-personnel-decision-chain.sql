SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Chuỗi kiêm nhiệm: một quyết định Kiêm nhiệm (thay thế kiêm nhiệm cũ) hoặc Bãi nhiệm trỏ về quyết định
-- Kiêm nhiệm mà nó nối tiếp. Nhờ đó "kiêm nhiệm kế toán rồi lên kế toán trưởng" là một nhánh liền mạch,
-- không phải ghép theo tên chức danh.
ALTER TABLE hrm_schema.personnel_decisions
  ADD COLUMN IF NOT EXISTS replaces_decision_id uuid REFERENCES hrm_schema.personnel_decisions(id);
CREATE INDEX IF NOT EXISTS idx_hrm_personnel_decisions_replaces
  ON hrm_schema.personnel_decisions (tenant_id, replaces_decision_id)
  WHERE replaces_decision_id IS NOT NULL;
