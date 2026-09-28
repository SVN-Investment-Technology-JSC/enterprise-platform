-- Employee identity belongs to Core and may exist without a login account.
CREATE TABLE IF NOT EXISTS core_schema.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid REFERENCES core_schema.users(id) ON DELETE RESTRICT,
  full_name varchar(180) NOT NULL CHECK (length(trim(full_name)) > 0),
  work_email varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);
