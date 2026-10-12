-- Lịch định kỳ không có ngày kết thúc: gán một lần (cho nhân viên / phòng ban / toàn công ty), chạy mãi đến khi kết thúc.
-- Khác employee_work_days (sinh sẵn từng ngày cho một khoảng cố định), lịch định kỳ được tra khi cần, nên không phải gán lại theo kỳ.
-- Thứ tự ưu tiên khi tra ca: employee_work_days (ngoại lệ, ngày lễ, lịch gán theo khoảng ngày)
--   > lịch định kỳ của nhân viên > của phòng ban gần nhất (đi dần lên đơn vị cha) > của toàn công ty
--   > shift_assignments / unit_shift_assignments (lớp cũ).
-- Chỉ thêm bảng mới. Sửa mẫu lịch KHÔNG đổi lịch định kỳ đã gán (mẫu được chụp vào work_schedule_rule_days).

CREATE TABLE IF NOT EXISTS hrm_schema.work_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('EMPLOYEE', 'UNIT', 'COMPANY')),
  employee_id uuid,
  unit_id uuid REFERENCES core_schema.organization_nodes(id),
  effective_from date NOT NULL,
  -- NULL = không có ngày kết thúc.
  effective_to date,
  template_id uuid,
  template_name varchar(200),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  batch_id uuid REFERENCES hrm_schema.work_schedule_batches(id),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (
    (scope_type = 'EMPLOYEE' AND employee_id IS NOT NULL AND unit_id IS NULL) OR
    (scope_type = 'UNIT' AND unit_id IS NOT NULL AND employee_id IS NULL) OR
    (scope_type = 'COMPANY' AND employee_id IS NULL AND unit_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_hrm_work_schedule_rules_employee
  ON hrm_schema.work_schedule_rules (tenant_id, employee_id, effective_from) WHERE status = 'ACTIVE' AND scope_type = 'EMPLOYEE';
CREATE INDEX IF NOT EXISTS idx_hrm_work_schedule_rules_unit
  ON hrm_schema.work_schedule_rules (tenant_id, unit_id, effective_from) WHERE status = 'ACTIVE' AND scope_type = 'UNIT';
CREATE INDEX IF NOT EXISTS idx_hrm_work_schedule_rules_company
  ON hrm_schema.work_schedule_rules (tenant_id, effective_from) WHERE status = 'ACTIVE' AND scope_type = 'COMPANY';

-- Mẫu tuần được chụp lại cho từng lịch định kỳ. Thứ không có dòng = không phủ thứ đó (rơi xuống lớp thấp hơn).
CREATE TABLE IF NOT EXISTS hrm_schema.work_schedule_rule_days (
  rule_id uuid NOT NULL REFERENCES hrm_schema.work_schedule_rules(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  day_type varchar(10) NOT NULL CHECK (day_type IN ('SHIFT', 'OFF')),
  shift_id uuid REFERENCES hrm_schema.shift_definitions(id),
  PRIMARY KEY (rule_id, weekday),
  CONSTRAINT ck_hrm_work_schedule_rule_day_shift CHECK (
    (day_type = 'SHIFT' AND shift_id IS NOT NULL) OR (day_type = 'OFF' AND shift_id IS NULL)
  )
);
