-- Mặt hàng dịch vụ và số tháng bảo hành (D6, QUO-01, T1-23).
--
-- 1. CHECK `materials_kind_check` (đặt ở 0006, chỉ STOCK và ASSET) dựng lại có
--    thêm SERVICE. Dịch vụ, phần mềm nằm trong danh mục Kho để Bán hàng chọn,
--    nhưng không quản lý tồn: không có dòng tồn, chứng từ kho và giữ hàng chặn.
--    Ràng buộc `materials_stock_requires_category` chỉ áp cho STOCK nên dịch vụ
--    không bắt buộc nhóm phân loại.
-- 2. Trigger chặn dựng dòng tồn cho mặt hàng dịch vụ: lớp chặn cuối nếu code nào
--    bỏ qua kiểm tra ở tầng ứng dụng.
-- 3. `materials.warranty_months` cho phép NULL (chưa khai), không âm. Áp cho cả
--    hàng hoá lẫn dịch vụ; dòng cũ giữ NULL.
-- Chạy lại được: DROP rồi ADD lại ràng buộc, cột IF NOT EXISTS, CREATE OR REPLACE.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.materials
    DROP CONSTRAINT IF EXISTS materials_kind_check;
ALTER TABLE inventory_schema.materials
    ADD CONSTRAINT materials_kind_check CHECK (kind IN ('STOCK', 'ASSET', 'SERVICE'));

ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS warranty_months INTEGER;

ALTER TABLE inventory_schema.materials
    DROP CONSTRAINT IF EXISTS materials_warranty_months_check;
ALTER TABLE inventory_schema.materials
    ADD CONSTRAINT materials_warranty_months_check
    CHECK (warranty_months IS NULL OR warranty_months >= 0);

CREATE OR REPLACE FUNCTION inventory_schema.reject_service_balance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM inventory_schema.materials
         WHERE id = NEW.material_id AND kind = 'SERVICE'
    ) THEN
        RAISE EXCEPTION 'Mặt hàng dịch vụ không quản lý tồn.' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS material_inventory_reject_service ON inventory_schema.material_inventory;
CREATE TRIGGER material_inventory_reject_service
    BEFORE INSERT ON inventory_schema.material_inventory
    FOR EACH ROW EXECUTE FUNCTION inventory_schema.reject_service_balance();
