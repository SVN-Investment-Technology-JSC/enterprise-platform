-- Bán hàng (crm) · báo giá theo mẫu (GĐI, P2I-02): mẫu báo giá (quyết định chiết khấu, thuế theo dòng hay theo tổng đơn),
-- loại báo giá, phí trên hợp đồng (nhiều khoản), người theo dõi, đối tượng liên quan; bộ mẫu và loại mặc định nạp sẵn;
-- sequence riêng cho mã báo giá theo mẫu cấu hình (không đụng `quote_code_seq` của mã cũ `BG<yy><5 chữ số>`).
-- Bảng mới, không có dữ liệu cũ. Báo giá cũ giữ `template_id`, `quote_type_id` rỗng.
-- Chạy lại được: IF NOT EXISTS, ON CONFLICT DO NOTHING, ràng buộc chỉ thêm khi chưa có.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SEQUENCE IF NOT EXISTS crm_schema.quote_code_form_seq;

-- Mẫu báo giá. `discount_mode`, `tax_mode`: LINE = tính theo dòng như engine giá phase 1; ORDER = bỏ chiết khấu
-- (hoặc thuế) theo dòng và áp một lần ở tổng đơn. Chỉ một mẫu mặc định.
CREATE TABLE IF NOT EXISTS crm_schema.quote_templates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(200) NOT NULL,
    discount_mode VARCHAR(8) NOT NULL DEFAULT 'LINE' CHECK (discount_mode IN ('LINE', 'ORDER')),
    tax_mode      VARCHAR(8) NOT NULL DEFAULT 'LINE' CHECK (tax_mode IN ('LINE', 'ORDER')),
    description   VARCHAR(1000),
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_quote_templates_name ON crm_schema.quote_templates (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_quote_templates_default ON crm_schema.quote_templates (is_default) WHERE is_default;

-- Loại báo giá (ví dụ "Báo đơn giá và số lượng").
CREATE TABLE IF NOT EXISTS crm_schema.quote_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    description VARCHAR(1000),
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_quote_types_name ON crm_schema.quote_types (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_quote_types_default ON crm_schema.quote_types (is_default) WHERE is_default;

INSERT INTO crm_schema.quote_templates (name, discount_mode, tax_mode, description, is_default, sort_order)
VALUES ('Báo giá theo dòng (mặc định)', 'LINE', 'LINE',
        'Chiết khấu và thuế tính theo từng dòng hàng, như báo giá trước đây.', TRUE, 1),
       ('Chiết khấu trên tổng giá trị đơn hàng', 'ORDER', 'ORDER',
        'Không chiết khấu và thuế theo dòng; chiết khấu và thuế áp một lần trên tổng đơn.', FALSE, 2)
ON CONFLICT DO NOTHING;

INSERT INTO crm_schema.quote_types (name, description, is_default, sort_order)
VALUES ('Báo đơn giá và số lượng', 'Báo giá theo đơn giá và số lượng từng mặt hàng.', TRUE, 1),
       ('Báo giá trọn gói', 'Báo giá một giá trọn gói cho cả hạng mục.', FALSE, 2)
ON CONFLICT DO NOTHING;

-- Khoá ngoại từ phiên bản (cột thêm ở 0028).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_quote_versions_template') THEN
        ALTER TABLE crm_schema.quote_versions
            ADD CONSTRAINT fk_crm_quote_versions_template FOREIGN KEY (template_id) REFERENCES crm_schema.quote_templates (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_quote_versions_type') THEN
        ALTER TABLE crm_schema.quote_versions
            ADD CONSTRAINT fk_crm_quote_versions_type FOREIGN KEY (quote_type_id) REFERENCES crm_schema.quote_types (id);
    END IF;
END $$;

-- Phí trên cả hợp đồng: nhiều khoản theo phiên bản (loại phí tự do, số tiền).
CREATE TABLE IF NOT EXISTS crm_schema.quote_fees (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES crm_schema.quote_versions (id) ON DELETE CASCADE,
    line_no    INTEGER NOT NULL CHECK (line_no >= 1),
    fee_type   VARCHAR(200) NOT NULL,
    amount     NUMERIC(18, 2) NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    CONSTRAINT uq_crm_quote_fees_no UNIQUE (version_id, line_no)
);

-- Người theo dõi báo giá (theo báo giá, không theo phiên bản).
CREATE TABLE IF NOT EXISTS crm_schema.quote_followers (
    quote_id UUID NOT NULL REFERENCES crm_schema.quotes (id) ON DELETE CASCADE,
    user_id  UUID NOT NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    added_by UUID,
    PRIMARY KEY (quote_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_crm_quote_followers_user ON crm_schema.quote_followers (user_id);

-- Đối tượng liên quan: id trỏ tới bảng tuỳ loại nên không có khoá ngoại (kiểm ở tầng ứng dụng).
CREATE TABLE IF NOT EXISTS crm_schema.quote_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id    UUID NOT NULL REFERENCES crm_schema.quotes (id) ON DELETE CASCADE,
    target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('CUSTOMER', 'OPPORTUNITY', 'CONTRACT', 'SALES_ORDER', 'QUOTE')),
    target_id   UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    CONSTRAINT uq_crm_quote_links_target UNIQUE (quote_id, target_type, target_id)
);
