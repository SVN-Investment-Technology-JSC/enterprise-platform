SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Create core_schema.roles
CREATE TABLE IF NOT EXISTS core_schema.roles (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Create core_schema.role_modules
CREATE TABLE IF NOT EXISTS core_schema.role_modules (
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  module_key varchar(100) NOT NULL,
  PRIMARY KEY (role_id, module_key)
);

-- 3. Create core_schema.role_permissions
CREATE TABLE IF NOT EXISTS core_schema.role_permissions (
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  permission_key varchar(140) NOT NULL,
  PRIMARY KEY (role_id, permission_key)
);

-- 4. Create core_schema.user_roles
CREATE TABLE IF NOT EXISTS core_schema.user_roles (
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES core_schema.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS user_roles_user_idx ON core_schema.user_roles(user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON core_schema.user_roles(role_id);

-- 5. Seed system roles
INSERT INTO core_schema.roles (id, code, name, description, is_system, status)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'tenant-admin', 'Quản trị viên Tenant', 'Toàn quyền quản trị phân hệ và người dùng trong tổ chức', true, 'active'),
  ('d0000000-0000-4000-8000-000000000002', 'legacy-tenant-user', 'Nhân viên mặc định', 'Vai trò mặc định truy cập các phân hệ được cấp phát', true, 'active')
ON CONFLICT (code) DO NOTHING;

-- 6. Seed role_modules
INSERT INTO core_schema.role_modules (role_id, module_key)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'procedure-engine'),
  ('d0000000-0000-4000-8000-000000000001', 'maintenance'),
  ('d0000000-0000-4000-8000-000000000001', 'inventory'),
  ('d0000000-0000-4000-8000-000000000002', 'procedure-engine'),
  ('d0000000-0000-4000-8000-000000000002', 'maintenance'),
  ('d0000000-0000-4000-8000-000000000002', 'inventory')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- 7. Seed role_permissions
INSERT INTO core_schema.role_permissions (role_id, permission_key)
VALUES
  ('d0000000-0000-4000-8000-000000000001', '*'),
  ('d0000000-0000-4000-8000-000000000001', 'tenant.manage'),
  ('d0000000-0000-4000-8000-000000000002', 'procedure.read'),
  ('d0000000-0000-4000-8000-000000000002', 'maintenance.read'),
  ('d0000000-0000-4000-8000-000000000002', 'inventory.read'),
  ('d0000000-0000-4000-8000-000000000002', 'inventory.transaction.write')
ON CONFLICT (role_id, permission_key) DO NOTHING;

-- 8. Backfill existing users into core_schema.user_roles
INSERT INTO core_schema.user_roles (user_id, role_id)
SELECT u.id, 'd0000000-0000-4000-8000-000000000001'::uuid
FROM core_schema.users u
WHERE u.system_role = 'tenant-admin'
ON CONFLICT (user_id, role_id) DO NOTHING;

INSERT INTO core_schema.user_roles (user_id, role_id)
SELECT u.id, 'd0000000-0000-4000-8000-000000000002'::uuid
FROM core_schema.users u
WHERE (u.system_role IS NULL OR u.system_role != 'tenant-admin')
ON CONFLICT (user_id, role_id) DO NOTHING;
