-- Migration: 0025-material-tax-rate.sql
-- Description: Thuế suất (%) của mặt hàng, hàng hóa và dịch vụ, tùy chọn.
-- NULL là chưa khai, khác 0 (chịu thuế 0%). purchase_price và sale_price là giá CHƯA thuế.
-- Cột mới cho phép NULL nên bản app cũ vẫn ghi bình thường; dòng cũ giữ nguyên.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'materials_tax_rate_range'
           AND conrelid = 'inventory_schema.materials'::regclass
    ) THEN
        ALTER TABLE inventory_schema.materials
            ADD CONSTRAINT materials_tax_rate_range
            CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100));
    END IF;
END $$;
