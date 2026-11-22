-- CRM · Thuế suất theo Kho, thuế suất tay ở bảng theo tỷ lệ, thuế suất sửa tay ở dòng báo giá và đơn bán
-- (docs/crm_price_list_logic/plan.md).
-- - `price_list_items.vat_manual`: dòng của bảng theo tỷ lệ có thuế suất nhập tay, đồng bộ Kho không ghi đè. Bảng mặc
--   định nay lấy thuế suất theo Kho mỗi lần đồng bộ. Dữ liệu cũ: mọi dòng là FALSE (theo bảng mặc định).
-- - `quote_lines.override_vat_rate`, `sales_order_lines.override_vat_rate`: thuế suất người dùng sửa tay ở dòng (0–100%);
--   rỗng là theo bảng giá hoặc hợp đồng. Dòng cũ để rỗng nên thuế không đổi.
-- Tương thích ngược: chỉ thêm cột có mặc định hoặc cho phép rỗng. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.price_list_items
    ADD COLUMN IF NOT EXISTS vat_manual BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE crm_schema.quote_lines
    ADD COLUMN IF NOT EXISTS override_vat_rate NUMERIC(5, 2);
ALTER TABLE crm_schema.quote_lines DROP CONSTRAINT IF EXISTS ck_crm_quote_lines_override_vat;
ALTER TABLE crm_schema.quote_lines
    ADD CONSTRAINT ck_crm_quote_lines_override_vat
        CHECK (override_vat_rate IS NULL OR (override_vat_rate >= 0 AND override_vat_rate <= 100));

ALTER TABLE crm_schema.sales_order_lines
    ADD COLUMN IF NOT EXISTS override_vat_rate NUMERIC(5, 2);
ALTER TABLE crm_schema.sales_order_lines DROP CONSTRAINT IF EXISTS ck_crm_sales_order_lines_override_vat;
ALTER TABLE crm_schema.sales_order_lines
    ADD CONSTRAINT ck_crm_sales_order_lines_override_vat
        CHECK (override_vat_rate IS NULL OR (override_vat_rate >= 0 AND override_vat_rate <= 100));
