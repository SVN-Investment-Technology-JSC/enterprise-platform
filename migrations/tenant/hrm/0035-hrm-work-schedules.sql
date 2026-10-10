-- Phân ca làm việc: mẫu lịch tuần, lịch từng ngày của nhân viên, ngày lễ/đặc biệt theo phạm vi, nhật ký.
-- Chỉ thêm bảng mới (không sửa bảng cũ). shift_definitions vẫn là danh mục ca duy nhất.
-- Lịch được sinh sẵn từng dòng (nhân viên x ngày) trong employee_work_days. Khi tra ca, lịch này đứng trước
-- shift_assignments / unit_shift_assignments (hai bảng cũ vẫn là lớp dự phòng khi nhân viên chưa có dòng nào).
-- Dòng cũ không bị xoá cứng: bị thay thế thì chuyển CANCELLED và giữ nguyên để đối soát.

CREATE TABLE IF NOT EXISTS hrm_schema.work_schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code varchar(50) NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrm_work_schedule_templates_code UNIQUE (tenant_id, code)
);

-- weekday theo ISO: 1 = Thứ Hai ... 7 = Chủ nhật.
CREATE TABLE IF NOT EXISTS hrm_schema.work_schedule_template_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES hrm_schema.work_schedule_templates(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  day_type varchar(10) NOT NULL CHECK (day_type IN ('SHIFT', 'OFF')),
  shift_id uuid REFERENCES hrm_schema.shift_definitions(id),
  CONSTRAINT uq_hrm_work_schedule_template_days UNIQUE (template_id, weekday),
  CONSTRAINT ck_hrm_work_schedule_template_day_shift CHECK (
    (day_type = 'SHIFT' AND shift_id IS NOT NULL) OR (day_type = 'OFF' AND shift_id IS NULL)
  )
);

-- Mỗi lần phân ca / tạo ngoại lệ / huỷ / sao chép là một đợt. Lưu bản chụp mẫu để sửa mẫu về sau
-- không làm thay đổi ý nghĩa của đợt đã áp dụng.
CREATE TABLE IF NOT EXISTS hrm_schema.work_schedule_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('ASSIGN', 'EXCEPTION', 'HOLIDAY', 'CANCEL', 'COPY')),
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('EMPLOYEE', 'EMPLOYEES', 'UNIT', 'COMPANY')),
  scope jsonb NOT NULL DEFAULT '{}',
  template_id uuid,
  pattern_snapshot jsonb,
  from_date date NOT NULL,
  to_date date NOT NULL,
  conflict_mode varchar(30),
  employee_count integer NOT NULL DEFAULT 0,
  day_count integer NOT NULL DEFAULT 0,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS idx_hrm_work_schedule_batches_tenant
  ON hrm_schema.work_schedule_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hrm_schema.company_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(180) NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('HOLIDAY', 'TET', 'COMPENSATORY', 'SPECIAL')),
  from_date date NOT NULL,
  to_date date NOT NULL,
  scope_type varchar(20) NOT NULL DEFAULT 'COMPANY' CHECK (scope_type IN ('COMPANY', 'UNIT', 'EMPLOYEES')),
  scope jsonb NOT NULL DEFAULT '{}',
  treatment varchar(10) NOT NULL DEFAULT 'OFF' CHECK (treatment IN ('OFF', 'SHIFT')),
  shift_id uuid REFERENCES hrm_schema.shift_definitions(id),
  paid boolean NOT NULL DEFAULT true,
  note text,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  -- Các dòng work_calendar do ngày lễ này tạo ra (chỉ phạm vi COMPANY), để huỷ đúng phần đã tạo.
  calendar_ids uuid[] NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date),
  CHECK (treatment = 'OFF' OR shift_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_hrm_company_holidays_range
  ON hrm_schema.company_holidays (tenant_id, from_date, to_date) WHERE status = 'ACTIVE';

-- Lịch từng ngày của nhân viên.
--   source: TEMPLATE = sinh từ mẫu/mẫu tạm; MANUAL = gán tay một ngày; EXCEPTION = ngoại lệ (được bảo vệ khi
--   áp lịch định kỳ); HOLIDAY = sinh từ ngày lễ.
--   day_type HOLIDAY = ngày lễ không bố trí ca làm; shift_id (nếu có) là ca thường lệ bị ngày lễ thay thế, giữ lại để
--   công thức tính công hiện có trả lương ngày lễ theo số phút của ca đó. Ngày lễ vẫn bố trí ca làm thì day_type = SHIFT,
--   source = HOLIDAY.
--   shift_snapshot: bản chụp ca lúc gán, chỉ để đối soát; tra ca vẫn dùng shift_definitions hiện hành.
CREATE TABLE IF NOT EXISTS hrm_schema.employee_work_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  day_type varchar(10) NOT NULL CHECK (day_type IN ('SHIFT', 'OFF', 'HOLIDAY')),
  shift_id uuid REFERENCES hrm_schema.shift_definitions(id),
  source varchar(20) NOT NULL CHECK (source IN ('TEMPLATE', 'MANUAL', 'EXCEPTION', 'HOLIDAY')),
  holiday_id uuid REFERENCES hrm_schema.company_holidays(id),
  batch_id uuid REFERENCES hrm_schema.work_schedule_batches(id),
  shift_snapshot jsonb,
  note text,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  cancel_reason varchar(80),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_hrm_employee_work_days_shift CHECK (
    (day_type = 'SHIFT' AND shift_id IS NOT NULL) OR (day_type = 'OFF' AND shift_id IS NULL) OR day_type = 'HOLIDAY'
  )
);
-- Một nhân viên chỉ có đúng một dòng hiệu lực mỗi ngày; dòng CANCELLED được giữ làm lịch sử.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_employee_work_days_active
  ON hrm_schema.employee_work_days (tenant_id, employee_id, work_date) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_hrm_employee_work_days_date
  ON hrm_schema.employee_work_days (tenant_id, work_date) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_hrm_employee_work_days_batch
  ON hrm_schema.employee_work_days (batch_id);
CREATE INDEX IF NOT EXISTS idx_hrm_employee_work_days_holiday
  ON hrm_schema.employee_work_days (holiday_id) WHERE holiday_id IS NOT NULL;

-- Nhật ký: mỗi nhân viên bị ảnh hưởng trong một đợt có một dòng, before/after là các đoạn ngày liên tiếp.
CREATE TABLE IF NOT EXISTS hrm_schema.work_schedule_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  batch_id uuid REFERENCES hrm_schema.work_schedule_batches(id),
  action varchar(30) NOT NULL,
  actor_id uuid,
  employee_id uuid,
  unit_id uuid,
  from_date date,
  to_date date,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_work_schedule_audit_employee
  ON hrm_schema.work_schedule_audit (tenant_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrm_work_schedule_audit_batch
  ON hrm_schema.work_schedule_audit (batch_id);
