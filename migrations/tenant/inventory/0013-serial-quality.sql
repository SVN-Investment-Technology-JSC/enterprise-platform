-- Serial một mặt hàng một bản ghi, có trạng thái chất lượng và lịch sử (INV-05, INV-06, T1-13).
--
-- 1. Dừng ngay nếu đang có serial trùng trong cùng một mặt hàng: unique không tạo
--    được trên dữ liệu trùng, và thủ kho phải tự quyết giữ bản nào (kế hoạch mục
--    4.4). Danh sách trùng lấy bằng `node tools/inventory/find-duplicate-serials.mjs`.
-- 2. Unique `(material_id, upper(btrim(serial_number)))`: so sánh bỏ khoảng trắng
--    hai đầu và không phân biệt hoa thường, vì máy quét và người gõ tay cho ra
--    " sn001" và "SN001" cho cùng một cá thể. Giá trị lưu giữ nguyên như người nhập.
-- 3. `quality_status` (Đạt, Cách ly, Lỗi, Chờ kiểm định), mặc định Đạt cho mọi dòng cũ.
-- 4. `stock_state` (Trong kho, Đã xuất, Đang chuyển, Đã huỷ) là cột MỚI, có CHECK.
--    KHÔNG đặt lại CHECK cho `current_status`, `location_type`: hai cột đó là trạng
--    thái sử dụng do admin tenant khai (0009 đã gỡ CHECK, giá trị mặc định khi khai
--    sê-ri là 'OPERATING'), đặt CHECK cứng sẽ làm hỏng dữ liệu thiết bị đang có.
--    Dòng cũ đang nằm ở một kho và chưa lắp vào thiết bị được coi là Trong kho; dòng
--    còn lại để NULL (chưa vào sổ kho).
-- 5. `serial_movements` chỉ ghi thêm: trigger chặn UPDATE và DELETE.
-- 6. Dòng chứng từ kho thêm `serial_numbers` để chứng từ nháp giữ danh sách serial.
-- Chạy lại được: kiểm trùng chỉ đọc, mọi lệnh khác IF NOT EXISTS hoặc CREATE OR REPLACE.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
    duplicate_groups INTEGER;
    duplicate_rows INTEGER;
BEGIN
    SELECT count(*), COALESCE(sum(n), 0)
      INTO duplicate_groups, duplicate_rows
      FROM (
        SELECT count(*) AS n
          FROM inventory_schema.serial_tracking
         GROUP BY material_id, upper(btrim(serial_number))
        HAVING count(*) > 1
      ) duplicates;
    IF duplicate_groups > 0 THEN
        RAISE EXCEPTION 'Không chạy được migration 0013-serial-quality: còn % nhóm serial trùng trong cùng một mặt hàng (% bản ghi).', duplicate_groups, duplicate_rows
            USING ERRCODE = 'P0001',
                  HINT = 'Chạy "node tools/inventory/find-duplicate-serials.mjs --database-url=<URL DB tenant>" để xuất danh sách CSV, thủ kho quyết định giữ bản nào và xử lý bản còn lại (đổi số serial đúng hoặc xoá bản khai nhầm), rồi chạy lại migration.';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_serial_tracking_material_serial
    ON inventory_schema.serial_tracking(material_id, upper(btrim(serial_number)));

-- Tra cứu theo serial khi không biết mặt hàng (bảo hành, API nội bộ).
CREATE INDEX IF NOT EXISTS idx_serial_tracking_serial
    ON inventory_schema.serial_tracking(upper(btrim(serial_number)));

ALTER TABLE inventory_schema.serial_tracking
    ADD COLUMN IF NOT EXISTS quality_status VARCHAR(30) NOT NULL DEFAULT 'PASSED',
    ADD COLUMN IF NOT EXISTS stock_state VARCHAR(20),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE inventory_schema.serial_tracking
    DROP CONSTRAINT IF EXISTS serial_tracking_quality_status_check;
ALTER TABLE inventory_schema.serial_tracking
    ADD CONSTRAINT serial_tracking_quality_status_check
    CHECK (quality_status IN ('PASSED', 'QUARANTINE', 'DEFECTIVE', 'PENDING_INSPECTION'));

ALTER TABLE inventory_schema.serial_tracking
    DROP CONSTRAINT IF EXISTS serial_tracking_stock_state_check;
ALTER TABLE inventory_schema.serial_tracking
    ADD CONSTRAINT serial_tracking_stock_state_check
    CHECK (stock_state IS NULL OR stock_state IN ('IN_STOCK', 'ISSUED', 'IN_TRANSIT', 'SCRAPPED'));

UPDATE inventory_schema.serial_tracking
   SET stock_state = 'IN_STOCK'
 WHERE stock_state IS NULL
   AND current_warehouse_id IS NOT NULL
   AND current_asset_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_serial_tracking_warehouse_state
    ON inventory_schema.serial_tracking(current_warehouse_id, stock_state)
    WHERE current_warehouse_id IS NOT NULL;

ALTER TABLE inventory_schema.stock_document_lines
    ADD COLUMN IF NOT EXISTS serial_numbers TEXT[];

CREATE TABLE IF NOT EXISTS inventory_schema.serial_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_id UUID NOT NULL REFERENCES inventory_schema.serial_tracking(id),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    serial_number VARCHAR(100) NOT NULL,
    movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN (
        'RECEIPT', 'ISSUE', 'TRANSFER', 'RETURN', 'WARRANTY_ISSUE', 'ADJUSTMENT',
        'REVERSAL', 'QUALITY_CHANGE'
    )),
    from_warehouse_id UUID REFERENCES inventory_schema.warehouses(id),
    to_warehouse_id UUID REFERENCES inventory_schema.warehouses(id),
    document_id UUID REFERENCES inventory_schema.stock_documents(id),
    document_line_id UUID,
    source_type VARCHAR(50),
    source_id UUID,
    stock_state VARCHAR(20),
    quality_status VARCHAR(30) NOT NULL,
    previous_quality_status VARCHAR(30),
    reason TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_serial_movements_serial
    ON inventory_schema.serial_movements(serial_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_serial_movements_document
    ON inventory_schema.serial_movements(document_id)
    WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_serial_movements_source
    ON inventory_schema.serial_movements(source_type, source_id)
    WHERE source_id IS NOT NULL;

CREATE OR REPLACE FUNCTION inventory_schema.reject_serial_movement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Lịch sử serial chỉ ghi thêm: không được % dòng %.', TG_OP, OLD.id
        USING ERRCODE = 'P0001', HINT = 'Sai thì tạo chứng từ đảo; chứng từ đảo ghi thêm dòng lịch sử mới.';
END;
$$;

DROP TRIGGER IF EXISTS serial_movements_append_only ON inventory_schema.serial_movements;
CREATE TRIGGER serial_movements_append_only
    BEFORE UPDATE OR DELETE ON inventory_schema.serial_movements
    FOR EACH ROW EXECUTE FUNCTION inventory_schema.reject_serial_movement_mutation();
