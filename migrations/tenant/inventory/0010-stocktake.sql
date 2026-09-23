-- Migration: 0010-stocktake.sql
-- Description: Bổ sung cấu trúc dữ liệu cho chức năng Kiểm kê kho (Stocktake)

CREATE TABLE IF NOT EXISTS inventory_schema.stocktake_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COUNTING', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED')),
    scope_type VARCHAR(50) NOT NULL DEFAULT 'ALL' CHECK (scope_type IN ('ALL', 'CATEGORY', 'SPECIFIC_ITEMS')),
    scope_categories JSONB,
    snapshot_at TIMESTAMPTZ,
    lead_auditor VARCHAR(100),
    auditors JSONB,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_schema.stocktake_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES inventory_schema.stocktake_sessions(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    bin_location VARCHAR(100),
    system_quantity NUMERIC(12,3) NOT NULL,
    count_round_1 NUMERIC(12,3),
    count_round_2 NUMERIC(12,3),
    actual_quantity NUMERIC(12,3),
    difference NUMERIC(12,3) GENERATED ALWAYS AS (actual_quantity - system_quantity) STORED,
    reason TEXT,
    status VARCHAR(50) DEFAULT 'UNCOUNTED' CHECK (status IN ('UNCOUNTED', 'MATCHED', 'SURPLUS', 'DEFICIT')),
    lot_allocations JSONB,
    serial_allocations JSONB,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_schema.stocktake_line_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_id UUID NOT NULL REFERENCES inventory_schema.stocktake_lines(id) ON DELETE CASCADE,
    previous_quantity NUMERIC(12,3),
    new_quantity NUMERIC(12,3) NOT NULL,
    operator VARCHAR(100) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT
);

-- Liên kết bút toán cân kho về đợt kiểm kê
ALTER TABLE inventory_schema.inventory_adjustments
    ADD COLUMN IF NOT EXISTS stocktake_session_id UUID REFERENCES inventory_schema.stocktake_sessions(id),
    ADD COLUMN IF NOT EXISTS stocktake_line_id UUID REFERENCES inventory_schema.stocktake_lines(id);

CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_code ON inventory_schema.stocktake_sessions(code);
CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_warehouse ON inventory_schema.stocktake_sessions(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_status ON inventory_schema.stocktake_sessions(status);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_session ON inventory_schema.stocktake_lines(session_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_lines_material ON inventory_schema.stocktake_lines(material_id);
