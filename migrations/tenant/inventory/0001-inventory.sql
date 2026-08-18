SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Inventory Schema - Asset & Materials Management (AMM)
-- Principles:
-- 1. Decoupled schema (no cross-schema FK joins)
-- 2. Ledger-only inventory (all changes via inventory_transactions)
-- 3. 3-tier identification: SKU → Manufacturer Serial → Internal Asset Code
-- 4. Reservation as first-class entity with pessimistic locking

CREATE SCHEMA IF NOT EXISTS inventory_schema;

-- ============================================================================
-- SECTION 1: ASSET HIERARCHY & ASSET LIFECYCLE
-- ============================================================================

-- Hierarchical asset tree (Plant → System → Equipment → Component)
CREATE TABLE inventory_schema.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) NOT NULL UNIQUE,
    internal_code VARCHAR(100) UNIQUE,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES inventory_schema.assets(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('PLANT','SYSTEM','EQUIPMENT','COMPONENT')),
    org_unit_id UUID,
    serial_number VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'OPERATING' CHECK (status IN ('OPERATING','STOPPED','MAINTENANCE','DISPOSED')),
    criticality VARCHAR(20) DEFAULT 'MEDIUM' CHECK (criticality IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    specs JSONB,
    -- Default maintenance steps for this asset. Procedure snapshots this into
    -- e_task_config when publishing a Role E step sourced from inventory_asset.
    task_template JSONB NOT NULL DEFAULT '[]'::jsonb,
    qr_code VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_assets_parent ON inventory_schema.assets(parent_id);
CREATE INDEX idx_inventory_assets_code ON inventory_schema.assets(code);
CREATE INDEX idx_inventory_assets_type ON inventory_schema.assets(type);

-- Asset Bill of Materials (BOM) - standard spare parts per asset
CREATE TABLE inventory_schema.asset_boms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES inventory_schema.assets(id) ON DELETE CASCADE,
    material_id UUID NOT NULL,
    standard_quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
    is_critical_spare BOOLEAN DEFAULT FALSE,
    note TEXT
);

CREATE INDEX idx_asset_boms_asset ON inventory_schema.asset_boms(asset_id);

-- Asset status change history
CREATE TABLE inventory_schema.asset_status_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES inventory_schema.assets(id) ON DELETE CASCADE,
    from_status VARCHAR(50) NOT NULL,
    to_status VARCHAR(50) NOT NULL,
    reason TEXT,
    work_order_id UUID,
    changed_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Asset installation/removal journal (spare parts on equipment)
CREATE TABLE inventory_schema.asset_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES inventory_schema.assets(id) ON DELETE CASCADE,
    material_id UUID NOT NULL,
    serial_number VARCHAR(100),
    action VARCHAR(30) NOT NULL CHECK (action IN ('INSTALL','REMOVE','REPLACE')),
    work_order_id UUID,
    technician_id UUID NOT NULL,
    note TEXT,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SECTION 2: WAREHOUSE & INVENTORY MASTER DATA
-- ============================================================================

CREATE TABLE inventory_schema.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'PHYSICAL' CHECK (type IN ('PHYSICAL','VIRTUAL_IN_TRANSIT')),
    org_unit_id UUID,
    manager_user_id UUID,
    location TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE inventory_schema.warehouse_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    qr_code VARCHAR(255)
);

CREATE INDEX idx_warehouse_locations_warehouse ON inventory_schema.warehouse_locations(warehouse_id);

-- Master data: SKU / spare parts / materials
CREATE TABLE inventory_schema.materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL CHECK (category IN ('SPARE_PART','CONSUMABLE','TOOL','ROTABLE')),
    unit VARCHAR(50) NOT NULL,
    min_stock NUMERIC(12,3) DEFAULT 0,
    max_stock NUMERIC(12,3) DEFAULT 0,
    is_serialized BOOLEAN DEFAULT FALSE,
    barcode VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE
);

-- Serial/Rotable tracking - individual unit lifecycle
CREATE TABLE inventory_schema.serial_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    serial_number VARCHAR(100) NOT NULL,
    internal_code VARCHAR(100) UNIQUE,
    current_status VARCHAR(50) NOT NULL CHECK (current_status IN ('IN_STOCK','IN_USE','UNDER_REPAIR','IN_TRANSIT','SCRAPPED')),
    location_type VARCHAR(50) NOT NULL CHECK (location_type IN ('WAREHOUSE','ASSET','VENDOR_REPAIR')),
    current_warehouse_id UUID REFERENCES inventory_schema.warehouses(id),
    current_asset_id UUID REFERENCES inventory_schema.assets(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_serial_tracking_material ON inventory_schema.serial_tracking(material_id);

-- ============================================================================
-- SECTION 3: INVENTORY LEDGER & TRANSACTIONS (IMMUTABLE)
-- ============================================================================

-- Real-time inventory balance per warehouse
CREATE TABLE inventory_schema.material_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    location_id UUID REFERENCES inventory_schema.warehouse_locations(id),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    quantity_reserved NUMERIC(12,3) NOT NULL DEFAULT 0,
    available NUMERIC(12,3) GENERATED ALWAYS AS (quantity - quantity_reserved) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(warehouse_id, location_id, material_id)
);

CREATE INDEX idx_material_inventory_wh ON inventory_schema.material_inventory(warehouse_id);
CREATE INDEX idx_material_inventory_material ON inventory_schema.material_inventory(material_id);

-- Reservation as first-class entity with expiry
CREATE TABLE inventory_schema.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_code VARCHAR(100) NOT NULL UNIQUE,
    reference_type VARCHAR(50) NOT NULL,
    reference_id UUID,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESERVED','PARTIALLY_ISSUED','COMPLETED','CANCELLED','EXPIRED')),
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory_schema.reservation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES inventory_schema.reservations(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    quantity_reserved NUMERIC(12,3) NOT NULL,
    quantity_issued NUMERIC(12,3) NOT NULL DEFAULT 0
);

CREATE INDEX idx_reservation_items_reservation ON inventory_schema.reservation_items(reservation_id);

-- Immutable transaction ledger (append-only, no updates)
CREATE TABLE inventory_schema.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_code VARCHAR(100) NOT NULL UNIQUE,
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    location_id UUID REFERENCES inventory_schema.warehouse_locations(id),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    serial_number VARCHAR(100),
    type VARCHAR(50) NOT NULL CHECK (type IN ('IMPORT','EXPORT','TRANSFER_OUT','TRANSFER_IN','BORROW','RETURN','ADJUST')),
    quantity NUMERIC(12,3) NOT NULL,
    unit_cost NUMERIC(18,4) DEFAULT 0,
    reference_type VARCHAR(50),
    reference_id UUID,
    workflow_status VARCHAR(50) DEFAULT 'APPROVED' CHECK (workflow_status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
    note TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inventory_transactions_warehouse ON inventory_schema.inventory_transactions(warehouse_id);
CREATE INDEX idx_inventory_transactions_material ON inventory_schema.inventory_transactions(material_id);
CREATE INDEX idx_inventory_transactions_type ON inventory_schema.inventory_transactions(type);

-- Stock cycle count & variance adjustment
CREATE TABLE inventory_schema.inventory_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    system_quantity NUMERIC(12,3) NOT NULL,
    actual_quantity NUMERIC(12,3) NOT NULL,
    difference NUMERIC(12,3) GENERATED ALWAYS AS (actual_quantity - system_quantity) STORED,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    approved_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- INDEXES & CONSTRAINTS
-- ============================================================================

CREATE INDEX idx_materials_code ON inventory_schema.materials(code);
CREATE INDEX idx_warehouses_code ON inventory_schema.warehouses(code);
CREATE INDEX idx_reservations_status ON inventory_schema.reservations(status);
CREATE INDEX idx_reservations_expires ON inventory_schema.reservations(expires_at) WHERE status != 'COMPLETED';
