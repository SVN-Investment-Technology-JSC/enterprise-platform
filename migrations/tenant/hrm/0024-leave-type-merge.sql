SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.leave_types
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES hrm_schema.leave_types(id),
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;
