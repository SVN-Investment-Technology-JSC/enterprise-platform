-- Lô và hạn dùng lưu ở server (INV-04, T1-16). Trước đây lô chỉ nằm trong
-- localStorage của trình duyệt; dữ liệu đó không chuyển lên được (kế hoạch mục 4.4,
-- TC-MIG-10), thủ kho nhập lại lô thật bằng chứng từ.
--
-- `lots`: một lô của một mặt hàng, số lô duy nhất trong mặt hàng (code lưu số lô đã
-- bỏ khoảng trắng hai đầu và viết hoa). `lot_balances`: tồn của lô tại từng kho;
-- `quantity_blocked` là phần không Đạt (bằng `quantity` khi lô không ở trạng thái
-- Đạt), cộng dồn vào `material_inventory.quantity_blocked` ở 0015.
-- `lot_quality_events`: lịch sử đổi trạng thái chất lượng của lô, chỉ ghi thêm.
-- Dòng chứng từ kho thêm `lot_id` cho phép NULL; dòng cũ giữ NULL.
-- Chạy lại được: mọi lệnh đều IF NOT EXISTS hoặc CREATE OR REPLACE.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS inventory_schema.lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    lot_no VARCHAR(100) NOT NULL,
    manufactured_on DATE,
    expires_on DATE,
    quality_status VARCHAR(30) NOT NULL DEFAULT 'PASSED' CHECK (quality_status IN (
        'PASSED', 'QUARANTINE', 'DEFECTIVE', 'PENDING_INSPECTION'
    )),
    supplier VARCHAR(255),
    certificate_no VARCHAR(100),
    note TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lots_material_lot_no_key UNIQUE (material_id, lot_no),
    CONSTRAINT lots_dates_check CHECK (
        manufactured_on IS NULL OR expires_on IS NULL OR manufactured_on <= expires_on
    )
);

CREATE INDEX IF NOT EXISTS idx_lots_expiry
    ON inventory_schema.lots(material_id, expires_on);

CREATE TABLE IF NOT EXISTS inventory_schema.lot_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    lot_id UUID NOT NULL REFERENCES inventory_schema.lots(id),
    quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    quantity_reserved NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
    quantity_blocked NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity_blocked >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT lot_balances_warehouse_lot_key UNIQUE (warehouse_id, lot_id),
    CONSTRAINT lot_balances_blocked_within_quantity CHECK (quantity_blocked <= quantity)
);

CREATE INDEX IF NOT EXISTS idx_lot_balances_lot
    ON inventory_schema.lot_balances(lot_id);

ALTER TABLE inventory_schema.stock_document_lines
    ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES inventory_schema.lots(id);

CREATE INDEX IF NOT EXISTS idx_stock_document_lines_lot
    ON inventory_schema.stock_document_lines(lot_id)
    WHERE lot_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_schema.lot_quality_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id UUID NOT NULL REFERENCES inventory_schema.lots(id),
    from_status VARCHAR(30) NOT NULL,
    to_status VARCHAR(30) NOT NULL,
    reason TEXT NOT NULL,
    actor_id UUID NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lot_quality_events_lot
    ON inventory_schema.lot_quality_events(lot_id, occurred_at);

CREATE OR REPLACE FUNCTION inventory_schema.reject_lot_quality_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Lịch sử chất lượng lô chỉ ghi thêm: không được % dòng %.', TG_OP, OLD.id
        USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS lot_quality_events_append_only ON inventory_schema.lot_quality_events;
CREATE TRIGGER lot_quality_events_append_only
    BEFORE UPDATE OR DELETE ON inventory_schema.lot_quality_events
    FOR EACH ROW EXECUTE FUNCTION inventory_schema.reject_lot_quality_event_mutation();
