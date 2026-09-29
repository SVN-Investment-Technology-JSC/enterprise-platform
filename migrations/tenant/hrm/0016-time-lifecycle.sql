SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE hrm_schema.work_calendar ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE hrm_schema.attendance_sites ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
