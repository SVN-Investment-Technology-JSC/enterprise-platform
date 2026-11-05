-- Bán hàng (crm) · đơn bán: đơn (trực tiếp, từ báo giá, từ hợp đồng), dòng đơn
-- (đã giữ, đã giao, serial, giá vốn thực tế), kế hoạch giao nhiều đợt và dòng
-- của từng đợt, chứng từ xuất kho đã áp (chống áp trùng `inventory.stock.issued`).
-- Mặt hàng, giữ hàng, chứng từ thuộc Kho: chỉ lưu id và mã, không khoá ngoại
-- sang schema khác. Bảng mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Số thứ tự cho mã đơn `DH<yy><5 chữ số>`.
CREATE SEQUENCE IF NOT EXISTS crm_schema.sales_order_code_seq;

-- ---------------------------------------------------------------------------
-- ĐƠN BÁN
--
-- Trạng thái theo mục 5.4 kế hoạch. Đơn từ báo giá: một báo giá sinh đúng một
-- đơn (unique bên dưới). Tổng tiền tính lại mỗi lần sửa dòng bằng engine giá.
-- `reserve_attempt` đổi khoá chống lặp khi lần giữ trước phải nhả lại.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.sales_orders (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                   VARCHAR(30) NOT NULL,
    source                 VARCHAR(16) NOT NULL CHECK (source IN ('QUOTE', 'CONTRACT', 'DIRECT')),
    customer_id            UUID NOT NULL REFERENCES crm_schema.customers (id),
    contract_id            UUID REFERENCES crm_schema.contracts (id),
    quote_id               UUID REFERENCES crm_schema.quotes (id),
    opportunity_id         UUID REFERENCES crm_schema.opportunities (id),
    status                 VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT', 'CREDIT_PENDING', 'CONFIRMED', 'DELIVERING', 'PARTIAL',
                                               'DELIVERED', 'DONE', 'CANCELLED')),
    owner_user_id          UUID NOT NULL,
    order_date             DATE NOT NULL,
    expected_delivery_date DATE,
    -- Kho giữ hàng khi xác nhận, kho xuất mặc định của các đợt giao.
    warehouse_code         VARCHAR(50),
    delivery_address       VARCHAR(500),
    note                   VARCHAR(4000),
    price_date             DATE,
    shipping_amount        NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
    shipping_vat_rate      NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (shipping_vat_rate >= 0 AND shipping_vat_rate <= 100),
    gross_amount           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_amount        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    net_amount             NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_amount             NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total_amount           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    reservation_expires_at TIMESTAMPTZ,
    reserve_attempt        INTEGER NOT NULL DEFAULT 1 CHECK (reserve_attempt >= 1),
    revision               INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    confirmed_at           TIMESTAMPTZ,
    confirmed_by           UUID,
    delivered_at           TIMESTAMPTZ,
    cancelled_at           TIMESTAMPTZ,
    cancel_reason          VARCHAR(2000),
    closed_at              TIMESTAMPTZ,
    close_reason           VARCHAR(2000),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by             UUID,

    CONSTRAINT uq_crm_sales_orders_code UNIQUE (code),
    CONSTRAINT ck_crm_sales_orders_source CHECK (
        (source <> 'QUOTE' OR quote_id IS NOT NULL) AND (source <> 'CONTRACT' OR contract_id IS NOT NULL)
    )
);

-- Một báo giá chuyển thành đúng một đơn (T4-06, TC-QUO-13).
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_orders_quote ON crm_schema.sales_orders (quote_id) WHERE source = 'QUOTE';
CREATE INDEX IF NOT EXISTS ix_crm_sales_orders_owner_status ON crm_schema.sales_orders (owner_user_id, status);
CREATE INDEX IF NOT EXISTS ix_crm_sales_orders_customer ON crm_schema.sales_orders (customer_id);
CREATE INDEX IF NOT EXISTS ix_crm_sales_orders_contract ON crm_schema.sales_orders (contract_id);
CREATE INDEX IF NOT EXISTS ix_crm_sales_orders_updated ON crm_schema.sales_orders (updated_at, id);

-- ---------------------------------------------------------------------------
-- DÒNG ĐƠN
--
-- Giá chụp như dòng báo giá. Phần giữ hàng ghi theo dòng: mã giữ hàng của Kho,
-- nguồn (giữ riêng cho đơn hay dùng phần hợp đồng đã giữ), số còn giữ. Số đã
-- giao, serial, giá vốn thực tế cộng dồn từ chứng từ xuất đã ghi sổ.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.sales_order_lines (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                  UUID NOT NULL REFERENCES crm_schema.sales_orders (id) ON DELETE CASCADE,
    line_no                   INTEGER NOT NULL CHECK (line_no >= 1),
    material_id               UUID NOT NULL,
    material_code             VARCHAR(100) NOT NULL,
    material_name             VARCHAR(300) NOT NULL,
    unit                      VARCHAR(50) NOT NULL,
    material_kind             VARCHAR(16) NOT NULL DEFAULT 'STOCK',
    category                  VARCHAR(300),
    quantity                  NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    list_price                NUMERIC(18, 2) NOT NULL CHECK (list_price >= 0),
    price_source              VARCHAR(16) NOT NULL CHECK (price_source IN ('CONTRACT', 'GROUP_LIST', 'STANDARD_LIST', 'MANUAL')),
    price_reference_id        UUID,
    price_reference_code      VARCHAR(100),
    applied_policies          JSONB NOT NULL DEFAULT '[]'::jsonb,
    discount_percent          NUMERIC(7, 4) NOT NULL DEFAULT 0,
    overridden                BOOLEAN NOT NULL DEFAULT FALSE,
    override_unit_price       NUMERIC(18, 2),
    override_discount_percent NUMERIC(7, 4),
    unit_price                NUMERIC(18, 2) NOT NULL,
    gross_amount              NUMERIC(18, 2) NOT NULL,
    discount_amount           NUMERIC(18, 2) NOT NULL,
    vat_rate                  NUMERIC(5, 2) NOT NULL,
    line_amount               NUMERIC(18, 2) NOT NULL,
    vat_amount                NUMERIC(18, 2) NOT NULL,
    line_total                NUMERIC(18, 2) NOT NULL,
    est_unit_cost             NUMERIC(18, 4),
    reserved_quantity         NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    delivered_quantity        NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
    actual_cost               NUMERIC(18, 2) NOT NULL DEFAULT 0,
    serials                   TEXT[] NOT NULL DEFAULT '{}',
    reservation_id            UUID,
    reservation_code          VARCHAR(100),
    reservation_source        VARCHAR(16) CHECK (reservation_source IN ('ORDER', 'CONTRACT')),
    reservation_status        VARCHAR(16) CHECK (reservation_status IN ('HELD', 'RELEASED', 'EXPIRED')),
    reservation_lost_at       TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_sales_order_lines_no UNIQUE (order_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_crm_sales_order_lines_order ON crm_schema.sales_order_lines (order_id);
CREATE INDEX IF NOT EXISTS ix_crm_sales_order_lines_reservation
    ON crm_schema.sales_order_lines (reservation_code) WHERE reservation_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- KẾ HOẠCH GIAO
--
-- Mỗi đợt có ngày dự kiến, kho xuất, địa chỉ. PLANNED: chưa yêu cầu xuất;
-- REQUESTED: đã tạo chứng từ xuất nháp ở Kho (khoá `crm-delivery:<id>`); ISSUED:
-- Kho đã ghi sổ; REVERSED: chứng từ xuất bị đảo hết; CANCELLED: bỏ đợt.
-- `late_notified_at` để job chỉ báo giao trễ một lần cho mỗi ngày dự kiến.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.delivery_plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            UUID NOT NULL REFERENCES crm_schema.sales_orders (id) ON DELETE CASCADE,
    code                VARCHAR(40) NOT NULL,
    seq                 INTEGER NOT NULL CHECK (seq >= 1),
    planned_date        DATE NOT NULL,
    warehouse_code      VARCHAR(50),
    address             VARCHAR(500),
    note                VARCHAR(2000),
    status              VARCHAR(16) NOT NULL DEFAULT 'PLANNED'
                          CHECK (status IN ('PLANNED', 'REQUESTED', 'ISSUED', 'CANCELLED', 'REVERSED')),
    issue_document_id   UUID,
    issue_document_code VARCHAR(100),
    requested_at        TIMESTAMPTZ,
    requested_by        UUID,
    issued_at           TIMESTAMPTZ,
    late_notified_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_delivery_plans_code UNIQUE (code),
    CONSTRAINT uq_crm_delivery_plans_seq UNIQUE (order_id, seq)
);

-- Giao trễ: đợt chưa xuất quá ngày dự kiến (ORD-06).
CREATE INDEX IF NOT EXISTS ix_crm_delivery_plans_status_date ON crm_schema.delivery_plans (status, planned_date);
CREATE INDEX IF NOT EXISTS ix_crm_delivery_plans_order ON crm_schema.delivery_plans (order_id);

CREATE TABLE IF NOT EXISTS crm_schema.delivery_lines (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id        UUID NOT NULL REFERENCES crm_schema.delivery_plans (id) ON DELETE CASCADE,
    order_line_id      UUID NOT NULL REFERENCES crm_schema.sales_order_lines (id) ON DELETE CASCADE,
    planned_quantity   NUMERIC(12, 3) NOT NULL CHECK (planned_quantity > 0),
    delivered_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
    actual_cost        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    -- Serial đã giao theo chứng từ xuất đã ghi sổ.
    serials            TEXT[] NOT NULL DEFAULT '{}',

    CONSTRAINT uq_crm_delivery_lines_line UNIQUE (delivery_id, order_line_id)
);

CREATE INDEX IF NOT EXISTS ix_crm_delivery_lines_order_line ON crm_schema.delivery_lines (order_line_id);

-- ---------------------------------------------------------------------------
-- CHỨNG TỪ XUẤT ĐÃ ÁP
--
-- Mỗi chứng từ xuất (hoặc chứng từ đảo) của Kho áp vào đợt giao đúng một lần,
-- kể cả khi sự kiện `inventory.stock.issued` được phát lại với id khác.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.delivery_issue_documents (
    document_id          UUID PRIMARY KEY,
    delivery_id          UUID NOT NULL REFERENCES crm_schema.delivery_plans (id) ON DELETE CASCADE,
    document_code        VARCHAR(100) NOT NULL,
    reverses_document_id UUID,
    quantity             NUMERIC(12, 3) NOT NULL DEFAULT 0,
    cost_amount          NUMERIC(18, 2) NOT NULL DEFAULT 0,
    applied_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_crm_delivery_issue_documents_delivery ON crm_schema.delivery_issue_documents (delivery_id);

-- Hạn giữ hàng mặc định 7 ngày từ lúc xác nhận đơn (Q12).
INSERT INTO crm_schema.settings (key, value)
VALUES ('reservation.holdDays', '{"days": 7}'::jsonb)
ON CONFLICT (key) DO NOTHING;
