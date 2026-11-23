-- Vị trí lưu trữ của mặt hàng theo từng kho: chỉ là thông tin tùy chọn, chuỗi tự do, phục vụ kiểm kê và xuất kho.
--
-- 1. `material_storage_locations`: mỗi dòng nói "ở kho này, mặt hàng này nằm ở chỗ này". Một cặp (kho, mặt hàng) có thể có
--    nhiều vị trí, đúng một vị trí chính (nếu có dòng nào). `location_text` là nguồn hiển thị và tìm kiếm; `segments`
--    (các phần theo từng cấp) chỉ là gợi ý để form chia ô, lệch nhau thì `location_text` thắng.
--    Bảng độc lập: không đụng `material_inventory`, giữ hàng hay báo cáo tồn; bản app cũ bỏ qua nó.
-- 2. `warehouses.location_levels`: tên các cấp vị trí của riêng kho (JSONB mảng chuỗi). NULL nghĩa là dùng mẫu của
--    tenant (khoá cài đặt `warehouse.location.levels`). Số cấp không bị giới hạn; đổi tên cấp không đổi dữ liệu đã nhập.
-- Chạy lại được: mọi lệnh đều IF NOT EXISTS hoặc có kiểm tra tồn tại.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.warehouses
    ADD COLUMN IF NOT EXISTS location_levels JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_location_levels_array_check'
    ) THEN
        ALTER TABLE inventory_schema.warehouses
            ADD CONSTRAINT warehouses_location_levels_array_check
            CHECK (location_levels IS NULL OR jsonb_typeof(location_levels) = 'array');
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS inventory_schema.material_storage_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    location_text VARCHAR(255) NOT NULL CHECK (btrim(location_text) <> ''),
    segments JSONB CHECK (segments IS NULL OR jsonb_typeof(segments) = 'array'),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID
);

-- Không khai trùng một chỗ trong cùng kho và mặt hàng (không phân biệt hoa thường, bỏ khoảng trắng hai đầu).
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_storage_locations_text
    ON inventory_schema.material_storage_locations (warehouse_id, material_id, lower(btrim(location_text)));

-- Tối đa một vị trí chính cho mỗi cặp (kho, mặt hàng).
CREATE UNIQUE INDEX IF NOT EXISTS uq_material_storage_locations_primary
    ON inventory_schema.material_storage_locations (warehouse_id, material_id)
    WHERE is_primary;

-- Tra "mặt hàng này nằm ở những kho nào".
CREATE INDEX IF NOT EXISTS idx_material_storage_locations_material
    ON inventory_schema.material_storage_locations (material_id);
