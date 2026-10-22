SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Chấm công tự động theo từng nhân viên (người không chấm công ngoài đời), bổ sung cho cấu hình chung của tenant ở 0055.
-- Mỗi dòng là một khoảng hiệu lực: weekdays NULL = mọi ngày có ca trong lịch; to_date NULL = chưa kết thúc.
-- Gỡ nhân viên thì đánh dấu removed_at/removed_by và chốt to_date, không xóa dòng để còn lịch sử cấu hình và lý do.
-- Giờ vào/ra sinh ra vẫn là sự kiện AUTO như cấu hình chung, không ghi chú riêng.
CREATE TABLE IF NOT EXISTS hrm_schema.auto_attendance_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  weekdays smallint[],
  from_date date NOT NULL,
  to_date date,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_by uuid,
  removed_at timestamptz,
  CONSTRAINT auto_attendance_employees_weekdays CHECK (weekdays IS NULL OR weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);

-- Một nhân viên chỉ có một cấu hình đang áp dụng; các dòng đã gỡ là lịch sử.
CREATE UNIQUE INDEX IF NOT EXISTS auto_attendance_employees_active_idx
  ON hrm_schema.auto_attendance_employees (tenant_id, employee_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS auto_attendance_employees_history_idx
  ON hrm_schema.auto_attendance_employees (tenant_id, employee_id, created_at DESC);
