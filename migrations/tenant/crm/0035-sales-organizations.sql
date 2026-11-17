-- CRM · tổ chức báo giá (phase 3, mục 16). Danh mục công ty con, pháp nhân phát hành báo giá của tenant, và tổ chức đã
-- chọn trên phiên bản báo giá (thông tin chữ sửa được riêng cho báo giá, logo chụp lúc gửi khách). Chỉ thêm bảng mới và
-- cột cho phép rỗng: không ghi lại bảng, không khoá lâu, chạy lại không lỗi. Báo giá cũ để rỗng (không có tổ chức).
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS crm_schema.sales_organizations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 VARCHAR(30),
    name                 VARCHAR(200) NOT NULL,
    short_name           VARCHAR(100),
    address              VARCHAR(500) NOT NULL,
    tax_code             VARCHAR(20)  NOT NULL,
    phone                VARCHAR(50)  NOT NULL,
    email                VARCHAR(200) NOT NULL,
    website              VARCHAR(200),
    bank_account         VARCHAR(50),
    bank_name            VARCHAR(200),
    representative       VARCHAR(200),
    representative_title VARCHAR(100),
    logo                 TEXT,
    is_default           BOOLEAN      NOT NULL DEFAULT false,
    active               BOOLEAN      NOT NULL DEFAULT true,
    sort_order           INT          NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by           UUID,
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by           UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_organizations_code
    ON crm_schema.sales_organizations (lower(code)) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_organizations_name
    ON crm_schema.sales_organizations (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_sales_organizations_default
    ON crm_schema.sales_organizations ((true)) WHERE is_default;

ALTER TABLE crm_schema.quote_versions
    ADD COLUMN IF NOT EXISTS organization_id      UUID REFERENCES crm_schema.sales_organizations (id),
    ADD COLUMN IF NOT EXISTS seller               JSONB,
    ADD COLUMN IF NOT EXISTS seller_logo_snapshot TEXT;

CREATE INDEX IF NOT EXISTS ix_crm_quote_versions_organization
    ON crm_schema.quote_versions (organization_id) WHERE organization_id IS NOT NULL;

COMMENT ON TABLE crm_schema.sales_organizations IS 'Tổ chức báo giá (công ty con, pháp nhân bán hàng) phát hành báo giá.';
COMMENT ON COLUMN crm_schema.sales_organizations.logo IS 'Logo dạng data URL PNG hoặc JPEG, tối đa 300 KB; rỗng: không có logo.';
COMMENT ON COLUMN crm_schema.sales_organizations.is_default IS 'Tổ chức chọn sẵn khi lập báo giá; tối đa một tổ chức.';
COMMENT ON COLUMN crm_schema.quote_versions.organization_id IS 'Tổ chức báo giá đã chọn; rỗng: không chọn (báo giá cũ hoặc bỏ trống).';
COMMENT ON COLUMN crm_schema.quote_versions.seller IS 'Thông tin chữ của tổ chức in lên báo giá (QuoteSeller), sửa được riêng khi còn Nháp.';
COMMENT ON COLUMN crm_schema.quote_versions.seller_logo_snapshot IS 'Logo tổ chức chụp khi phiên bản chuyển sang SENT; chuỗi rỗng: lúc gửi tổ chức không có logo.';
