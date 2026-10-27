-- Bán hàng (crm) · giá: bảng giá (chuẩn hoặc theo nhóm khách), dòng giá theo
-- mặt hàng và đơn vị, chính sách chiết khấu với các tiêu chí P1, trần chiết
-- khấu tổng. Mặt hàng thuộc Kho: chỉ lưu id và bản chụp mã, tên, không đọc
-- schema của Kho. Bảng mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- BẢNG GIÁ
--
-- `is_standard`: bảng giá chuẩn, áp cho mọi khách khi không có giá hợp đồng và
-- bảng giá nhóm. Bảng không chuẩn áp cho các nhóm khách gán ở
-- `price_list_customer_groups`. Hiệu lực tính trọn ngày theo giờ Việt Nam;
-- `valid_to` rỗng là không hết hạn.
--
-- Chặn chồng hiệu lực (hai bảng ACTIVE cùng nhóm, hoặc hai bảng chuẩn ACTIVE)
-- làm ở tầng ứng dụng trong transaction có khoá: repo chưa bật `btree_gist` nên
-- không dùng exclusion constraint.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.price_lists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) NOT NULL,
    name        VARCHAR(200) NOT NULL,
    is_standard BOOLEAN NOT NULL DEFAULT FALSE,
    currency    VARCHAR(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    valid_from  DATE NOT NULL,
    valid_to    DATE,
    status      VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    note        VARCHAR(1000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID,

    CONSTRAINT uq_crm_price_lists_code UNIQUE (code),
    CONSTRAINT ck_crm_price_lists_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- Engine giá tìm bảng chuẩn đang hiệu lực.
CREATE INDEX IF NOT EXISTS ix_crm_price_lists_standard
    ON crm_schema.price_lists (valid_from, valid_to) WHERE is_standard AND status = 'ACTIVE';

-- Giá theo mặt hàng và đơn vị. `vat_rate` là thuế suất mặc định của dòng báo giá.
CREATE TABLE IF NOT EXISTS crm_schema.price_list_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id UUID NOT NULL REFERENCES crm_schema.price_lists (id) ON DELETE CASCADE,
    -- Id mặt hàng ở Kho; mã, tên là bản chụp lúc nhập giá.
    material_id   UUID NOT NULL,
    material_code VARCHAR(100) NOT NULL,
    material_name VARCHAR(300) NOT NULL,
    unit          VARCHAR(50) NOT NULL,
    price         NUMERIC(18, 2) NOT NULL CHECK (price >= 0),
    vat_rate      NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    UUID,

    CONSTRAINT uq_crm_price_list_items_material UNIQUE (price_list_id, material_id, unit)
);

-- Tra giá của một mặt hàng qua mọi bảng.
CREATE INDEX IF NOT EXISTS ix_crm_price_list_items_material
    ON crm_schema.price_list_items (material_id, unit);

-- Nhóm khách áp bảng giá. Xoá nhóm thì bỏ luôn dòng gán.
CREATE TABLE IF NOT EXISTS crm_schema.price_list_customer_groups (
    price_list_id     UUID NOT NULL REFERENCES crm_schema.price_lists (id) ON DELETE CASCADE,
    customer_group_id UUID NOT NULL REFERENCES crm_schema.customer_groups (id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID,

    PRIMARY KEY (price_list_id, customer_group_id)
);

CREATE INDEX IF NOT EXISTS ix_crm_price_list_customer_groups_group
    ON crm_schema.price_list_customer_groups (customer_group_id);

-- ---------------------------------------------------------------------------
-- CHÍNH SÁCH CHIẾT KHẤU
--
-- `priority`: số nhỏ là ưu tiên cao. `exclusive`: chính sách độc quyền ưu tiên
-- cao nhất đang áp thì loại mọi chính sách khác. `stacking`: STACK cộng phần
-- trăm trên giá gốc, MAX chỉ lấy mức cao nhất trong các chính sách MAX. Tổng
-- cắt theo trần ở `settings` khoá `pricing.discountCap`.
--
-- `percent` của chính sách dùng khi chính sách không có bậc số lượng; có bậc
-- thì phần trăm lấy theo bậc khớp (cột `percent` của dòng QUANTITY).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.discount_policies (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                     VARCHAR(50) NOT NULL,
    name                     VARCHAR(200) NOT NULL,
    priority                 INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
    stacking                 VARCHAR(8) NOT NULL DEFAULT 'STACK' CHECK (stacking IN ('STACK', 'MAX')),
    exclusive                BOOLEAN NOT NULL DEFAULT FALSE,
    percent                  NUMERIC(7, 4) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
    valid_from               DATE NOT NULL,
    valid_to                 DATE,
    status                   VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    -- FALSE thì chỉ áp cho khách, nhóm khách nêu ở dòng CUSTOMER, CUSTOMER_GROUP.
    applies_to_all_customers BOOLEAN NOT NULL DEFAULT TRUE,
    note                     VARCHAR(1000),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by               UUID,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by               UUID,

    CONSTRAINT uq_crm_discount_policies_code UNIQUE (code),
    CONSTRAINT ck_crm_discount_policies_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS ix_crm_discount_policies_active
    ON crm_schema.discount_policies (valid_from, valid_to) WHERE status = 'ACTIVE';

-- Tiêu chí của chính sách, chia bốn chiều: số lượng; thời gian; khách hàng hoặc
-- nhóm khách; mặt hàng hoặc nhóm hàng. Các chiều kết hợp AND, các dòng trong
-- cùng chiều kết hợp OR (các bậc số lượng là các dòng QUANTITY).
CREATE TABLE IF NOT EXISTS crm_schema.discount_policy_rules (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id  UUID NOT NULL REFERENCES crm_schema.discount_policies (id) ON DELETE CASCADE,
    criterion  VARCHAR(32) NOT NULL CHECK (criterion IN (
                   'QUANTITY', 'PERIOD', 'CUSTOMER', 'CUSTOMER_GROUP', 'MATERIAL', 'MATERIAL_CATEGORY')),
    -- QUANTITY: số lượng của dòng trong [min_qty, max_qty]; max rỗng là không giới hạn.
    min_qty    NUMERIC(12, 3),
    max_qty    NUMERIC(12, 3),
    -- CUSTOMER, CUSTOMER_GROUP, MATERIAL: id đối tượng; `ref_text` là mã, tên chụp lại để hiển thị.
    ref_id     UUID,
    -- MATERIAL_CATEGORY: loại hàng của Kho (so không phân biệt hoa thường).
    ref_text   VARCHAR(300),
    -- PERIOD: ngày áp trong [from_date, to_date].
    from_date  DATE,
    to_date    DATE,
    -- Chỉ dòng QUANTITY có phần trăm riêng (phần trăm của bậc).
    percent    NUMERIC(7, 4) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ck_crm_discount_policy_rules_shape CHECK (
        CASE criterion
            WHEN 'QUANTITY' THEN min_qty IS NOT NULL AND min_qty > 0
                AND (max_qty IS NULL OR max_qty >= min_qty) AND percent IS NOT NULL
            WHEN 'PERIOD' THEN from_date IS NOT NULL AND (to_date IS NULL OR to_date >= from_date)
            WHEN 'MATERIAL_CATEGORY' THEN ref_text IS NOT NULL
            ELSE ref_id IS NOT NULL
        END
    )
);

CREATE INDEX IF NOT EXISTS ix_crm_discount_policy_rules_policy
    ON crm_schema.discount_policy_rules (policy_id, position);

-- Trần tổng chiết khấu (phần trăm trên giá gốc), mặc định 10%.
INSERT INTO crm_schema.settings (key, value)
VALUES ('pricing.discountCap', '{"percent": 10}'::jsonb)
ON CONFLICT (key) DO NOTHING;
