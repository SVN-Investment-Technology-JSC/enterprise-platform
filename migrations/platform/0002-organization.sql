SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS organization_schema;

CREATE TABLE IF NOT EXISTS organization_schema.unit_types (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id) ON DELETE CASCADE,
  key varchar(80) NOT NULL,
  name varchar(180) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS organization_schema.units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id) ON DELETE CASCADE,
  code varchar(80) NOT NULL,
  name varchar(180) NOT NULL,
  type_id uuid NOT NULL REFERENCES organization_schema.unit_types(id),
  parent_id uuid REFERENCES organization_schema.units(id),
  head_membership_id uuid REFERENCES tenancy_schema.tenant_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS organization_units_parent_idx
  ON organization_schema.units (tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS organization_schema.positions (
  id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES organization_schema.units(id) ON DELETE CASCADE,
  key varchar(80) NOT NULL,
  name varchar(180) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, key)
);

CREATE TABLE IF NOT EXISTS organization_schema.unit_members (
  unit_id uuid NOT NULL REFERENCES organization_schema.units(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES tenancy_schema.tenant_memberships(id) ON DELETE CASCADE,
  position_id uuid REFERENCES organization_schema.positions(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (unit_id, membership_id)
);

CREATE INDEX IF NOT EXISTS organization_member_membership_idx
  ON organization_schema.unit_members (membership_id);

