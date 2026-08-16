SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS identity_schema;
CREATE SCHEMA IF NOT EXISTS tenancy_schema;
CREATE SCHEMA IF NOT EXISTS authorization_schema;
CREATE SCHEMA IF NOT EXISTS module_registry_schema;
CREATE SCHEMA IF NOT EXISTS subscription_schema;
CREATE SCHEMA IF NOT EXISTS audit_schema;
CREATE SCHEMA IF NOT EXISTS integration_schema;

CREATE TABLE IF NOT EXISTS integration_schema.schema_migrations (
  module_key varchar(80) NOT NULL, version varchar(120) NOT NULL,
  checksum varchar(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module_key, version)
);

CREATE TABLE IF NOT EXISTS identity_schema.users (
  id uuid PRIMARY KEY, email varchar(255) NOT NULL UNIQUE,
  display_name varchar(180) NOT NULL, password_hash text NOT NULL,
  kind varchar(30) NOT NULL CHECK (kind IN ('platform-admin', 'tenant-user')),
  status varchar(20) NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenancy_schema.tenants (
  id uuid PRIMARY KEY, slug varchar(80) NOT NULL UNIQUE, name varchar(180) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenancy_schema.tenant_memberships (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id),
  user_id uuid NOT NULL REFERENCES identity_schema.users(id), status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS tenancy_schema.tenant_db_configs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE REFERENCES tenancy_schema.tenants(id),
  database_name varchar(120) NOT NULL, host varchar(255) NOT NULL, port integer NOT NULL,
  secret_ref varchar(180) NOT NULL, ssl boolean NOT NULL DEFAULT false,
  config_version integer NOT NULL DEFAULT 1, status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity_schema.auth_sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES identity_schema.users(id),
  refresh_token_hash char(64) NOT NULL UNIQUE, csrf_token_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL, rotated_at timestamptz,
  revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authorization_schema.roles (
  id uuid PRIMARY KEY, key varchar(100) NOT NULL UNIQUE, name varchar(180) NOT NULL,
  scope varchar(30) NOT NULL CHECK (scope IN ('platform', 'tenant'))
);
CREATE TABLE IF NOT EXISTS authorization_schema.permissions (
  id uuid PRIMARY KEY, key varchar(140) NOT NULL UNIQUE, description text NOT NULL
);
CREATE TABLE IF NOT EXISTS authorization_schema.role_permissions (
  role_id uuid NOT NULL REFERENCES authorization_schema.roles(id),
  permission_id uuid NOT NULL REFERENCES authorization_schema.permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS authorization_schema.user_roles (
  user_id uuid NOT NULL REFERENCES identity_schema.users(id),
  role_id uuid NOT NULL REFERENCES authorization_schema.roles(id),
  membership_id uuid REFERENCES tenancy_schema.tenant_memberships(id),
  assignment_key varchar(180) NOT NULL UNIQUE,
  PRIMARY KEY (user_id, role_id, assignment_key)
);

CREATE TABLE IF NOT EXISTS module_registry_schema.modules (
  id uuid PRIMARY KEY, key varchar(100) NOT NULL UNIQUE, name varchar(180) NOT NULL,
  description text NOT NULL, launch_url varchar(255) NOT NULL, icon varchar(30),
  version varchar(40) NOT NULL, status varchar(20) NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS subscription_schema.plans (
  id uuid PRIMARY KEY, key varchar(100) NOT NULL UNIQUE, name varchar(180) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS subscription_schema.plan_modules (
  plan_id uuid NOT NULL REFERENCES subscription_schema.plans(id),
  module_id uuid NOT NULL REFERENCES module_registry_schema.modules(id),
  PRIMARY KEY (plan_id, module_id)
);
CREATE TABLE IF NOT EXISTS subscription_schema.subscriptions (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE REFERENCES tenancy_schema.tenants(id),
  plan_id uuid REFERENCES subscription_schema.plans(id), status varchar(20) NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscription_schema.tenant_entitlements (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id),
  module_id uuid NOT NULL REFERENCES module_registry_schema.modules(id),
  status varchar(20) NOT NULL CHECK (status IN ('provisioning', 'active', 'disabled', 'failed')),
  provisioned_version varchar(40), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module_id)
);

CREATE TABLE IF NOT EXISTS integration_schema.provisioning_jobs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL, module_key varchar(100) NOT NULL,
  target_version varchar(40) NOT NULL, status varchar(20) NOT NULL,
  error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS audit_schema.audit_logs (
  id uuid PRIMARY KEY, actor_id uuid, tenant_id uuid, action varchar(160) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
