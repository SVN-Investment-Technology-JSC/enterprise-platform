SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE SCHEMA IF NOT EXISTS crm_schema;
CREATE TABLE IF NOT EXISTS crm_schema.customers (
  id uuid PRIMARY KEY, name varchar(180) NOT NULL, email varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
