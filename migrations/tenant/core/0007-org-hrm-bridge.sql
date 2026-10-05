-- 1. Bổ sung employee_id vào bảng organization_node_assignments
ALTER TABLE core_schema.organization_node_assignments
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES core_schema.employees(id) ON DELETE RESTRICT;

-- 2. Backfill dữ liệu hiện có từ user_id sang employee_id
UPDATE core_schema.organization_node_assignments a
SET employee_id = e.id
FROM core_schema.employees e
WHERE e.user_id = a.user_id
  AND a.employee_id IS NULL
  AND a.deleted_at IS NULL;

-- 3. Tạo Index tối ưu hóa truy vấn quá trình công tác
CREATE INDEX IF NOT EXISTS idx_org_assignments_emp_career
  ON core_schema.organization_node_assignments (employee_id, status, start_date DESC)
  WHERE deleted_at IS NULL;

-- 4. View Quá trình công tác hợp nhất (Hỗ trợ truy vấn từ HRM)
CREATE OR REPLACE VIEW core_schema.employee_career_history AS
SELECT
  a.id AS assignment_id,
  a.employee_id,
  a.user_id,
  a.node_id AS position_node_id,
  pos.name  AS position_name,
  pos.code  AS position_code,
  unit.id   AS unit_node_id,
  unit.name AS unit_name,
  a.is_primary,
  a.start_date,
  a.end_date,
  a.status,
  a.note,
  a.created_at,
  a.updated_at
FROM core_schema.organization_node_assignments a
JOIN core_schema.organization_nodes pos ON pos.id = a.node_id AND pos.deleted_at IS NULL
LEFT JOIN core_schema.organization_nodes unit ON unit.id = pos.parent_id AND unit.deleted_at IS NULL
WHERE a.deleted_at IS NULL;
