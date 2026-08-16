SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE SCHEMA IF NOT EXISTS procedure_schema;
CREATE TABLE IF NOT EXISTS procedure_schema.runtime_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
