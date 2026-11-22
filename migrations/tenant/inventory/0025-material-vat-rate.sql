-- Migration: 0025-material-vat-rate.sql
-- Description: Thuế suất VAT bán ra (%) cho mặt hàng, tùy chọn; báo giá, đơn bán bên CRM lấy làm mặc định.
-- Cột mới cho phép NULL nên bản app cũ vẫn ghi bình thường; dòng cũ để NULL (chưa khai, bên bán coi là 10%).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,2);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_materials_vat_rate'
          AND conrelid = 'inventory_schema.materials'::regclass
    ) THEN
        ALTER TABLE inventory_schema.materials
            ADD CONSTRAINT chk_materials_vat_rate
            CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100));
    END IF;
END $$;

COMMENT ON COLUMN inventory_schema.materials.vat_rate IS
    'Thuế suất VAT bán ra (%); rỗng là chưa khai (bên bán coi là 10%).';
