CREATE SCHEMA IF NOT EXISTS core_schema;

CREATE TABLE IF NOT EXISTS core_schema.users (
  id uuid PRIMARY KEY,
  username varchar(120) UNIQUE,
  full_name varchar(180) NOT NULL,
  email varchar(255) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  system_role varchar(32) NOT NULL DEFAULT 'tenant-admin',
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_schema.organization_trees (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  description text,
  is_primary boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_schema.organization_node_types (
  id uuid PRIMARY KEY,
  code varchar(100) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  category varchar(32) NOT NULL CHECK (category IN ('unit', 'position')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_schema.organization_nodes (
  id uuid PRIMARY KEY,
  tree_id uuid NOT NULL REFERENCES core_schema.organization_trees(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES core_schema.organization_nodes(id) ON DELETE RESTRICT,
  node_type_id uuid NOT NULL REFERENCES core_schema.organization_node_types(id) ON DELETE RESTRICT,
  code varchar(100) NOT NULL,
  name varchar(180) NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tree_id, code)
);

CREATE TABLE IF NOT EXISTS core_schema.organization_node_assignments (
  id uuid PRIMARY KEY,
  node_id uuid NOT NULL REFERENCES core_schema.organization_nodes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  start_date date,
  end_date date,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
