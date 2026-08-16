SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS maintenance_schema;

CREATE TABLE maintenance_schema.assets (
  id uuid PRIMARY KEY,
  code varchar(80) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  asset_type varchar(30) NOT NULL,
  parent_id uuid REFERENCES maintenance_schema.assets(id),
  status varchar(20) NOT NULL DEFAULT 'active',
  health varchar(20) NOT NULL DEFAULT 'unknown',
  location text,
  manufacturer varchar(180),
  organization_unit_id uuid,
  organization_unit_name varchar(180),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_asset_type_check
    CHECK (asset_type IN ('company','site','system','equipment','part')),
  CONSTRAINT maintenance_asset_status_check
    CHECK (status IN ('active','inactive','retired')),
  CONSTRAINT maintenance_asset_health_check
    CHECK (health IN ('unknown','good','warning','critical')),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX maintenance_asset_parent_idx ON maintenance_schema.assets (parent_id);

CREATE TABLE maintenance_schema.job_plans (
  id uuid PRIMARY KEY,
  code varchar(80) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  description text,
  status varchar(20) NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT maintenance_job_plan_status_check
    CHECK (status IN ('draft','published','archived'))
);

CREATE TABLE maintenance_schema.procedure_catalog (
  definition_id uuid PRIMARY KEY,
  code varchar(80) NOT NULL,
  name varchar(180) NOT NULL,
  version_number integer NOT NULL,
  status varchar(20) NOT NULL,
  synchronized_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_procedure_catalog_status_check
    CHECK (status IN ('published','archived'))
);

CREATE TABLE maintenance_schema.schedules (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  title varchar(255) NOT NULL,
  asset_id uuid NOT NULL REFERENCES maintenance_schema.assets(id),
  job_plan_id uuid NOT NULL REFERENCES maintenance_schema.job_plans(id),
  procedure_definition_id uuid,
  frequency varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  paused_reason varchar(80),
  start_date date NOT NULL,
  timezone varchar(80) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  next_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_schedule_frequency_check
    CHECK (frequency IN ('day','week','month','quarter','year')),
  CONSTRAINT maintenance_schedule_status_check
    CHECK (status IN ('draft','active','paused'))
);

CREATE INDEX maintenance_schedule_due_idx
  ON maintenance_schema.schedules (next_due_at)
  WHERE status = 'active';

CREATE TABLE maintenance_schema.occurrences (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES maintenance_schema.schedules(id),
  due_at timestamptz NOT NULL,
  status varchar(30) NOT NULL,
  procedure_instance_id uuid,
  procedure_instance_code varchar(100),
  failure_reason text,
  idempotency_key varchar(180) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (schedule_id, due_at),
  CONSTRAINT maintenance_occurrence_status_check
    CHECK (status IN ('planned','dispatch_pending','generated','completed','failed','blocked'))
);

CREATE INDEX maintenance_occurrence_due_idx
  ON maintenance_schema.occurrences (status, due_at);

-- Maintenance intentionally references only maintenance_schema and the shared
-- integration_schema outbox/inbox. It never reads procedure_schema.

