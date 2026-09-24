-- Tenant-local RBAC. The revision fences process-local authorization caches.
CREATE TABLE IF NOT EXISTS core_schema.authorization_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revision bigint NOT NULL DEFAULT 1,
  initialized boolean NOT NULL DEFAULT false
);
INSERT INTO core_schema.authorization_state(id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE core_schema.users ALTER COLUMN system_role SET DEFAULT 'tenant-user';
CREATE TABLE IF NOT EXISTS core_schema.roles (
  id uuid PRIMARY KEY,
  key varchar(100) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique ON core_schema.roles(lower(name));
CREATE TABLE IF NOT EXISTS core_schema.permissions (
  id uuid PRIMARY KEY,
  name varchar(180) NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_unique ON core_schema.permissions(lower(name));
CREATE TABLE IF NOT EXISTS core_schema.permission_actions (
  permission_id uuid NOT NULL REFERENCES core_schema.permissions(id) ON DELETE CASCADE,
  action_key varchar(100) NOT NULL,
  PRIMARY KEY(permission_id, action_key)
);
CREATE TABLE IF NOT EXISTS core_schema.role_permissions (
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES core_schema.permissions(id) ON DELETE RESTRICT,
  PRIMARY KEY(role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS role_permissions_permission_idx ON core_schema.role_permissions(permission_id);
CREATE TABLE IF NOT EXISTS core_schema.role_modules (
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  module_key varchar(100) NOT NULL,
  PRIMARY KEY(role_id, module_key)
);
CREATE TABLE IF NOT EXISTS core_schema.user_roles (
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE RESTRICT,
  PRIMARY KEY(user_id, role_id)
);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON core_schema.user_roles(role_id);
CREATE TABLE IF NOT EXISTS core_schema.authorization_audit (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  operation varchar(100) NOT NULL,
  subject_id uuid NOT NULL,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO core_schema.roles(id,key,name,is_system) VALUES
 ('a0000000-0000-4000-8000-000000000001','tenant-admin','Quản trị tenant',true),
 ('a0000000-0000-4000-8000-000000000002','legacy-tenant-user','Người dùng chuyển tiếp',true)
ON CONFLICT DO NOTHING;
INSERT INTO core_schema.role_modules(role_id,module_key)
SELECT id,'*' FROM core_schema.roles WHERE key IN ('tenant-admin','legacy-tenant-user') ON CONFLICT DO NOTHING;
-- Backfill once only. Re-running must never restore deliberately revoked roles.
DO $$ BEGIN
  PERFORM 1 FROM core_schema.authorization_state WHERE id=true FOR UPDATE;
  IF NOT (SELECT initialized FROM core_schema.authorization_state WHERE id=true) THEN
    INSERT INTO core_schema.user_roles(user_id,role_id)
    SELECT u.id,r.id FROM core_schema.users u JOIN core_schema.roles r
      ON r.key=CASE WHEN u.system_role='tenant-admin' THEN 'tenant-admin' ELSE 'legacy-tenant-user' END
    ON CONFLICT DO NOTHING;
    UPDATE core_schema.authorization_state SET initialized=true, revision=revision+1 WHERE id=true;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION core_schema.bump_authorization_revision() RETURNS trigger AS $$
BEGIN
  UPDATE core_schema.authorization_state SET revision=revision+1 WHERE id=true;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['roles','permissions','permission_actions','role_permissions','role_modules','user_roles','users'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='rbac_revision_'||tab AND tgrelid=('core_schema.'||tab)::regclass) THEN
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON core_schema.%I FOR EACH STATEMENT EXECUTE FUNCTION core_schema.bump_authorization_revision()', 'rbac_revision_'||tab, tab);
    END IF;
  END LOOP;
END $$;
