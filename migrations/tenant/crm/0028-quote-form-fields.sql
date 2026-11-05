-- Bán hàng (crm) · báo giá theo mẫu (GĐI, P2I-01): các trường đầu phiên bản báo giá (tên, ngày, mẫu, loại báo giá),
-- chế độ chiết khấu và thuế (chụp từ mẫu lúc chọn mẫu, để sửa mẫu sau không đổi giá báo giá cũ), chiết khấu và thuế
-- ở mức tổng đơn (phần trăm HOẶC số tiền, loại trừ nhau) cùng số đã tính, tổng phí trên hợp đồng.
-- Đặt ở `quote_versions` vì mỗi phiên bản có giá riêng và phải giữ nguyên khi sinh phiên bản mới.
-- Dữ liệu cũ: không viết lại dòng nào. Cột chế độ NOT NULL mặc định 'LINE' (theo dòng, đúng hành vi phase 1);
-- các cột còn lại rỗng hoặc 0. `template_id`, `quote_type_id` rỗng với báo giá cũ; khoá ngoại thêm ở 0029
-- sau khi có bảng `quote_templates`, `quote_types`.
-- Chạy lại được: ADD COLUMN IF NOT EXISTS, ràng buộc chỉ thêm khi chưa có.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.quote_versions
    ADD COLUMN IF NOT EXISTS quote_name             VARCHAR(300),
    ADD COLUMN IF NOT EXISTS quote_date             DATE,
    ADD COLUMN IF NOT EXISTS template_id            UUID,
    ADD COLUMN IF NOT EXISTS quote_type_id          UUID,
    ADD COLUMN IF NOT EXISTS discount_mode          VARCHAR(8) NOT NULL DEFAULT 'LINE',
    ADD COLUMN IF NOT EXISTS tax_mode               VARCHAR(8) NOT NULL DEFAULT 'LINE',
    ADD COLUMN IF NOT EXISTS order_discount_percent NUMERIC(7, 4),
    ADD COLUMN IF NOT EXISTS order_discount_amount  NUMERIC(18, 2),
    ADD COLUMN IF NOT EXISTS order_tax_percent      NUMERIC(7, 4),
    ADD COLUMN IF NOT EXISTS order_tax_amount       NUMERIC(18, 2),
    ADD COLUMN IF NOT EXISTS order_discount_total   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS order_tax_total        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fees_amount            NUMERIC(18, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_quote_versions_modes') THEN
        ALTER TABLE crm_schema.quote_versions
            ADD CONSTRAINT ck_crm_quote_versions_modes
            CHECK (discount_mode IN ('LINE', 'ORDER') AND tax_mode IN ('LINE', 'ORDER'));
    END IF;
    -- Chiết khấu, thuế tổng đơn: nhập phần trăm hoặc số tiền, không nhập cả hai.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_quote_versions_order_discount') THEN
        ALTER TABLE crm_schema.quote_versions
            ADD CONSTRAINT ck_crm_quote_versions_order_discount
            CHECK (NOT (order_discount_percent IS NOT NULL AND order_discount_amount IS NOT NULL)
                   AND (order_discount_percent IS NULL OR (order_discount_percent >= 0 AND order_discount_percent <= 100))
                   AND (order_discount_amount IS NULL OR order_discount_amount >= 0));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_quote_versions_order_tax') THEN
        ALTER TABLE crm_schema.quote_versions
            ADD CONSTRAINT ck_crm_quote_versions_order_tax
            CHECK (NOT (order_tax_percent IS NOT NULL AND order_tax_amount IS NOT NULL)
                   AND (order_tax_percent IS NULL OR (order_tax_percent >= 0 AND order_tax_percent <= 100))
                   AND (order_tax_amount IS NULL OR order_tax_amount >= 0));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_quote_versions_form_totals') THEN
        ALTER TABLE crm_schema.quote_versions
            ADD CONSTRAINT ck_crm_quote_versions_form_totals
            CHECK (order_discount_total >= 0 AND order_tax_total >= 0 AND fees_amount >= 0);
    END IF;
END $$;
