SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.salary_grade_steps
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE'));

-- Retain the employee identity, account link, timesheets and payroll history.
ALTER TABLE hrm_schema.employee_profiles
  ADD COLUMN IF NOT EXISTS inactive_from date,
  ADD COLUMN IF NOT EXISTS inactive_reason text;

ALTER TABLE hrm_schema.position_profiles
  ADD COLUMN IF NOT EXISTS authorities jsonb NOT NULL DEFAULT '[]'::jsonb;
