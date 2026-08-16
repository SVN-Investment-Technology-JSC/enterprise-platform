SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS procedure_schema.definitions (
  id uuid PRIMARY KEY, code varchar(80) NOT NULL UNIQUE, name varchar(180) NOT NULL,
  description text, kind varchar(40) NOT NULL, status varchar(20) NOT NULL,
  current_version_id uuid, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  CHECK (kind IN ('process','maintenance_linked','maintenance_direct')),
  CHECK (status IN ('draft','published','archived'))
);

CREATE TABLE IF NOT EXISTS procedure_schema.versions (
  id uuid PRIMARY KEY, definition_id uuid NOT NULL REFERENCES procedure_schema.definitions(id),
  version_number integer NOT NULL CHECK (version_number > 0), status varchar(20) NOT NULL,
  snapshot jsonb NOT NULL, published_by uuid, published_at timestamptz, created_at timestamptz NOT NULL,
  UNIQUE (definition_id, version_number), CHECK (status IN ('draft','published','retired'))
);

DO $$ BEGIN
  ALTER TABLE procedure_schema.definitions ADD CONSTRAINT procedure_definition_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES procedure_schema.versions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS procedure_schema.steps (
  id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES procedure_schema.versions(id) ON DELETE CASCADE,
  step_key varchar(80) NOT NULL, step_order integer NOT NULL CHECK (step_order > 0),
  name varchar(180) NOT NULL, description text,
  linked_definition_id uuid REFERENCES procedure_schema.definitions(id), config jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (version_id, step_key), UNIQUE (version_id, step_order)
);

CREATE TABLE IF NOT EXISTS procedure_schema.raci_assignments (
  id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES procedure_schema.versions(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES procedure_schema.steps(id) ON DELETE CASCADE,
  role_letter char(1) NOT NULL CHECK (role_letter IN ('R','A','C','S','I','E')),
  subject_type varchar(30) NOT NULL CHECK (subject_type IN ('organization_unit','position','user')),
  subject_id uuid NOT NULL, subject_label varchar(180), fixed_rollback_step_id uuid REFERENCES procedure_schema.steps(id),
  e_task_source varchar(30), e_task_config jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS procedure_raci_step_idx ON procedure_schema.raci_assignments (step_id, role_letter);
CREATE INDEX IF NOT EXISTS procedure_raci_subject_idx ON procedure_schema.raci_assignments (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS procedure_schema.instances (
  id uuid PRIMARY KEY, definition_id uuid NOT NULL REFERENCES procedure_schema.definitions(id),
  version_id uuid NOT NULL REFERENCES procedure_schema.versions(id), code varchar(80) NOT NULL UNIQUE,
  title varchar(255) NOT NULL, status varchar(20) NOT NULL CHECK (status IN ('running','completed','rejected','cancelled')),
  current_step_id uuid REFERENCES procedure_schema.steps(id), initiated_by uuid NOT NULL,
  source_type varchar(80), source_id uuid, idempotency_key varchar(180) UNIQUE,
  snapshot jsonb NOT NULL, context jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL, completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS procedure_instance_status_idx ON procedure_schema.instances (status, started_at DESC);

CREATE TABLE IF NOT EXISTS procedure_schema.step_instances (
  id uuid PRIMARY KEY, instance_id uuid NOT NULL REFERENCES procedure_schema.instances(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES procedure_schema.steps(id), step_order integer NOT NULL,
  status varchar(20) NOT NULL, current_role_stage char(1), snapshot jsonb NOT NULL,
  started_at timestamptz, completed_at timestamptz, UNIQUE (instance_id, step_id)
);

CREATE TABLE IF NOT EXISTS procedure_schema.actions (
  id uuid PRIMARY KEY, instance_id uuid NOT NULL REFERENCES procedure_schema.instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES procedure_schema.step_instances(id), actor_id uuid NOT NULL,
  action varchar(30) NOT NULL, comment text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key varchar(180) NOT NULL UNIQUE, created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS procedure_schema.activity_logs (
  id uuid PRIMARY KEY, instance_id uuid NOT NULL REFERENCES procedure_schema.instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES procedure_schema.step_instances(id), actor_id uuid,
  action varchar(40) NOT NULL, summary text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

-- runtime_state remains for one release as a rollback source; application reads
-- the normalized snapshots after the first successful backfill transaction.
