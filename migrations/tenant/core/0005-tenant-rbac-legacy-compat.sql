-- Prerequisite for 0005-tenant-rbac. No-op on fresh/already-normalized schemas.
-- Run through the migrator transaction; never reset existing tenant data.
DO $$
DECLARE
  invalid_keys text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='core_schema' AND table_name='role_permissions' AND column_name='permission_key'
  ) THEN
    RETURN;
  END IF;

  LOCK TABLE core_schema.roles, core_schema.role_permissions,
    core_schema.role_modules, core_schema.user_roles IN ACCESS EXCLUSIVE MODE;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core_schema' AND table_name='roles' AND column_name='code')
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core_schema' AND table_name='roles' AND column_name='key')
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='core_schema' AND table_name='role_permissions' AND column_name='permission_id')
    OR to_regclass('core_schema.permissions') IS NOT NULL
    OR to_regclass('core_schema.authorization_state') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy RBAC has a mixed/unsupported schema; review before conversion';
  END IF;
  -- The new model has no role-status switch. Never silently re-enable a role.
  IF EXISTS (SELECT 1 FROM core_schema.roles WHERE status <> 'active') THEN
    RAISE EXCEPTION 'Legacy RBAC contains disabled roles; review their assignments before conversion';
  END IF;
  IF EXISTS (SELECT lower(name) FROM core_schema.roles GROUP BY lower(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Legacy RBAC has duplicate role names (case-insensitive); rename them before conversion';
  END IF;
  IF EXISTS (SELECT 1 FROM core_schema.roles WHERE code IN ('tenant-admin','legacy-tenant-user') AND NOT is_system) THEN
    RAISE EXCEPTION 'Legacy RBAC reserved role codes must be system roles';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core_schema.user_roles ur JOIN core_schema.roles r ON r.id=ur.role_id
    JOIN core_schema.users u ON u.id=ur.user_id
    WHERE r.code='tenant-admin' AND r.is_system AND u.status='active' AND u.is_active
  ) THEN
    RAISE EXCEPTION 'Legacy RBAC must retain an assigned active tenant admin before conversion';
  END IF;

  -- Core atomic actions map one-to-one. Historical built-in module permissions
  -- are archived: built-in roles use module access in the new model. Do not
  -- interpret arbitrary custom wildcards or module read grants as full access.
  SELECT string_agg(DISTINCT rp.permission_key, ', ' ORDER BY rp.permission_key)
    INTO invalid_keys
    FROM core_schema.role_permissions rp JOIN core_schema.roles r ON r.id=rp.role_id
    WHERE rp.permission_key NOT IN (
      'core.users.read','core.users.create','core.users.update','core.users.delete',
      'core.organization.read','core.organization.create','core.organization.update','core.organization.delete'
    ) AND NOT (
      r.is_system AND r.code IN ('tenant-admin','legacy-tenant-user') AND rp.permission_key IN (
        '*','tenant.manage','procedure.read','procedure.manage','module.access',
        'maintenance.read','maintenance.manage','maintenance.occurrence.manage',
        'inventory.read','inventory.manage','inventory.transaction.write'
      )
    );
  IF invalid_keys IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy RBAC permission keys require explicit mapping: %', invalid_keys;
  END IF;

  -- Snapshot has no FK back to live tables: later legitimate role deletion must
  -- not remove the migration evidence or be blocked by the archive.
  CREATE TABLE core_schema.rbac_legacy_archive (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_table text NOT NULL,
    row_data jsonb NOT NULL,
    archived_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO core_schema.rbac_legacy_archive(source_table,row_data)
    SELECT 'roles',to_jsonb(r) FROM core_schema.roles r
    UNION ALL SELECT 'role_permissions',to_jsonb(r) FROM core_schema.role_permissions r
    UNION ALL SELECT 'role_modules',to_jsonb(r) FROM core_schema.role_modules r
    UNION ALL SELECT 'user_roles',to_jsonb(r) FROM core_schema.user_roles r;

  ALTER TABLE core_schema.roles RENAME COLUMN code TO key;
  UPDATE core_schema.roles SET description='' WHERE description IS NULL;
  ALTER TABLE core_schema.roles ALTER COLUMN description SET DEFAULT '';
  ALTER TABLE core_schema.roles ALTER COLUMN description SET NOT NULL;

  CREATE TABLE core_schema.permissions (
    id uuid PRIMARY KEY,
    name varchar(180) NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE core_schema.permission_actions (
    permission_id uuid NOT NULL REFERENCES core_schema.permissions(id) ON DELETE CASCADE,
    action_key varchar(100) NOT NULL,
    PRIMARY KEY(permission_id,action_key)
  );
  INSERT INTO core_schema.permissions(id,name,description)
    SELECT DISTINCT md5('tenant-rbac-legacy:' || permission_key)::uuid,
      'Legacy: ' || permission_key, 'Converted from legacy permission_key'
    FROM core_schema.role_permissions WHERE permission_key IN (
      'core.users.read','core.users.create','core.users.update','core.users.delete',
      'core.organization.read','core.organization.create','core.organization.update','core.organization.delete'
    );
  INSERT INTO core_schema.permission_actions(permission_id,action_key)
    SELECT DISTINCT p.id,rp.permission_key FROM core_schema.role_permissions rp
    JOIN core_schema.permissions p ON p.id=md5('tenant-rbac-legacy:' || rp.permission_key)::uuid;
  ALTER TABLE core_schema.role_permissions ADD COLUMN permission_id uuid
    REFERENCES core_schema.permissions(id) ON DELETE RESTRICT;
  UPDATE core_schema.role_permissions rp SET permission_id=p.id
    FROM core_schema.permissions p WHERE p.id=md5('tenant-rbac-legacy:' || rp.permission_key)::uuid;
  -- Only known built-in compatibility keys can be unmapped after preflight.
  DELETE FROM core_schema.role_permissions WHERE permission_id IS NULL;
  ALTER TABLE core_schema.role_permissions DROP CONSTRAINT role_permissions_pkey;
  ALTER TABLE core_schema.role_permissions DROP COLUMN permission_key;
  ALTER TABLE core_schema.role_permissions ALTER COLUMN permission_id SET NOT NULL;
  ALTER TABLE core_schema.role_permissions ADD PRIMARY KEY(role_id,permission_id);
  ALTER TABLE core_schema.user_roles DROP CONSTRAINT user_roles_role_id_fkey;
  ALTER TABLE core_schema.user_roles ADD CONSTRAINT user_roles_role_id_fkey
    FOREIGN KEY(role_id) REFERENCES core_schema.roles(id) ON DELETE RESTRICT;

  -- Existing assignments (including absence of assignments) are authoritative.
  -- Suppress the fresh-schema backfill; do not restore revoked access based on
  -- the legacy users.system_role projection.
  CREATE TABLE core_schema.authorization_state (
    id boolean PRIMARY KEY DEFAULT true CHECK(id),
    revision bigint NOT NULL DEFAULT 1,
    initialized boolean NOT NULL DEFAULT false
  );
  INSERT INTO core_schema.authorization_state(id,initialized) VALUES(true,true);
END;
$$;
