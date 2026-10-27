-- Bán hàng (crm) · lead và cơ hội: cơ hội theo giai đoạn cố định (mục 5.1 kế
-- hoạch) kèm lịch sử chuyển giai đoạn; lead chuyển thành khách hàng và cơ hội
-- bằng một thao tác. Bảng mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- CƠ HỘI
--
-- `stage`: NEW, CONTACTED, DISCOVERY, QUOTING, NEGOTIATION, WON, LOST. Thua bắt
-- buộc lý do (CHECK). `lead_id` ghi lead gốc khi cơ hội sinh từ chuyển đổi; không
-- đặt khoá ngoại vì bảng `leads` tạo sau và cũng trỏ ngược về đây.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.opportunities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES crm_schema.customers (id) ON DELETE RESTRICT,
    name                VARCHAR(300) NOT NULL,
    stage               VARCHAR(16) NOT NULL DEFAULT 'NEW'
                          CHECK (stage IN ('NEW', 'CONTACTED', 'DISCOVERY', 'QUOTING', 'NEGOTIATION', 'WON', 'LOST')),
    probability         SMALLINT NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
    expected_value      NUMERIC(18, 2) CHECK (expected_value IS NULL OR expected_value >= 0),
    expected_close_date DATE,
    need                VARCHAR(4000),
    budget              NUMERIC(18, 2) CHECK (budget IS NULL OR budget >= 0),
    lost_reason         VARCHAR(2000),
    lead_id             UUID,
    owner_user_id       UUID NOT NULL,
    -- Lúc chuyển sang Thắng hoặc Thua.
    closed_at           TIMESTAMPTZ,
    version             INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID,

    CONSTRAINT ck_crm_opportunities_lost_reason
        CHECK (stage <> 'LOST' OR (lost_reason IS NOT NULL AND btrim(lost_reason) <> ''))
);

-- Bảng và kanban theo phạm vi, lọc theo giai đoạn.
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_owner_stage
    ON crm_schema.opportunities (owner_user_id, stage);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_customer
    ON crm_schema.opportunities (customer_id, created_at);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_updated
    ON crm_schema.opportunities (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_stage_updated
    ON crm_schema.opportunities (stage, updated_at DESC, id DESC);
-- Tìm theo đầu từ trong tên cơ hội (như tên khách ở 0002).
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_name_search
    ON crm_schema.opportunities USING GIN (to_tsvector('simple'::regconfig, name));

-- ---------------------------------------------------------------------------
-- LỊCH SỬ GIAI ĐOẠN
--
-- Một dòng mỗi lần chuyển (kể cả lúc tạo, `from_stage` rỗng). Ghi cùng
-- transaction với thay đổi giai đoạn và dòng `audit_log`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.opportunity_stage_history (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES crm_schema.opportunities (id) ON DELETE CASCADE,
    from_stage     VARCHAR(16),
    to_stage       VARCHAR(16) NOT NULL,
    actor_id       UUID,
    reason         VARCHAR(2000),
    at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_crm_opportunity_stage_history_opportunity
    ON crm_schema.opportunity_stage_history (opportunity_id, at);

-- ---------------------------------------------------------------------------
-- LEAD
--
-- `status`: NEW, WORKING, DISQUALIFIED, CONVERTED. Chuyển đổi ghi liên kết hai
-- chiều tới khách hàng và cơ hội; lead đã chuyển đổi chỉ đọc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.leads (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                     VARCHAR(300) NOT NULL,
    contact_name             VARCHAR(200),
    tax_code                 VARCHAR(14),
    phone                    VARCHAR(50),
    email                    VARCHAR(200),
    source                   VARCHAR(100),
    need                     VARCHAR(4000),
    note                     VARCHAR(2000),
    owner_user_id            UUID NOT NULL,
    status                   VARCHAR(16) NOT NULL DEFAULT 'NEW'
                               CHECK (status IN ('NEW', 'WORKING', 'DISQUALIFIED', 'CONVERTED')),
    converted_customer_id    UUID REFERENCES crm_schema.customers (id) ON DELETE RESTRICT,
    converted_opportunity_id UUID REFERENCES crm_schema.opportunities (id) ON DELETE RESTRICT,
    converted_at             TIMESTAMPTZ,
    version                  INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by               UUID,

    CONSTRAINT ck_crm_leads_converted
        CHECK (status <> 'CONVERTED' OR (converted_customer_id IS NOT NULL AND converted_opportunity_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_crm_leads_owner_status
    ON crm_schema.leads (owner_user_id, status);
CREATE INDEX IF NOT EXISTS ix_crm_leads_status_updated
    ON crm_schema.leads (status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_crm_leads_updated
    ON crm_schema.leads (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_crm_leads_name_search
    ON crm_schema.leads USING GIN (to_tsvector('simple'::regconfig, name));
CREATE INDEX IF NOT EXISTS ix_crm_leads_tax_code
    ON crm_schema.leads (tax_code text_pattern_ops) WHERE tax_code IS NOT NULL;
