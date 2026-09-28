SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE hrm_schema.business_trip_requests
  ADD COLUMN IF NOT EXISTS work_item_id uuid,
  ADD COLUMN IF NOT EXISTS subtask_id uuid,
  ADD COLUMN IF NOT EXISTS work_reference jsonb NOT NULL DEFAULT '{}';
