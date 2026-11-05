-- Bán hàng (crm) · khuyến mãi của báo giá (GĐI, P2I-11): danh mục chương trình khuyến mãi và chính sách chiết khấu
-- cấu hình ở Cài đặt (`promotion_catalog`), các lựa chọn gắn vào từng dự án bán hàng (`opportunity_promotions`), và ảnh chụp
-- lựa chọn đã áp trên từng phiên bản báo giá (`quote_versions.promotions`, JSONB, giống `custom_fields` ở 0030).
-- Khuyến mãi chỉ là thông tin kèm theo, không đổi tổng báo giá. Dữ liệu cũ: `promotions` mặc định `[]`.
-- Chạy lại được: IF NOT EXISTS, ràng buộc chỉ thêm khi chưa có.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm_schema.promotion_catalog (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          VARCHAR(16) NOT NULL CHECK (kind IN ('PROGRAM', 'DISCOUNT_POLICY')),
    code          VARCHAR(50) NOT NULL,
    name          VARCHAR(200) NOT NULL,
    description   VARCHAR(1000),
    discount_type VARCHAR(8) NOT NULL DEFAULT 'NONE' CHECK (discount_type IN ('PERCENT', 'AMOUNT', 'NONE')),
    value         NUMERIC(18, 4) NOT NULL DEFAULT 0 CHECK (value >= 0),
    valid_from    DATE,
    valid_to      DATE,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    UUID,
    CONSTRAINT ck_crm_promotion_catalog_percent CHECK (discount_type <> 'PERCENT' OR value <= 100),
    CONSTRAINT ck_crm_promotion_catalog_none CHECK (discount_type <> 'NONE' OR value = 0),
    CONSTRAINT ck_crm_promotion_catalog_period CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_promotion_catalog_code ON crm_schema.promotion_catalog (lower(code));

CREATE TABLE IF NOT EXISTS crm_schema.opportunity_promotions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES crm_schema.opportunities (id) ON DELETE CASCADE,
    catalog_id     UUID NOT NULL REFERENCES crm_schema.promotion_catalog (id) ON DELETE RESTRICT,
    note           VARCHAR(500),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID,
    CONSTRAINT uq_crm_opportunity_promotions UNIQUE (opportunity_id, catalog_id)
);
CREATE INDEX IF NOT EXISTS ix_crm_opportunity_promotions_catalog ON crm_schema.opportunity_promotions (catalog_id);

-- Mỗi phiên bản chụp lựa chọn đã áp: mảng `{ catalogId, kind, code, name, discountType, value }`.
ALTER TABLE crm_schema.quote_versions
    ADD COLUMN IF NOT EXISTS promotions JSONB NOT NULL DEFAULT '[]'::jsonb;
