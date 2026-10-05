-- Replace the transitional compatibility role with the assignable system default.
-- Preserve its ID, assignments, modules and permissions for existing tenants.
DO $$
DECLARE
  legacy_id uuid;
BEGIN
  SELECT id INTO legacy_id
  FROM core_schema.roles
  WHERE key = 'legacy-tenant-user';

  IF legacy_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM core_schema.roles
    WHERE key = 'tenant-user' AND id <> legacy_id
  ) THEN
    -- 0005 may be re-executed by direct provisioning tests without its
    -- migration ledger. In that narrow case it re-seeds this empty role;
    -- discard only that known, unassigned duplicate.
    IF legacy_id = 'a0000000-0000-4000-8000-000000000002'::uuid
      AND NOT EXISTS (SELECT 1 FROM core_schema.user_roles WHERE role_id = legacy_id)
      AND NOT EXISTS (SELECT 1 FROM core_schema.role_permissions WHERE role_id = legacy_id) THEN
      DELETE FROM core_schema.roles WHERE id = legacy_id;
      RETURN;
    END IF;
    RAISE EXCEPTION
      'Cannot replace legacy-tenant-user: a different tenant-user role already exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM core_schema.roles
    WHERE lower(name) = lower('Nhân viên mặc định') AND id <> legacy_id
  ) THEN
    RAISE EXCEPTION
      'Cannot replace legacy-tenant-user: a different role is already named Nhân viên mặc định';
  END IF;

  UPDATE core_schema.roles
  SET key = 'tenant-user',
      name = 'Nhân viên mặc định',
      updated_at = now()
  WHERE id = legacy_id;
END;
$$;
