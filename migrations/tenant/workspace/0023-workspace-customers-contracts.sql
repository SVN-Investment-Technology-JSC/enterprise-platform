SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- KHÁCH HÀNG & HỢP ĐỒNG
--
-- Khách hàng là chủ quản của dự án. Mỗi khách hàng có nhiều hợp đồng. Dự án
-- trỏ tới khách hàng qua `customer_id` (cột thêm bên dưới), giữ song song với
-- `customer_ref` cũ (chữ tự do) để tương thích ngược.
--
-- Mỗi tenant có schema riêng, nên không có cột tenant: ràng buộc UNIQUE trên
-- `code` đã là "duy nhất trong phạm vi tenant", đúng như `projects` và
-- `standalone_tasks`.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL UNIQUE,
    name        VARCHAR(200) NOT NULL,
    note        TEXT,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hợp đồng thuộc đúng một khách hàng. ON DELETE RESTRICT: không xoá được khách
-- hàng khi còn hợp đồng — tầng ứng dụng chặn trước với thông điệp rõ ràng, đây
-- là chốt chặn cuối.
CREATE TABLE IF NOT EXISTS workspace_schema.contracts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID NOT NULL REFERENCES workspace_schema.customers(id) ON DELETE RESTRICT,
    code         VARCHAR(32) NOT NULL UNIQUE,
    name         VARCHAR(200) NOT NULL,
    status       VARCHAR(16) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','completed','cancelled')),
    -- Giá trị hợp đồng (VND); rỗng nghĩa là chưa chốt số.
    value        NUMERIC(18,2),
    signed_date  DATE,
    note         TEXT,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_customer
    ON workspace_schema.contracts (customer_id);

-- Khách hàng chủ quản của dự án (thực thể trong Workspace), song song với
-- `customer_ref` cũ. ON DELETE SET NULL: gỡ khách hàng thì dự án mất con trỏ
-- chứ không mất dự án — dù tầng ứng dụng đã chặn xoá khách hàng còn dự án.
ALTER TABLE workspace_schema.projects
    ADD COLUMN IF NOT EXISTS customer_id UUID
        REFERENCES workspace_schema.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_customer
    ON workspace_schema.projects (customer_id);
