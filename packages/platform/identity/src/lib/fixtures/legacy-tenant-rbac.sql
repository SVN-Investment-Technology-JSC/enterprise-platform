-- Historical code/permission_key schema, matching the inspected local tenant.
CREATE TABLE core_schema.roles (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE core_schema.role_permissions (
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  permission_key varchar(100) NOT NULL,
  PRIMARY KEY(role_id,permission_key)
);
CREATE TABLE core_schema.role_modules (
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  module_key varchar(100) NOT NULL,
  PRIMARY KEY(role_id,module_key)
);
CREATE TABLE core_schema.user_roles (
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,role_id)
);
INSERT INTO core_schema.roles(id,code,name,is_system) VALUES
 ('b0000000-0000-4000-8000-000000000001','tenant-admin','Existing admin',true),
 ('b0000000-0000-4000-8000-000000000002','legacy-tenant-user','Existing user',true);
INSERT INTO core_schema.role_permissions(role_id,permission_key) VALUES
 ('b0000000-0000-4000-8000-000000000001','*'),
 ('b0000000-0000-4000-8000-000000000001','tenant.manage'),
 ('b0000000-0000-4000-8000-000000000002','procedure.read'),
 ('b0000000-0000-4000-8000-000000000002','maintenance.read'),
 ('b0000000-0000-4000-8000-000000000002','inventory.read'),
 ('b0000000-0000-4000-8000-000000000002','inventory.transaction.write');
INSERT INTO core_schema.role_modules(role_id,module_key)
 SELECT r.id,m.key FROM core_schema.roles r CROSS JOIN
 (VALUES ('procedure-engine'),('maintenance'),('inventory')) m(key);
INSERT INTO core_schema.users(id,email,full_name,password_hash,system_role)
 SELECT md5('legacy-user-' || n)::uuid,'user' || n || '@test.local','Test ' || n,'test-only-hash',
 CASE WHEN n=1 THEN 'tenant-admin' ELSE 'tenant-user' END
 FROM generate_series(1,46) n;
-- 45 assignments plus one deliberately unassigned user.
INSERT INTO core_schema.user_roles(user_id,role_id)
 SELECT md5('legacy-user-' || n)::uuid,
 CASE WHEN n=1 THEN 'b0000000-0000-4000-8000-000000000001'::uuid
 ELSE 'b0000000-0000-4000-8000-000000000002'::uuid END
 FROM generate_series(1,45) n;
