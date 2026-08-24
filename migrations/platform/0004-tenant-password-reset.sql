-- The Platform keeps only an administrative directory and hashed reset tokens.
-- Tenant credentials remain exclusively in each tenant's core_schema.
CREATE TABLE IF NOT EXISTS tenancy_schema.tenant_admin_directory (
  tenant_id uuid PRIMARY KEY REFERENCES tenancy_schema.tenants(id) ON DELETE CASCADE,
  core_user_id uuid NOT NULL,
  email varchar(255) NOT NULL,
  full_name varchar(180) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_admin_directory_core_user_uq
  ON tenancy_schema.tenant_admin_directory (tenant_id, core_user_id);

CREATE TABLE IF NOT EXISTS identity_schema.tenant_password_reset_tokens (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id) ON DELETE CASCADE,
  core_user_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL REFERENCES identity_schema.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_password_reset_tokens_lookup_idx
  ON identity_schema.tenant_password_reset_tokens (tenant_id, core_user_id, expires_at)
  WHERE used_at IS NULL;

-- Sessions for tenant-core identities deliberately have no FK to identity_schema.users.
CREATE TABLE IF NOT EXISTS identity_schema.tenant_auth_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id) ON DELETE CASCADE,
  core_user_id uuid NOT NULL,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  csrf_token_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);

CREATE INDEX IF NOT EXISTS tenant_auth_sessions_user_idx
  ON identity_schema.tenant_auth_sessions (tenant_id, core_user_id)
  WHERE revoked_at IS NULL;

-- Backfill the UI-only projection for existing platform-managed tenant admins.
INSERT INTO tenancy_schema.tenant_admin_directory
  (tenant_id, core_user_id, email, full_name, status, updated_at)
SELECT m.tenant_id, u.id, u.email, u.display_name,
       CASE WHEN m.status = 'active' AND u.status = 'active' THEN 'active' ELSE 'disabled' END,
       now()
FROM tenancy_schema.tenant_memberships m
JOIN identity_schema.users u ON u.id = m.user_id
JOIN authorization_schema.user_roles ur ON ur.membership_id = m.id
JOIN authorization_schema.roles r ON r.id = ur.role_id AND r.key = 'tenant-admin'
ON CONFLICT (tenant_id) DO UPDATE SET
  core_user_id = EXCLUDED.core_user_id,
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  status = EXCLUDED.status,
  updated_at = now();
