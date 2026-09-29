SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE hrm_schema.timesheet_periods ADD COLUMN IF NOT EXISTS calculated_at timestamptz;
ALTER TABLE hrm_schema.timesheets DROP CONSTRAINT IF EXISTS timesheets_status_check;
ALTER TABLE hrm_schema.timesheets ADD CONSTRAINT timesheets_status_check CHECK(status IN ('NORMAL','LEAVE','HOLIDAY','ABSENT','ADJUSTED','OFF','BUSINESS_TRIP','ABNORMAL'));
