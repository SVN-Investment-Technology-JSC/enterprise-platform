-- Bán hàng (crm) · phương án kinh doanh (PAKD, GĐ D, P2D-01): mỗi phiên bản báo giá có tối đa một PAKD gồm
-- các dòng chi phí (chiết khấu, giảm giá, thầu phụ, chi phí khác), trạng thái duyệt riêng và các vòng duyệt.
-- Cột doanh thu, giá vốn, tổng chi phí, lợi nhuận là bản chụp tại lúc tính gần nhất (đóng băng khi trình duyệt);
-- tiền `NUMERIC(18,2)`. `version` chống ghi đè đồng thời. Chạy lại được: CREATE ... IF NOT EXISTS.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm_schema.business_plans (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id           UUID NOT NULL REFERENCES crm_schema.quotes (id) ON DELETE CASCADE,
    quote_version_id   UUID NOT NULL REFERENCES crm_schema.quote_versions (id) ON DELETE CASCADE,
    -- DRAFT: đang soạn; PENDING: đã trình, khoá sửa; APPROVED; REJECTED: bị từ chối, sửa lại được.
    status             VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    version            INTEGER NOT NULL DEFAULT 1,
    note               VARCHAR(2000),
    gross_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0,
    revenue            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    goods_cost         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_amount    NUMERIC(18, 2) NOT NULL DEFAULT 0,
    extra_cost_total   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total_cost         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    profit             NUMERIC(18, 2) NOT NULL DEFAULT 0,
    -- Rỗng khi doanh thu bằng 0.
    margin_percent     NUMERIC(9, 2),
    discount_percent   NUMERIC(7, 4) NOT NULL DEFAULT 0,
    -- Lúc chụp số liệu lần cuối; rỗng khi chưa trình duyệt lần nào.
    snapshot_at        TIMESTAMPTZ,
    current_round_no   INTEGER,
    submitted_at       TIMESTAMPTZ,
    submitted_by       UUID,
    decided_at         TIMESTAMPTZ,
    decided_by         UUID,
    decision_reason    VARCHAR(2000),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by         UUID NOT NULL,

    CONSTRAINT uq_crm_business_plans_version UNIQUE (quote_version_id),
    CONSTRAINT ck_crm_business_plans_status CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT ck_crm_business_plans_revision CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS ix_crm_business_plans_quote ON crm_schema.business_plans (quote_id, status);

CREATE TABLE IF NOT EXISTS crm_schema.business_plan_lines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id     UUID NOT NULL REFERENCES crm_schema.business_plans (id) ON DELETE CASCADE,
    line_no     INTEGER NOT NULL,
    -- DISCOUNT chiết khấu, PRICE_REDUCTION giảm giá, SUBCONTRACT thầu phụ, OTHER chi phí khác.
    kind        VARCHAR(20) NOT NULL,
    description VARCHAR(300),
    amount      NUMERIC(18, 2) NOT NULL,

    CONSTRAINT uq_crm_business_plan_lines_no UNIQUE (plan_id, line_no),
    CONSTRAINT ck_crm_business_plan_lines_kind CHECK (kind IN ('DISCOUNT', 'PRICE_REDUCTION', 'SUBCONTRACT', 'OTHER')),
    CONSTRAINT ck_crm_business_plan_lines_amount CHECK (amount >= 0)
);

-- Các vòng duyệt: mỗi lần trình là một vòng, số vòng tăng dần trong cùng một báo giá (qua các phiên bản);
-- vòng đã quyết định không sửa nữa. `via`: STANDALONE (trình riêng) hoặc QUOTE (đi cùng lần gửi duyệt báo giá).
CREATE TABLE IF NOT EXISTS crm_schema.business_plan_rounds (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id           UUID NOT NULL REFERENCES crm_schema.business_plans (id) ON DELETE CASCADE,
    quote_id          UUID NOT NULL REFERENCES crm_schema.quotes (id) ON DELETE CASCADE,
    round_no          INTEGER NOT NULL,
    quote_version_no  INTEGER NOT NULL,
    via               VARCHAR(12) NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_by      UUID NOT NULL,
    decided_at        TIMESTAMPTZ,
    decided_by        UUID,
    decision          VARCHAR(12),
    reason            VARCHAR(2000),
    gross_amount      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    revenue           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    goods_cost        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_amount   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    extra_cost_total  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total_cost        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    profit            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    margin_percent    NUMERIC(9, 2),
    discount_percent  NUMERIC(7, 4) NOT NULL DEFAULT 0,

    CONSTRAINT uq_crm_business_plan_rounds_no UNIQUE (quote_id, round_no),
    CONSTRAINT ck_crm_business_plan_rounds_via CHECK (via IN ('STANDALONE', 'QUOTE')),
    CONSTRAINT ck_crm_business_plan_rounds_decision CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS ix_crm_business_plan_rounds_plan ON crm_schema.business_plan_rounds (plan_id, round_no);
