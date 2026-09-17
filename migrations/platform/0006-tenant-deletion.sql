SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

INSERT INTO authorization_schema.permissions (id, key, description)
VALUES ('e1000000-0000-4000-8000-000000000012', 'platform.tenants.delete', 'Xóa vĩnh viễn tenant và database')
ON CONFLICT (key) DO NOTHING;
DELETE FROM authorization_schema.role_permissions rp USING authorization_schema.roles r, authorization_schema.permissions p
WHERE rp.role_id=r.id AND rp.permission_id=p.id AND r.scope='tenant' AND p.key LIKE 'platform.%';
INSERT INTO authorization_schema.role_permissions (role_id, permission_id)
SELECT r.id,p.id FROM authorization_schema.roles r CROSS JOIN authorization_schema.permissions p
WHERE r.key='platform-admin' AND r.scope='platform' AND p.key='platform.tenants.delete'
ON CONFLICT DO NOTHING;

-- Deliberately no tenant/user FK: the minimal receipt survives physical deletion.
CREATE TABLE integration_schema.tenant_deletion_jobs (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL UNIQUE, actor_id uuid NOT NULL,
  idempotency_key varchar(100) NOT NULL, request_hash char(64) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('pending','processing','failed','completed')),
  step varchar(30) NOT NULL DEFAULT 'quiesce' CHECK (step IN ('quiesce','drop_database','purge_storage','purge_integration','purge_platform')),
  snapshot jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(), heartbeat_at timestamptz,
  error_code varchar(100), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (actor_id,idempotency_key)
);
CREATE INDEX tenant_deletion_pending_idx ON integration_schema.tenant_deletion_jobs (next_run_at)
WHERE status IN ('pending','processing');
CREATE TABLE integration_schema.tenant_deletion_previews (
  token_hash char(64) PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL, session_id uuid NOT NULL, snapshot jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);

-- A row lock makes lifecycle checks serialize with accepting a deletion request.
CREATE FUNCTION tenancy_schema.require_usable_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
  SELECT status INTO current_status FROM tenancy_schema.tenants WHERE id=NEW.tenant_id FOR SHARE;
  IF current_status IS NULL OR current_status IN ('deleting','deletion_failed') THEN
    RAISE EXCEPTION 'TENANT_DELETING' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_session_lifecycle BEFORE INSERT ON identity_schema.tenant_auth_sessions
FOR EACH ROW EXECUTE FUNCTION tenancy_schema.require_usable_tenant();
CREATE TRIGGER tenant_reset_lifecycle BEFORE INSERT ON identity_schema.tenant_password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION tenancy_schema.require_usable_tenant();
CREATE TRIGGER tenant_membership_lifecycle BEFORE INSERT OR UPDATE ON tenancy_schema.tenant_memberships
FOR EACH ROW EXECUTE FUNCTION tenancy_schema.require_usable_tenant();
CREATE TRIGGER tenant_entitlement_lifecycle BEFORE INSERT OR UPDATE ON subscription_schema.tenant_entitlements
FOR EACH ROW EXECUTE FUNCTION tenancy_schema.require_usable_tenant();
CREATE TRIGGER tenant_provisioning_lifecycle BEFORE INSERT ON integration_schema.provisioning_jobs
FOR EACH ROW EXECUTE FUNCTION tenancy_schema.require_usable_tenant();

CREATE FUNCTION tenancy_schema.prevent_deleted_tenant_reactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('deleting','deletion_failed') AND NEW.status NOT IN ('deleting','deletion_failed') THEN
    RAISE EXCEPTION 'TENANT_DELETING' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenant_no_reactivation BEFORE UPDATE ON tenancy_schema.tenants
FOR EACH ROW EXECUTE FUNCTION tenancy_schema.prevent_deleted_tenant_reactivation();
