SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Upgrade subscription_schema.plans
ALTER TABLE subscription_schema.plans
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. Create plan_limits table
CREATE TABLE IF NOT EXISTS subscription_schema.plan_limits (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES subscription_schema.plans(id) ON DELETE CASCADE,
  resource_key varchar(100) NOT NULL,
  limit_value integer NOT NULL,
  enforcement varchar(32) NOT NULL DEFAULT 'hard' CHECK (enforcement IN ('hard', 'soft')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, resource_key)
);

CREATE INDEX IF NOT EXISTS plan_limits_plan_idx ON subscription_schema.plan_limits(plan_id);

-- 3. Seed default plans if not already present
INSERT INTO subscription_schema.plans (id, key, name, description, version, status)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'standard', 'Gói Tiêu Chuẩn', 'Gói dịch vụ vận hành cơ bản cho doanh nghiệp vừa và nhỏ', 1, 'active'),
  ('c0000000-0000-4000-8000-000000000002', 'enterprise', 'Gói Doanh Nghiệp', 'Gói dịch vụ toàn diện quy mô lớn', 1, 'active')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

-- 4. Seed default plan limits
INSERT INTO subscription_schema.plan_limits (id, plan_id, resource_key, limit_value, enforcement)
VALUES
  ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'active_users', 50, 'hard'),
  ('c1000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'procedure_definitions', 20, 'hard'),
  ('c1000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 'active_users', 500, 'hard'),
  ('c1000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', 'procedure_definitions', 200, 'soft')
ON CONFLICT (plan_id, resource_key) DO NOTHING;
