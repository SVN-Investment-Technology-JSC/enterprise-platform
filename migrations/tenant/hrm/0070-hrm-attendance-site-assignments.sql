-- Gán địa điểm chấm công cho phòng ban/chi nhánh, chức danh hoặc nhân viên cụ thể.
-- Hỗ trợ phân quyền chấm công GPS đa văn phòng theo cây tổ chức.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS hrm_schema.attendance_site_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES hrm_schema.attendance_sites(id) ON DELETE CASCADE,
  scope_type varchar(30) NOT NULL,
  scope_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT attendance_site_scope_check CHECK (scope_type IN ('COMPANY', 'UNIT', 'POSITION', 'EMPLOYEE')),
  CONSTRAINT uq_attendance_site_scope UNIQUE (tenant_id, site_id, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_site_assignments_scope
  ON hrm_schema.attendance_site_assignments (tenant_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_attendance_site_assignments_site
  ON hrm_schema.attendance_site_assignments (tenant_id, site_id);
