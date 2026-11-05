-- Bán hàng (crm) · dự toán của dự án bán hàng (GĐD, P2D-09): thêm hai trường tổng giá trị dự toán và
-- giá vốn dự kiến của dự toán vào `opportunities` để đối chiếu với phương án kinh doanh (PAKD).
-- Dữ liệu cũ: giữ NULL (chưa nhập dự toán), không viết lại dòng nào.
-- Chạy lại được: ADD COLUMN IF NOT EXISTS, ràng buộc chỉ thêm khi chưa có.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.opportunities
    ADD COLUMN IF NOT EXISTS estimate_total_value NUMERIC(18, 2),
    ADD COLUMN IF NOT EXISTS estimate_cost_value NUMERIC(18, 2);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_opportunities_estimate_total_nonneg') THEN
        ALTER TABLE crm_schema.opportunities
            ADD CONSTRAINT ck_crm_opportunities_estimate_total_nonneg
            CHECK (estimate_total_value IS NULL OR estimate_total_value >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_opportunities_estimate_cost_nonneg') THEN
        ALTER TABLE crm_schema.opportunities
            ADD CONSTRAINT ck_crm_opportunities_estimate_cost_nonneg
            CHECK (estimate_cost_value IS NULL OR estimate_cost_value >= 0);
    END IF;
END $$;
