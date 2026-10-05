SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Quyết định nhân sự (bổ nhiệm, thăng chức, điều chuyển, kiêm nhiệm, miễn nhiệm,
-- đổi người quản lý). Một quyết định gộp chức danh mới, người quản lý trực tiếp
-- mới và thay đổi lương để mọi thay đổi cùng một căn cứ, một ngày hiệu lực.
--
-- Chức danh nằm ở Core: HRM chỉ ghi qua endpoint nội bộ, nên bảng này giữ ảnh
-- chụp "trước/sau" (kể cả tên) để quyết định vẫn đọc được khi nút chức danh bị
-- đổi tên hoặc xóa.
CREATE TABLE IF NOT EXISTS hrm_schema.personnel_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  decision_no varchar(50) NOT NULL,
  decision_type varchar(20) NOT NULL
    CHECK (decision_type IN ('APPOINT','PROMOTE','TRANSFER','CONCURRENT','DISMISS','CHANGE_MANAGER')),
  employee_id uuid NOT NULL,
  effective_date date NOT NULL,
  reason text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','APPLY_PENDING','APPLIED','REJECTED','CANCELLED')),

  -- Trước
  from_position_node_id uuid,
  from_position_name varchar(255),
  from_unit_name varchar(255),
  from_manager_employee_id uuid,
  from_salary_grade_id uuid REFERENCES hrm_schema.salary_grades(id),
  from_salary_step_id uuid REFERENCES hrm_schema.salary_grade_steps(id),
  from_base_salary numeric(15,2),

  -- Sau
  to_position_node_id uuid,
  to_position_name varchar(255),
  to_unit_name varchar(255),
  manager_mode varchar(10) NOT NULL DEFAULT 'KEEP' CHECK (manager_mode IN ('KEEP','SET','CLEAR')),
  to_manager_employee_id uuid,
  subordinate_mode varchar(10) NOT NULL DEFAULT 'KEEP' CHECK (subordinate_mode IN ('KEEP','REASSIGN')),
  subordinate_target_employee_id uuid,
  salary_changed boolean NOT NULL DEFAULT false,
  to_salary_grade_id uuid REFERENCES hrm_schema.salary_grades(id),
  to_salary_step_id uuid REFERENCES hrm_schema.salary_grade_steps(id),
  to_salary_type varchar(10) CHECK (to_salary_type IS NULL OR to_salary_type IN ('GROSS','NET')),
  to_base_salary numeric(15,2),
  attachment_id uuid REFERENCES hrm_schema.attachments(id),

  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,
  applied_at timestamptz,
  core_assignment_id uuid,
  -- Tiến độ áp dụng theo bước, để thử lại tiếp tục từ bước lỗi thay vì làm lại.
  applied_steps jsonb NOT NULL DEFAULT '{}'::jsonb,
  apply_attempts integer NOT NULL DEFAULT 0,
  apply_error text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrm_personnel_decision_no UNIQUE (tenant_id, decision_no),
  CONSTRAINT ck_hrm_personnel_decision_target CHECK (
    decision_type IN ('DISMISS','CHANGE_MANAGER') OR to_position_node_id IS NOT NULL
  ),
  CONSTRAINT ck_hrm_personnel_decision_manager CHECK (
    manager_mode <> 'SET' OR to_manager_employee_id IS NOT NULL
  ),
  CONSTRAINT ck_hrm_personnel_decision_reassign CHECK (
    subordinate_mode <> 'REASSIGN' OR subordinate_target_employee_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS idx_hrm_personnel_decisions_employee
  ON hrm_schema.personnel_decisions (tenant_id, employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_hrm_personnel_decisions_due
  ON hrm_schema.personnel_decisions (tenant_id, effective_date)
  WHERE status IN ('APPROVED','APPLY_PENDING');

-- Người quản lý trực tiếp: nhân viên báo cáo cho nhân viên, có hiệu lực theo
-- ngày, không phụ thuộc sơ đồ tổ chức của Core.
CREATE TABLE IF NOT EXISTS hrm_schema.employee_reporting_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  manager_employee_id uuid NOT NULL,
  relation_type varchar(10) NOT NULL DEFAULT 'DIRECT' CHECK (relation_type IN ('DIRECT','DOTTED')),
  effective_from date NOT NULL,
  effective_to date,
  decision_id uuid REFERENCES hrm_schema.personnel_decisions(id),
  source varchar(12) NOT NULL DEFAULT 'DECISION' CHECK (source IN ('DECISION','MANUAL','IMPORT','CORE_SYNC')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hrm_reporting_not_self CHECK (employee_id <> manager_employee_id),
  CONSTRAINT ck_hrm_reporting_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- Mỗi nhân viên chỉ có một quản lý trực tiếp đang mở; chồng lấn theo ngày do service kiểm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_reporting_open_direct
  ON hrm_schema.employee_reporting_lines (tenant_id, employee_id)
  WHERE effective_to IS NULL AND relation_type = 'DIRECT';
-- Một quyết định chỉ sinh một dòng báo cáo cho mỗi nhân viên (idempotent khi thử lại).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_reporting_decision_employee
  ON hrm_schema.employee_reporting_lines (decision_id, employee_id)
  WHERE decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hrm_reporting_manager
  ON hrm_schema.employee_reporting_lines (tenant_id, manager_employee_id, effective_from)
  WHERE relation_type = 'DIRECT';
CREATE INDEX IF NOT EXISTS idx_hrm_reporting_employee
  ON hrm_schema.employee_reporting_lines (tenant_id, employee_id, effective_from DESC);
