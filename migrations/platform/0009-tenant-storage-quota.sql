-- Hạn mức dung lượng tệp của tenant (`storage_gb`): theo gói, cộng gói mua thêm.
--
-- 0008 (plans.version, plan_limits, gói mẫu) chưa từng chạy qua migrator. 0009
-- chỉ tạo phần cần cho hạn mức và không sửa gói đã có, nên chạy được dù DB đã
-- hay chưa có 0008. Tenant chưa gắn gói dùng mức mặc định 50 GB (Platform API).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

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

-- Gói mua thêm của từng tenant (bội 100 GB với dung lượng). Nhiều dòng thì cộng
-- dồn; dòng có `ends_on` đã qua thì không còn tính.
CREATE TABLE IF NOT EXISTS subscription_schema.tenant_limit_addons (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenancy_schema.tenants(id) ON DELETE CASCADE,
  resource_key varchar(100) NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ends_on date,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_limit_addons_range CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS tenant_limit_addons_tenant_idx
  ON subscription_schema.tenant_limit_addons(tenant_id, resource_key);

-- Hai gói chuẩn; gói đã có (trùng id hoặc key) giữ nguyên.
INSERT INTO subscription_schema.plans (id, key, name, status)
VALUES
  ('c0000000-0000-4000-8000-000000000001', 'standard', 'Gói Tiêu Chuẩn', 'active'),
  ('c0000000-0000-4000-8000-000000000002', 'enterprise', 'Gói Doanh Nghiệp', 'active')
ON CONFLICT DO NOTHING;

-- Dung lượng đi kèm gói: Tiêu Chuẩn 50 GB, Doanh Nghiệp 500 GB, chặn cứng khi vượt.
INSERT INTO subscription_schema.plan_limits (id, plan_id, resource_key, limit_value, enforcement)
SELECT v.id, p.id, 'storage_gb', v.limit_value, 'hard'
  FROM (VALUES
    ('c1000000-0000-4000-8000-000000000005'::uuid, 'standard', 50),
    ('c1000000-0000-4000-8000-000000000006'::uuid, 'enterprise', 500)
  ) AS v(id, plan_key, limit_value)
  JOIN subscription_schema.plans p ON p.key = v.plan_key
ON CONFLICT DO NOTHING;
