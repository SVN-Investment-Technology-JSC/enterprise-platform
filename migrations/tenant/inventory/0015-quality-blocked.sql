-- Hàng không Đạt không tính vào tồn khả dụng (INV-06, INV-07, T1-19).
--
-- Thêm `material_inventory.quantity_blocked`: phần tồn thực tế đang Cách ly, Lỗi
-- hoặc Chờ kiểm định (lô không Đạt và serial không Đạt đang trong kho). Dòng cũ
-- nhận 0 vì trước migration này chưa có lô hay serial nào ở trạng thái khác Đạt.
--
-- `available` là cột sinh; Postgres không sửa được biểu thức của cột sinh nên phải
-- DROP rồi ADD lại, GIỮ NGUYÊN tên cột: mọi chỗ đọc `available` (danh mục vật tư,
-- tồn theo kho, API nội bộ cho Quy trình) tự nhận công thức mới
-- quantity − quantity_reserved − quantity_blocked. Không view nào phụ thuộc cột này.
-- Bảng nhỏ (một dòng mỗi cặp kho, vật tư) nên viết lại bảng nằm trong timeout.
-- Chạy lại được: chỉ dựng lại `available` khi biểu thức còn thiếu `quantity_blocked`.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.material_inventory
    ADD COLUMN IF NOT EXISTS quantity_blocked NUMERIC(12,3) NOT NULL DEFAULT 0;

ALTER TABLE inventory_schema.material_inventory
    DROP CONSTRAINT IF EXISTS material_inventory_quantity_blocked_check;
ALTER TABLE inventory_schema.material_inventory
    ADD CONSTRAINT material_inventory_quantity_blocked_check CHECK (quantity_blocked >= 0);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'inventory_schema'
           AND table_name = 'material_inventory'
           AND column_name = 'available'
           AND generation_expression LIKE '%quantity_blocked%'
    ) THEN
        ALTER TABLE inventory_schema.material_inventory DROP COLUMN IF EXISTS available;
        ALTER TABLE inventory_schema.material_inventory
            ADD COLUMN available NUMERIC(12,3)
            GENERATED ALWAYS AS (quantity - quantity_reserved - quantity_blocked) STORED;
    END IF;
END;
$$;
