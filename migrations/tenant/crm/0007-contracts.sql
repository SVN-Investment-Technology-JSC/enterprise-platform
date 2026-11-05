-- Bán hàng (crm) · hợp đồng: ba loại hợp đồng (mua bán, khung, nguyên tắc), dòng
-- giá khung (engine giá dùng làm nguồn "Hợp đồng"), đợt thanh toán theo phần trăm
-- hoặc số tiền với điều kiện ngày, ký, giao hàng, nghiệm thu. Xác nhận hợp đồng
-- giữ hàng ở Kho qua API nội bộ: chỉ lưu mã giữ hàng, không khoá ngoại sang
-- schema khác. Bảng mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Số thứ tự cho mã hợp đồng `HD<yy><5 chữ số>`.
CREATE SEQUENCE IF NOT EXISTS crm_schema.contract_code_seq;

-- ---------------------------------------------------------------------------
-- HỢP ĐỒNG
--
-- Trạng thái theo mục 5.3 kế hoạch. `quote_id` có khi hợp đồng sinh từ báo giá
-- khách chấp nhận; một báo giá chỉ chuyển một lần (unique bên dưới). Phần giữ
-- hàng khi xác nhận lưu ở `reservation_*`; `reserve_attempt` đổi khoá chống lặp
-- khi lần giữ trước phải nhả lại. `revision` tăng mỗi lần lưu (khoá lạc quan).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.contracts (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                   VARCHAR(30) NOT NULL,
    type                   VARCHAR(16) NOT NULL CHECK (type IN ('SALE', 'FRAMEWORK', 'PRINCIPLE')),
    customer_id            UUID NOT NULL REFERENCES crm_schema.customers (id),
    quote_id               UUID REFERENCES crm_schema.quotes (id),
    title                  VARCHAR(300) NOT NULL,
    signed_date            DATE,
    valid_from             DATE NOT NULL,
    -- Rỗng: không thời hạn (không cảnh báo, không tự hết hạn).
    valid_to               DATE,
    value                  NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (value >= 0),
    warranty_months        INTEGER CHECK (warranty_months >= 0 AND warranty_months <= 600),
    -- Kho giữ hàng khi xác nhận (mã kho của Kho).
    warehouse_code         VARCHAR(50),
    status                 VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                             CHECK (status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'LIQUIDATED', 'CANCELLED')),
    owner_user_id          UUID NOT NULL,
    note                   VARCHAR(4000),
    reservation_id         UUID,
    reservation_code       VARCHAR(100),
    reservation_status     VARCHAR(16) CHECK (reservation_status IN ('HELD', 'RELEASED', 'EXPIRED')),
    reservation_expires_at TIMESTAMPTZ,
    reserve_attempt        INTEGER NOT NULL DEFAULT 1 CHECK (reserve_attempt >= 1),
    revision               INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    confirmed_at           TIMESTAMPTZ,
    confirmed_by           UUID,
    closed_at              TIMESTAMPTZ,
    close_reason           VARCHAR(2000),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by             UUID,

    CONSTRAINT uq_crm_contracts_code UNIQUE (code),
    CONSTRAINT ck_crm_contracts_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- Một báo giá chuyển thành đúng một hợp đồng (T4-06, TC-QUO-13).
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_contracts_quote ON crm_schema.contracts (quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_contracts_customer_status ON crm_schema.contracts (customer_id, status);
CREATE INDEX IF NOT EXISTS ix_crm_contracts_owner_status ON crm_schema.contracts (owner_user_id, status);
-- Job hết hạn và cảnh báo sắp hết hạn chỉ xét hợp đồng Hiệu lực.
CREATE INDEX IF NOT EXISTS ix_crm_contracts_valid_to ON crm_schema.contracts (valid_to) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_crm_contracts_updated ON crm_schema.contracts (updated_at, id);

-- ---------------------------------------------------------------------------
-- DÒNG HỢP ĐỒNG (GIÁ KHUNG)
--
-- Mã, tên, đơn vị, loại là bản chụp từ danh mục Kho. `unit_price` là giá trước
-- VAT; số lượng có với hợp đồng mua bán, rỗng với hợp đồng khung, nguyên tắc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.contract_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id      UUID NOT NULL REFERENCES crm_schema.contracts (id) ON DELETE CASCADE,
    line_no          INTEGER NOT NULL CHECK (line_no >= 1),
    material_id      UUID NOT NULL,
    material_code    VARCHAR(100) NOT NULL,
    material_name    VARCHAR(300) NOT NULL,
    unit             VARCHAR(50) NOT NULL,
    material_kind    VARCHAR(16) NOT NULL DEFAULT 'STOCK',
    quantity         NUMERIC(12, 3) CHECK (quantity > 0),
    unit_price       NUMERIC(18, 2) NOT NULL CHECK (unit_price >= 0),
    vat_rate         NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    discount_percent NUMERIC(7, 4) NOT NULL DEFAULT 0,
    line_amount      NUMERIC(18, 2),
    note             VARCHAR(1000),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_contract_lines_no UNIQUE (contract_id, line_no),
    CONSTRAINT uq_crm_contract_lines_material UNIQUE (contract_id, material_id, unit)
);

CREATE INDEX IF NOT EXISTS ix_crm_contract_lines_material ON crm_schema.contract_lines (material_id);

-- ---------------------------------------------------------------------------
-- ĐỢT THANH TOÁN
--
-- Nhập theo phần trăm (`percent`) hoặc số tiền; `amount` luôn là số tiền của
-- đợt. Tổng các đợt bằng giá trị hợp đồng (kiểm ở API). Sinh khoản phải thu
-- theo đợt làm ở GĐ5; GĐ4 chỉ lưu đợt ở "Chưa đến hạn".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.contract_payment_terms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES crm_schema.contracts (id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL CHECK (seq >= 1),
    name        VARCHAR(200) NOT NULL,
    percent     NUMERIC(7, 4) CHECK (percent > 0 AND percent <= 100),
    amount      NUMERIC(18, 2) NOT NULL CHECK (amount >= 0),
    condition   VARCHAR(16) NOT NULL CHECK (condition IN ('DATE', 'SIGN', 'DELIVERY', 'ACCEPTANCE')),
    due_date    DATE,
    due_days    INTEGER CHECK (due_days >= 0 AND due_days <= 3650),
    status      VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'DUE', 'INVOICED', 'PAID', 'CANCELLED')),
    note        VARCHAR(1000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_contract_payment_terms_seq UNIQUE (contract_id, seq),
    CONSTRAINT ck_crm_contract_payment_terms_date CHECK (condition <> 'DATE' OR due_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_crm_contract_payment_terms_due
    ON crm_schema.contract_payment_terms (status, due_date);

-- Cảnh báo hợp đồng sắp hết hạn trước 30 ngày (CON-06); notification-worker đọc cùng khoá.
INSERT INTO crm_schema.settings (key, value)
VALUES ('contract.expiring', '{"days": 30}'::jsonb)
ON CONFLICT (key) DO NOTHING;
