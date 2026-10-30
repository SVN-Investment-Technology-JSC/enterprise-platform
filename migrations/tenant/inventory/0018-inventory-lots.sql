-- Migration: 0018-inventory-lots.sql
-- Description: Bảng theo dõi Lô hàng (Lot/Batch Tracking) chính thức trên Postgres
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS inventory_schema.lot_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    lot_number VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PASSED' 
        CHECK (status IN ('PASSED', 'QUARANTINE', 'NEAR_EXPIRY', 'EXPIRED', 'BLOCKED')),
    quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    unit VARCHAR(50),
    manufacture_date DATE,
    expiry_date DATE,
    supplier VARCHAR(255),
    co_cq_number VARCHAR(100),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_material_warehouse_lot UNIQUE (material_id, warehouse_id, lot_number)
);

CREATE INDEX IF NOT EXISTS idx_lot_tracking_material ON inventory_schema.lot_tracking(material_id);
CREATE INDEX IF NOT EXISTS idx_lot_tracking_warehouse ON inventory_schema.lot_tracking(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_lot_tracking_expiry ON inventory_schema.lot_tracking(expiry_date);
CREATE INDEX IF NOT EXISTS idx_lot_tracking_status ON inventory_schema.lot_tracking(status);
