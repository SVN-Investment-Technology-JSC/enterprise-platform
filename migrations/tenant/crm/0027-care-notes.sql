-- Bán hàng (crm) · ghi chú chăm sóc (GĐF, P2F-03): chân dung khách hàng (ghi chú tự do ở hồ sơ khách),
-- đối thủ và giá đối thủ của dự án bán hàng, ghi chú thông tin đơn hàng kèm người và thời điểm ghi.
-- Dữ liệu cũ: giữ NULL, không viết lại dòng nào. `sales_orders.note` (ghi chú giao hàng) giữ nguyên.
-- Chạy lại được: ADD COLUMN IF NOT EXISTS, ràng buộc chỉ thêm khi chưa có.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.customers
    ADD COLUMN IF NOT EXISTS profile_note TEXT;

ALTER TABLE crm_schema.opportunities
    ADD COLUMN IF NOT EXISTS competitor_name VARCHAR(300),
    ADD COLUMN IF NOT EXISTS competitor_price NUMERIC(18, 2);

ALTER TABLE crm_schema.sales_orders
    ADD COLUMN IF NOT EXISTS info_note VARCHAR(4000),
    ADD COLUMN IF NOT EXISTS info_noted_by UUID,
    ADD COLUMN IF NOT EXISTS info_noted_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_opportunities_competitor_price_nonneg') THEN
        ALTER TABLE crm_schema.opportunities
            ADD CONSTRAINT ck_crm_opportunities_competitor_price_nonneg
            CHECK (competitor_price IS NULL OR competitor_price >= 0);
    END IF;
END $$;
