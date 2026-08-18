CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS inventory_schema;

CREATE TABLE inventory_schema.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE,
  name varchar(255) NOT NULL, type varchar(30) NOT NULL DEFAULT 'PHYSICAL',
  address text, manager_user_id uuid, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouses_type_check CHECK (type IN ('PHYSICAL','VIRTUAL_IN_TRANSIT'))
);
CREATE TABLE inventory_schema.warehouse_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES inventory_schema.warehouse_locations(id), code varchar(50) NOT NULL,
  name varchar(255) NOT NULL, type varchar(20) NOT NULL DEFAULT 'BIN', qr_code varchar(255), is_active boolean NOT NULL DEFAULT true,
  UNIQUE (warehouse_id, code)
);
CREATE TABLE inventory_schema.item_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(50) NOT NULL UNIQUE, name varchar(255) NOT NULL,
  parent_id uuid REFERENCES inventory_schema.item_categories(id), is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE inventory_schema.uoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(20) NOT NULL UNIQUE, name varchar(100) NOT NULL,
  precision smallint NOT NULL DEFAULT 3 CHECK (precision BETWEEN 0 AND 6)
);
CREATE TABLE inventory_schema.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(100) NOT NULL UNIQUE, name varchar(255) NOT NULL,
  category_id uuid REFERENCES inventory_schema.item_categories(id), uom_id uuid NOT NULL REFERENCES inventory_schema.uoms(id),
  description text, barcode varchar(100), tracking_type varchar(20) NOT NULL DEFAULT 'NONE',
  costing_method varchar(20) NOT NULL DEFAULT 'FIFO', min_stock numeric(14,4) NOT NULL DEFAULT 0,
  max_stock numeric(14,4) NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (tracking_type IN ('NONE','LOT','SERIAL')), CHECK (costing_method IN ('FIFO','LIFO','AVERAGE')),
  CHECK (min_stock >= 0 AND max_stock >= 0)
);
CREATE TABLE inventory_schema.inventory_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES inventory_schema.items(id),
  lot_number varchar(100) NOT NULL, manufacture_date date, expiry_date date, supplier_code varchar(100), notes text,
  UNIQUE (item_id, lot_number)
);
CREATE TABLE inventory_schema.stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id),
  location_id uuid REFERENCES inventory_schema.warehouse_locations(id), item_id uuid NOT NULL REFERENCES inventory_schema.items(id),
  lot_id uuid REFERENCES inventory_schema.inventory_lots(id), on_hand_qty numeric(14,4) NOT NULL DEFAULT 0,
  reserved_qty numeric(14,4) NOT NULL DEFAULT 0, quarantine_qty numeric(14,4) NOT NULL DEFAULT 0,
  damaged_qty numeric(14,4) NOT NULL DEFAULT 0,
  available_qty numeric(14,4) GENERATED ALWAYS AS (on_hand_qty-reserved_qty-quarantine_qty-damaged_qty) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (warehouse_id, location_id, item_id, lot_id),
  CHECK (on_hand_qty >= 0 AND reserved_qty >= 0 AND quarantine_qty >= 0 AND damaged_qty >= 0)
);
CREATE INDEX stock_balances_item_idx ON inventory_schema.stock_balances(item_id, warehouse_id);
CREATE TABLE inventory_schema.item_serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES inventory_schema.items(id),
  serial_number varchar(100) NOT NULL, lot_id uuid REFERENCES inventory_schema.inventory_lots(id),
  warehouse_id uuid REFERENCES inventory_schema.warehouses(id), location_id uuid REFERENCES inventory_schema.warehouse_locations(id),
  status varchar(30) NOT NULL DEFAULT 'IN_STOCK', installed_asset_code varchar(100), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, serial_number)
);
CREATE TABLE inventory_schema.stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transaction_code varchar(50) NOT NULL UNIQUE,
  transaction_date timestamptz NOT NULL DEFAULT now(), transaction_type varchar(30) NOT NULL,
  item_id uuid NOT NULL REFERENCES inventory_schema.items(id), warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id),
  location_id uuid REFERENCES inventory_schema.warehouse_locations(id), lot_id uuid REFERENCES inventory_schema.inventory_lots(id),
  serial_id uuid REFERENCES inventory_schema.item_serials(id), qty_change numeric(14,4) NOT NULL,
  balance_before numeric(14,4) NOT NULL, balance_after numeric(14,4) NOT NULL,
  unit_cost numeric(18,4) NOT NULL DEFAULT 0, reference_type varchar(50) NOT NULL,
  reference_id varchar(100) NOT NULL, performed_by uuid NOT NULL, notes text,
  CHECK (qty_change <> 0), CHECK (balance_after >= 0)
);
CREATE INDEX stock_transactions_history_idx ON inventory_schema.stock_transactions(item_id, transaction_date DESC);
CREATE TABLE inventory_schema.stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_no varchar(50) NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id), status varchar(30) NOT NULL DEFAULT 'POSTED',
  supplier_code varchar(100), received_date timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_schema.stock_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid NOT NULL REFERENCES inventory_schema.stock_receipts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_schema.items(id), location_id uuid REFERENCES inventory_schema.warehouse_locations(id),
  lot_id uuid REFERENCES inventory_schema.inventory_lots(id), quantity numeric(14,4) NOT NULL CHECK (quantity > 0), unit_cost numeric(18,4) NOT NULL DEFAULT 0
);
CREATE TABLE inventory_schema.stock_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue_no varchar(50) NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id), status varchar(30) NOT NULL DEFAULT 'POSTED',
  reference_type varchar(50), reference_id varchar(100), issued_date timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_schema.stock_issue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issue_id uuid NOT NULL REFERENCES inventory_schema.stock_issues(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_schema.items(id), location_id uuid REFERENCES inventory_schema.warehouse_locations(id),
  lot_id uuid REFERENCES inventory_schema.inventory_lots(id), quantity numeric(14,4) NOT NULL CHECK (quantity > 0), unit_cost numeric(18,4) NOT NULL DEFAULT 0
);
CREATE TABLE inventory_schema.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), transfer_no varchar(50) NOT NULL UNIQUE,
  source_warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id), destination_warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id),
  status varchar(30) NOT NULL DEFAULT 'DRAFT', shipped_at timestamptz, received_at timestamptz, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_warehouse_id <> destination_warehouse_id)
);
CREATE TABLE inventory_schema.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), count_no varchar(50) NOT NULL UNIQUE,
  warehouse_id uuid NOT NULL REFERENCES inventory_schema.warehouses(id), status varchar(30) NOT NULL DEFAULT 'DRAFT',
  count_date date NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE inventory_schema.stock_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), count_id uuid NOT NULL REFERENCES inventory_schema.stock_counts(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_schema.items(id), location_id uuid REFERENCES inventory_schema.warehouse_locations(id),
  system_qty numeric(14,4) NOT NULL, actual_qty numeric(14,4) NOT NULL,
  variance_qty numeric(14,4) GENERATED ALWAYS AS (actual_qty-system_qty) STORED, reason text, adjusted boolean NOT NULL DEFAULT false
);

INSERT INTO inventory_schema.uoms (code,name,precision) VALUES ('EA','Cái',0),('SET','Bộ',0),('KG','Kilogram',3),('M','Mét',3) ON CONFLICT DO NOTHING;
