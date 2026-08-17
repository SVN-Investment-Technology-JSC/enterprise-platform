SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Create Inventory schema
CREATE SCHEMA IF NOT EXISTS inventory_schema;

-- Warehouses
CREATE TABLE inventory_schema.warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    warehouse_type VARCHAR(30) NOT NULL,
    plant_code VARCHAR(50),
    manager_user_id UUID,
    address TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage Locations
CREATE TABLE inventory_schema.storage_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES inventory_schema.storage_locations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    location_type VARCHAR(20) NOT NULL,
    barcode_qr VARCHAR(100),
    is_quarantine BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_storage_locations_wh ON inventory_schema.storage_locations(warehouse_id);
CREATE INDEX idx_storage_locations_parent ON inventory_schema.storage_locations(parent_id);

-- Material Categories
CREATE TABLE inventory_schema.material_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES inventory_schema.material_categories(id) ON DELETE SET NULL,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- Materials
CREATE TABLE inventory_schema.materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category_id UUID NOT NULL REFERENCES inventory_schema.material_categories(id),
    uom VARCHAR(30) NOT NULL,
    specification TEXT,
    manufacturer VARCHAR(150),
    part_number_oem VARCHAR(100),
    criticality VARCHAR(10) NOT NULL DEFAULT 'C',
    min_stock NUMERIC(12,2) DEFAULT 0,
    max_stock NUMERIC(12,2) DEFAULT 0,
    reorder_point NUMERIC(12,2) DEFAULT 0,
    lead_time_days INT DEFAULT 0,
    is_serial_controlled BOOLEAN DEFAULT FALSE,
    is_batch_controlled BOOLEAN DEFAULT FALSE,
    is_expiry_controlled BOOLEAN DEFAULT FALSE,
    shelf_life_days INT,
    replacement_steps JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_materials_category ON inventory_schema.materials(category_id);
CREATE INDEX idx_materials_criticality ON inventory_schema.materials(criticality);
CREATE INDEX idx_materials_replacement_steps_gin ON inventory_schema.materials USING gin(replacement_steps);

-- Material Compatibilities
CREATE TABLE inventory_schema.material_compatibilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    asset_code VARCHAR(100) NOT NULL,
    asset_part_symbol VARCHAR(100),
    required_qty NUMERIC(10,2) DEFAULT 1,
    task_template JSONB DEFAULT '[]'::jsonb,
    notes TEXT
);

CREATE INDEX idx_mat_compat_asset ON inventory_schema.material_compatibilities(asset_code);

-- Material Alternatives
CREATE TABLE inventory_schema.material_alternatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    alternative_material_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    interchangeability VARCHAR(20) DEFAULT 'TWO_WAY',
    conversion_ratio NUMERIC(10,4) DEFAULT 1.0,
    notes TEXT
);

-- Inventory Balances
CREATE TABLE inventory_schema.inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id) ON DELETE CASCADE,
    location_id UUID REFERENCES inventory_schema.storage_locations(id) ON DELETE SET NULL,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    on_hand_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    reserved_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    quarantine_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    damaged_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    in_transit_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    available_qty NUMERIC(14,4) GENERATED ALWAYS AS (on_hand_qty - reserved_qty - damaged_qty - quarantine_qty) STORED,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_inv_balance UNIQUE (warehouse_id, location_id, material_id)
);

CREATE INDEX idx_inv_balances_mat ON inventory_schema.inventory_balances(material_id);

-- Inventory Lots
CREATE TABLE inventory_schema.inventory_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number VARCHAR(100) NOT NULL,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    manufacture_date DATE,
    expiry_date DATE,
    co_cq_number VARCHAR(100),
    supplier_code VARCHAR(100),
    notes TEXT
);

-- Inventory Serials
CREATE TABLE inventory_schema.inventory_serials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number VARCHAR(100) NOT NULL,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id) ON DELETE CASCADE,
    lot_id UUID REFERENCES inventory_schema.inventory_lots(id),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    location_id UUID REFERENCES inventory_schema.storage_locations(id),
    status VARCHAR(30) NOT NULL DEFAULT 'IN_STOCK',
    installed_asset_code VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_material_serial UNIQUE(material_id, serial_number)
);

-- Stock Reservations
CREATE TABLE inventory_schema.stock_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_code VARCHAR(50) NOT NULL UNIQUE,
    reference_type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100) NOT NULL,
    requested_by UUID NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock Reservation Items
CREATE TABLE inventory_schema.stock_reservation_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES inventory_schema.stock_reservations(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    reserved_qty NUMERIC(12,2) NOT NULL,
    issued_qty NUMERIC(12,2) DEFAULT 0
);

-- Inventory Transactions (Ledger)
CREATE TABLE inventory_schema.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_code VARCHAR(50) NOT NULL UNIQUE,
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    transaction_type VARCHAR(50) NOT NULL,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    location_id UUID REFERENCES inventory_schema.storage_locations(id),
    lot_id UUID REFERENCES inventory_schema.inventory_lots(id),
    serial_id UUID REFERENCES inventory_schema.inventory_serials(id),
    qty_change NUMERIC(14,4) NOT NULL,
    balance_before NUMERIC(14,4) NOT NULL,
    balance_after NUMERIC(14,4) NOT NULL,
    unit_cost NUMERIC(18,4) DEFAULT 0,
    total_cost NUMERIC(18,4) DEFAULT 0,
    reference_type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100) NOT NULL,
    performed_by UUID NOT NULL,
    notes TEXT
);

CREATE INDEX idx_inv_tx_mat_date ON inventory_schema.inventory_transactions(material_id, transaction_date DESC);
CREATE INDEX idx_inv_tx_ref ON inventory_schema.inventory_transactions(reference_type, reference_id);

-- Stock Receipts
CREATE TABLE inventory_schema.stock_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no VARCHAR(50) NOT NULL UNIQUE,
    receipt_type VARCHAR(50) NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    supplier_code VARCHAR(100),
    supplier_invoice_no VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    procedure_instance_id UUID,
    received_date TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock Receipt Items
CREATE TABLE inventory_schema.stock_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES inventory_schema.stock_receipts(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    location_id UUID REFERENCES inventory_schema.storage_locations(id),
    lot_number VARCHAR(100),
    expiry_date DATE,
    qty_expected NUMERIC(14,4) NOT NULL,
    qty_received NUMERIC(14,4) NOT NULL,
    unit_price NUMERIC(18,4) DEFAULT 0,
    total_price NUMERIC(18,4) DEFAULT 0
);

-- Stock Issues
CREATE TABLE inventory_schema.stock_issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_no VARCHAR(50) NOT NULL UNIQUE,
    issue_type VARCHAR(50) NOT NULL,
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    reservation_id UUID REFERENCES inventory_schema.stock_reservations(id),
    receiver_user_id UUID,
    work_order_code VARCHAR(100),
    work_order_tasks JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    procedure_instance_id UUID,
    issued_date TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock Issue Items
CREATE TABLE inventory_schema.stock_issue_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id UUID NOT NULL REFERENCES inventory_schema.stock_issues(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    location_id UUID REFERENCES inventory_schema.storage_locations(id),
    lot_id UUID REFERENCES inventory_schema.inventory_lots(id),
    serial_id UUID REFERENCES inventory_schema.inventory_serials(id),
    qty_requested NUMERIC(14,4) NOT NULL,
    qty_issued NUMERIC(14,4) NOT NULL,
    unit_cost NUMERIC(18,4) DEFAULT 0
);

-- Stock Transfers
CREATE TABLE inventory_schema.stock_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_no VARCHAR(50) NOT NULL UNIQUE,
    source_warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    dest_warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    transfer_status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    procedure_instance_id UUID,
    shipped_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock Transfer Items
CREATE TABLE inventory_schema.stock_transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES inventory_schema.stock_transfers(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    source_location_id UUID REFERENCES inventory_schema.storage_locations(id),
    dest_location_id UUID REFERENCES inventory_schema.storage_locations(id),
    qty_transfer NUMERIC(14,4) NOT NULL
);

-- Stock Audits
CREATE TABLE inventory_schema.stock_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_no VARCHAR(50) NOT NULL UNIQUE,
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    audit_type VARCHAR(30) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    procedure_instance_id UUID,
    audit_date DATE NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stock Audit Items
CREATE TABLE inventory_schema.stock_audit_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES inventory_schema.stock_audits(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    location_id UUID REFERENCES inventory_schema.storage_locations(id),
    system_qty NUMERIC(14,4) NOT NULL,
    actual_qty NUMERIC(14,4) NOT NULL,
    diff_qty NUMERIC(14,4) GENERATED ALWAYS AS (actual_qty - system_qty) STORED,
    reason TEXT,
    is_adjusted BOOLEAN DEFAULT FALSE
);

-- Goods Inspections
CREATE TABLE inventory_schema.goods_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_no VARCHAR(50) NOT NULL UNIQUE,
    receipt_id UUID NOT NULL REFERENCES inventory_schema.stock_receipts(id) ON DELETE CASCADE,
    inspector_user_id UUID NOT NULL,
    result VARCHAR(20) NOT NULL,
    inspection_date TIMESTAMPTZ DEFAULT NOW(),
    test_report_url TEXT,
    notes TEXT
);
