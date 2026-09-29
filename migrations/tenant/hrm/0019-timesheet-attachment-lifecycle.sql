SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE hrm_schema.timesheets ADD COLUMN IF NOT EXISTS adjustment_needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE hrm_schema.attachments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE hrm_schema.attachments ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE hrm_schema.attachments ADD COLUMN IF NOT EXISTS delete_reason text;
