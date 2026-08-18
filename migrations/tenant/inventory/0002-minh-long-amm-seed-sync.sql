ALTER TABLE inventory_schema.warehouses ADD COLUMN IF NOT EXISTS plant_code varchar(50);
ALTER TABLE inventory_schema.warehouses ADD COLUMN IF NOT EXISTS warehouse_type varchar(50);

DO $sync$
BEGIN
  IF to_regclass('amm_schema.amm_warehouses') IS NULL THEN RETURN; END IF;

  INSERT INTO inventory_schema.uoms (id, code, name, precision)
  SELECT gen_random_uuid(), 'AMM-' || left(md5(unit), 12), unit, 3
  FROM (SELECT DISTINCT unit FROM amm_schema.amm_materials) source
  ON CONFLICT (code) DO UPDATE SET name = excluded.name;

  INSERT INTO inventory_schema.warehouses
    (id, code, name, type, address, manager_user_id, is_active, created_at, updated_at, plant_code, warehouse_type)
  SELECT id, code, name, type, location, manager_user_id, is_active, created_at, updated_at, plant_code, warehouse_type
  FROM amm_schema.amm_warehouses
  ON CONFLICT (id) DO UPDATE SET code=excluded.code, name=excluded.name, type=excluded.type,
    address=excluded.address, manager_user_id=excluded.manager_user_id, is_active=excluded.is_active,
    plant_code=excluded.plant_code, warehouse_type=excluded.warehouse_type, updated_at=excluded.updated_at;

  INSERT INTO inventory_schema.warehouse_locations
    (id, warehouse_id, parent_id, code, name, type, qr_code, is_active)
  SELECT id, warehouse_id, parent_id, code, name, location_type, qr_code, true
  FROM amm_schema.amm_warehouse_locations
  ON CONFLICT (id) DO UPDATE SET parent_id=excluded.parent_id, code=excluded.code,
    name=excluded.name, type=excluded.type, qr_code=excluded.qr_code;

  INSERT INTO inventory_schema.items
    (id, code, name, uom_id, description, barcode, tracking_type, costing_method,
     min_stock, max_stock, is_active, created_at, updated_at)
  SELECT m.id, m.code, m.name, u.id,
    concat_ws(' · ', m.category, m.manufacturer, m.part_number_oem), m.barcode,
    CASE WHEN m.is_serialized THEN 'SERIAL' ELSE 'NONE' END, 'FIFO',
    m.min_stock, m.max_stock, m.is_active, m.created_at, m.updated_at
  FROM amm_schema.amm_materials m
  JOIN inventory_schema.uoms u ON u.code = 'AMM-' || left(md5(m.unit), 12)
  ON CONFLICT (id) DO UPDATE SET code=excluded.code, name=excluded.name, uom_id=excluded.uom_id,
    description=excluded.description, barcode=excluded.barcode, tracking_type=excluded.tracking_type,
    min_stock=excluded.min_stock, max_stock=excluded.max_stock, is_active=excluded.is_active,
    updated_at=excluded.updated_at;

  INSERT INTO inventory_schema.stock_balances
    (id, warehouse_id, location_id, item_id, on_hand_qty, reserved_qty,
     quarantine_qty, damaged_qty, updated_at)
  SELECT id, warehouse_id, location_id, material_id, quantity, quantity_reserved,
    quarantine_qty, damaged_qty, updated_at
  FROM amm_schema.amm_material_inventory
  ON CONFLICT (id) DO UPDATE SET on_hand_qty=excluded.on_hand_qty, reserved_qty=excluded.reserved_qty,
    quarantine_qty=excluded.quarantine_qty, damaged_qty=excluded.damaged_qty, updated_at=excluded.updated_at;

  INSERT INTO inventory_schema.stock_transactions
    (id, transaction_code, transaction_date, transaction_type, item_id, warehouse_id,
     location_id, qty_change, balance_before, balance_after, unit_cost,
     reference_type, reference_id, performed_by, notes)
  SELECT id, transaction_code, created_at,
    CASE type WHEN 'IMPORT' THEN 'RECEIPT' WHEN 'EXPORT' THEN 'ISSUE' ELSE type END,
    material_id, warehouse_id, location_id, quantity, balance_before, balance_after,
    unit_cost, coalesce(reference_type, 'AMM_SEED'), coalesce(reference_id, transaction_code), created_by, note
  FROM amm_schema.amm_inventory_transactions
  ON CONFLICT (id) DO UPDATE SET transaction_date=excluded.transaction_date,
    transaction_type=excluded.transaction_type, qty_change=excluded.qty_change,
    balance_before=excluded.balance_before, balance_after=excluded.balance_after,
    unit_cost=excluded.unit_cost, notes=excluded.notes;
END
$sync$;
