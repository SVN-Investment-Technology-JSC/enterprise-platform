-- CRM · phân loại khách hàng do tenant cấu hình, cùng cách làm với nhóm khách hàng.
-- Trước đây `customers.kind` chỉ nhận 3 giá trị cố định (CHECK). Nay giá trị là mã trong danh mục
-- `customer_kinds`; ba giá trị cũ thành phân loại hệ thống (không xoá, không đổi mã, đổi tên được) nên dữ
-- liệu cũ giữ nguyên. Đổi mã phân loại do tenant tạo thì khoá ngoại tự đổi theo ở khách (ON UPDATE CASCADE);
-- phân loại đang có khách không xoá được (RESTRICT). Nới VARCHAR(16) lên 50 không ghi lại bảng. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm_schema.customer_kinds (
    code        VARCHAR(50) PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description VARCHAR(1000),
    -- Phân loại hệ thống: mã được code dùng làm mặc định (khách mới, khách chuyển từ lead).
    is_system   BOOLEAN NOT NULL DEFAULT false,
    sort_order  INTEGER NOT NULL DEFAULT 100,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID
);

INSERT INTO crm_schema.customer_kinds (code, name, is_system, sort_order)
VALUES ('LEAD_CUSTOMER', 'Khách hàng tiềm năng', true, 10),
       ('CUSTOMER', 'Khách hàng', true, 20),
       ('INACTIVE', 'Ngừng giao dịch', true, 30)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    old RECORD;
BEGIN
    FOR old IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'crm_schema.customers'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%LEAD_CUSTOMER%'
    LOOP
        EXECUTE format('ALTER TABLE crm_schema.customers DROP CONSTRAINT %I', old.conname);
    END LOOP;
END $$;

ALTER TABLE crm_schema.customers ALTER COLUMN kind TYPE VARCHAR(50);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_crm_customers_kind') THEN
        ALTER TABLE crm_schema.customers
            ADD CONSTRAINT fk_crm_customers_kind FOREIGN KEY (kind)
            REFERENCES crm_schema.customer_kinds (code) ON UPDATE CASCADE ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_crm_customers_kind ON crm_schema.customers (kind);
