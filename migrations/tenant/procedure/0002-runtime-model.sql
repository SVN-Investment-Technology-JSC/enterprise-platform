SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS procedure_schema.delegations (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES procedure_schema.instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES procedure_schema.step_instances(id),
  delegated_by uuid NOT NULL,
  delegated_to uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS procedure_schema.subtasks (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES procedure_schema.instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES procedure_schema.step_instances(id),
  title varchar(255) NOT NULL,
  assignee_id uuid,
  weight numeric(7,2) NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'open',
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT procedure_subtask_status_check
    CHECK (status IN ('open','in_progress','completed','cancelled'))
);

CREATE TABLE IF NOT EXISTS procedure_schema.attachments (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES procedure_schema.instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES procedure_schema.step_instances(id),
  object_key text NOT NULL UNIQUE,
  file_name varchar(255) NOT NULL,
  content_type varchar(160) NOT NULL,
  size_bytes bigint,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procedure_attachment_instance_idx
  ON procedure_schema.attachments (instance_id, created_at DESC);
