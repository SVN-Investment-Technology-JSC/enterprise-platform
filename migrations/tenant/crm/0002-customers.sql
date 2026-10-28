-- Bán hàng (crm) · khách hàng: nhóm khách do tenant cấu hình, hồ sơ khách hàng
-- (mã sinh theo cấu hình, MST, phân loại, hạn mức, người phụ trách) và người
-- liên hệ (đúng một người liên hệ chính mỗi khách). Bảng mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- NHÓM KHÁCH HÀNG
--
-- Do quản trị bán hàng (`crm.manage`) tạo. Nhóm đang có khách thì không xoá
-- được: khoá ngoại ở `customers.group_id` là RESTRICT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.customer_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) NOT NULL,
    name        VARCHAR(200) NOT NULL,
    description VARCHAR(1000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID,

    CONSTRAINT uq_crm_customer_groups_code UNIQUE (code)
);

-- ---------------------------------------------------------------------------
-- MÃ KHÁCH HÀNG
--
-- Số thứ tự lấy từ sequence; tiền tố và độ dài nằm ở `settings` khoá
-- `customer.code`. Người dùng sửa được mã nhưng không trùng (unique bên dưới).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS crm_schema.customer_code_seq AS BIGINT START WITH 1 MINVALUE 1;

INSERT INTO crm_schema.settings (key, value)
VALUES ('customer.code', '{"prefix": "KH", "length": 6}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KHÁCH HÀNG
--
-- `kind`: LEAD_CUSTOMER (tiềm năng), CUSTOMER (đang giao dịch), INACTIVE
-- (ngừng giao dịch). `owner_user_id` là người phụ trách, cột lọc phạm vi dữ
-- liệu. `version` tăng mỗi lần sửa để hai người sửa cùng lúc không ghi đè nhau.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.customers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              VARCHAR(50) NOT NULL,
    name              VARCHAR(300) NOT NULL,
    -- 10 số hoặc `10 số-3 số` (đơn vị phụ thuộc); kiểm định dạng ở tầng domain.
    tax_code          VARCHAR(14),
    address           VARCHAR(500),
    province          VARCHAR(100),
    region            VARCHAR(100),
    industry          VARCHAR(100),
    phone             VARCHAR(50),
    email             VARCHAR(200),
    group_id          UUID REFERENCES crm_schema.customer_groups (id) ON DELETE RESTRICT,
    kind              VARCHAR(16) NOT NULL DEFAULT 'LEAD_CUSTOMER'
                        CHECK (kind IN ('LEAD_CUSTOMER', 'CUSTOMER', 'INACTIVE')),
    credit_limit      NUMERIC(18, 2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
    payment_term_days INTEGER CHECK (payment_term_days IS NULL OR payment_term_days BETWEEN 0 AND 365),
    note              VARCHAR(2000),
    owner_user_id     UUID NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        UUID,

    CONSTRAINT uq_crm_customers_code UNIQUE (code)
);

-- Cảnh báo trùng MST.
CREATE INDEX IF NOT EXISTS ix_crm_customers_tax_code
    ON crm_schema.customers (tax_code) WHERE tax_code IS NOT NULL;
-- Lọc theo nhóm (và kiểm nhóm đang được dùng trước khi xoá).
CREATE INDEX IF NOT EXISTS ix_crm_customers_group
    ON crm_schema.customers (group_id) WHERE group_id IS NOT NULL;
-- Phân trang keyset toàn bộ (người thấy mọi dữ liệu).
CREATE INDEX IF NOT EXISTS ix_crm_customers_updated
    ON crm_schema.customers (updated_at DESC, id DESC);
-- Phân trang keyset trong phạm vi người phụ trách (nhân viên, trưởng nhóm).
CREATE INDEX IF NOT EXISTS ix_crm_customers_owner_updated
    ON crm_schema.customers (owner_user_id, updated_at DESC, id DESC);
-- Tìm theo đầu mã (`LIKE 'KH00%'`).
CREATE INDEX IF NOT EXISTS ix_crm_customers_code_prefix
    ON crm_schema.customers (lower(code) text_pattern_ops);
-- Tìm theo đầu MST.
CREATE INDEX IF NOT EXISTS ix_crm_customers_tax_code_prefix
    ON crm_schema.customers (tax_code text_pattern_ops) WHERE tax_code IS NOT NULL;
-- Tìm theo tên: khớp đầu từ ở bất kỳ vị trí nào bằng full-text `simple` (có sẵn
-- trong PostgreSQL). Repo chưa migration nào bật `pg_trgm` nên không dùng
-- trigram; `simple` không bỏ dấu, gõ đúng dấu mới khớp.
CREATE INDEX IF NOT EXISTS ix_crm_customers_name_search
    ON crm_schema.customers USING GIN (to_tsvector('simple'::regconfig, name));

-- ---------------------------------------------------------------------------
-- NGƯỜI LIÊN HỆ
--
-- Mỗi khách đúng một người liên hệ chính khi đã có người liên hệ: partial
-- unique index chặn hai người chính; tầng ứng dụng bỏ cờ người cũ trong cùng
-- transaction khi đổi.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.customer_contacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES crm_schema.customers (id) ON DELETE CASCADE,
    full_name   VARCHAR(200) NOT NULL,
    title       VARCHAR(200),
    phone       VARCHAR(50),
    email       VARCHAR(200),
    note        VARCHAR(1000),
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID
);

CREATE INDEX IF NOT EXISTS ix_crm_customer_contacts_customer
    ON crm_schema.customer_contacts (customer_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_customer_contacts_primary
    ON crm_schema.customer_contacts (customer_id) WHERE is_primary;
