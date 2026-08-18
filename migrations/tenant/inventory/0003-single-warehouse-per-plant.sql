-- 0003-single-warehouse-per-plant.sql
-- Chuẩn hóa dữ liệu: Chỉ duy trì đúng 3 nhà kho tương ứng 3 nhà máy hiện tại (Thủy điện, Điện mặt trời, Điện gió)
-- Chuyển toàn bộ vật tư, vị trí, giao dịch từ các kho phụ bị xóa về 3 kho chính tương ứng.

ALTER TABLE inventory_schema.warehouses ADD COLUMN IF NOT EXISTS plant_code varchar(50);
ALTER TABLE inventory_schema.warehouses ADD COLUMN IF NOT EXISTS warehouse_type varchar(50);

ALTER TABLE inventory_schema.stock_issues ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE inventory_schema.stock_issues ADD COLUMN IF NOT EXISTS to_location text;
ALTER TABLE inventory_schema.stock_receipts ADD COLUMN IF NOT EXISTS source_origin text;
ALTER TABLE inventory_schema.stock_transactions ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE inventory_schema.stock_transactions ADD COLUMN IF NOT EXISTS source_origin text;


DO $consolidate_to_3_warehouses$
DECLARE
  v_hpp_id uuid;
  v_spp_id uuid;
  v_wpp_id uuid;
  r RECORD;
  v_target_id uuid;
  bal RECORD;
  v_exist_bal_id uuid;
BEGIN
  -- 1. Xác định hoặc tạo 3 KHO CHÍNH DUY NHẤT CHO 3 NHÀ MÁY
  -- 1.1 Thủy điện (HPP-01)
  SELECT id INTO v_hpp_id FROM inventory_schema.warehouses WHERE code IN ('WH-HPP-CENTRAL', 'WH_HPP_MAIN', 'WH_HPP') ORDER BY (code = 'WH-HPP-CENTRAL') DESC LIMIT 1;
  IF v_hpp_id IS NULL THEN
    v_hpp_id := gen_random_uuid();
    INSERT INTO inventory_schema.warehouses (id, code, name, type, address, plant_code, warehouse_type, is_active)
    VALUES (v_hpp_id, 'WH-HPP-CENTRAL', 'Tổng kho Nhà máy Thủy điện Minh Long', 'PHYSICAL', 'Khu kỹ thuật trung tâm - Nhà máy Thủy điện Minh Long', 'HPP-01', 'CENTRAL', true);
  ELSE
    UPDATE inventory_schema.warehouses
    SET code = 'WH-HPP-CENTRAL', name = 'Tổng kho Nhà máy Thủy điện Minh Long', plant_code = 'HPP-01', warehouse_type = 'CENTRAL', is_active = true
    WHERE id = v_hpp_id;
  END IF;

  -- 1.2 Điện mặt trời (SPP-01)
  SELECT id INTO v_spp_id FROM inventory_schema.warehouses WHERE code IN ('WH-SPP-CENTRAL', 'WH_SPP_MAIN', 'WH_SPP') ORDER BY (code = 'WH-SPP-CENTRAL') DESC LIMIT 1;
  IF v_spp_id IS NULL THEN
    v_spp_id := gen_random_uuid();
    INSERT INTO inventory_schema.warehouses (id, code, name, type, address, plant_code, warehouse_type, is_active)
    VALUES (v_spp_id, 'WH-SPP-CENTRAL', 'Tổng kho Nhà máy Điện mặt trời Minh Long', 'PHYSICAL', 'Khu dịch vụ kỹ thuật O&M Solar Minh Long', 'SPP-01', 'CENTRAL', true);
  ELSE
    UPDATE inventory_schema.warehouses
    SET code = 'WH-SPP-CENTRAL', name = 'Tổng kho Nhà máy Điện mặt trời Minh Long', plant_code = 'SPP-01', warehouse_type = 'CENTRAL', is_active = true
    WHERE id = v_spp_id;
  END IF;

  -- 1.3 Điện gió (WPP-01)
  SELECT id INTO v_wpp_id FROM inventory_schema.warehouses WHERE code IN ('WH-WPP-CENTRAL', 'WH_WPP_MAIN', 'WH_WPP') ORDER BY (code = 'WH-WPP-CENTRAL') DESC LIMIT 1;
  IF v_wpp_id IS NULL THEN
    v_wpp_id := gen_random_uuid();
    INSERT INTO inventory_schema.warehouses (id, code, name, type, address, plant_code, warehouse_type, is_active)
    VALUES (v_wpp_id, 'WH-WPP-CENTRAL', 'Tổng kho Nhà máy Điện gió Minh Long', 'PHYSICAL', 'Trung tâm Hậu cần & Vật tư Điện gió Minh Long', 'WPP-01', 'CENTRAL', true);
  ELSE
    UPDATE inventory_schema.warehouses
    SET code = 'WH-WPP-CENTRAL', name = 'Tổng kho Nhà máy Điện gió Minh Long', plant_code = 'WPP-01', warehouse_type = 'CENTRAL', is_active = true
    WHERE id = v_wpp_id;
  END IF;

  -- Đảm bảo 3 kho chính cũng tồn tại trong amm_warehouses nếu AMM schema có mặt
  IF to_regclass('amm_schema.amm_warehouses') IS NOT NULL THEN
    INSERT INTO amm_schema.amm_warehouses (id, code, name, type, location, plant_code, warehouse_type, is_active)
    VALUES
      (v_hpp_id, 'WH-HPP-CENTRAL', 'Tổng kho Nhà máy Thủy điện Minh Long', 'PHYSICAL', 'Khu kỹ thuật trung tâm - Nhà máy Thủy điện Minh Long', 'HPP-01', 'CENTRAL', true),
      (v_spp_id, 'WH-SPP-CENTRAL', 'Tổng kho Nhà máy Điện mặt trời Minh Long', 'PHYSICAL', 'Khu dịch vụ kỹ thuật O&M Solar Minh Long', 'SPP-01', 'CENTRAL', true),
      (v_wpp_id, 'WH-WPP-CENTRAL', 'Tổng kho Nhà máy Điện gió Minh Long', 'PHYSICAL', 'Trung tâm Hậu cần & Vật tư Điện gió Minh Long', 'WPP-01', 'CENTRAL', true)
    ON CONFLICT (id) DO UPDATE SET code=excluded.code, name=excluded.name, plant_code=excluded.plant_code, warehouse_type=excluded.warehouse_type;
  END IF;

  -- 2. DUYỆT QUA TẤT CẢ CÁC NHÀ KHO DƯ THỪA ĐỂ CHUYỂN TOÀN BỘ DỮ LIỆU & VẬT TƯ VỀ 3 KHO CHÍNH
  FOR r IN SELECT * FROM inventory_schema.warehouses WHERE id NOT IN (v_hpp_id, v_spp_id, v_wpp_id) LOOP
    IF r.code LIKE '%HPP%' OR coalesce(r.plant_code, '') LIKE '%HPP%' THEN
      v_target_id := v_hpp_id;
    ELSIF r.code LIKE '%SPP%' OR coalesce(r.plant_code, '') LIKE '%SPP%' THEN
      v_target_id := v_spp_id;
    ELSIF r.code LIKE '%WPP%' OR coalesce(r.plant_code, '') LIKE '%WPP%' THEN
      v_target_id := v_wpp_id;
    ELSE
      -- Kho ảo hoặc kho khác -> gom về HPP
      v_target_id := v_hpp_id;
    END IF;

    -- 2.1 Chuyển vị trí kho (locations)
    UPDATE inventory_schema.warehouse_locations
    SET warehouse_id = v_target_id
    WHERE warehouse_id = r.id;

    -- 2.2 Chuyển và gộp tồn kho (stock_balances)
    FOR bal IN SELECT * FROM inventory_schema.stock_balances WHERE warehouse_id = r.id LOOP
      SELECT id INTO v_exist_bal_id FROM inventory_schema.stock_balances
      WHERE warehouse_id = v_target_id AND item_id = bal.item_id
        AND location_id IS NOT DISTINCT FROM bal.location_id
        AND lot_id IS NOT DISTINCT FROM bal.lot_id
      LIMIT 1;

      IF v_exist_bal_id IS NOT NULL THEN
        UPDATE inventory_schema.stock_balances
        SET on_hand_qty = on_hand_qty + bal.on_hand_qty,
            reserved_qty = reserved_qty + bal.reserved_qty,
            quarantine_qty = quarantine_qty + bal.quarantine_qty,
            damaged_qty = damaged_qty + bal.damaged_qty,
            updated_at = now()
        WHERE id = v_exist_bal_id;

        DELETE FROM inventory_schema.stock_balances WHERE id = bal.id;
      ELSE
        UPDATE inventory_schema.stock_balances
        SET warehouse_id = v_target_id, updated_at = now()
        WHERE id = bal.id;
      END IF;
    END LOOP;

    -- 2.3 Chuyển serials
    UPDATE inventory_schema.item_serials
    SET warehouse_id = v_target_id
    WHERE warehouse_id = r.id;

    -- 2.4 Chuyển lịch sử giao dịch (transactions)
    UPDATE inventory_schema.stock_transactions
    SET warehouse_id = v_target_id
    WHERE warehouse_id = r.id;

    -- 2.5 Chuyển phiếu nhập (receipts)
    UPDATE inventory_schema.stock_receipts
    SET warehouse_id = v_target_id
    WHERE warehouse_id = r.id;

    -- 2.6 Chuyển phiếu xuất (issues)
    UPDATE inventory_schema.stock_issues
    SET warehouse_id = v_target_id
    WHERE warehouse_id = r.id;

    -- 2.7 Chuyển kiểm kê (counts)
    UPDATE inventory_schema.stock_counts
    SET warehouse_id = v_target_id
    WHERE warehouse_id = r.id;

    -- 2.8 Chuyển điều chuyển (transfers)
    UPDATE inventory_schema.stock_transfers
    SET source_warehouse_id = v_target_id
    WHERE source_warehouse_id = r.id;

    UPDATE inventory_schema.stock_transfers
    SET destination_warehouse_id = v_target_id
    WHERE destination_warehouse_id = r.id;

    DELETE FROM inventory_schema.stock_transfers WHERE source_warehouse_id = destination_warehouse_id;

    -- 2.9 Bảng AMM nếu có
    IF to_regclass('amm_schema.amm_warehouse_locations') IS NOT NULL THEN
      UPDATE amm_schema.amm_warehouse_locations SET warehouse_id = v_target_id WHERE warehouse_id = r.id;
    END IF;
    IF to_regclass('amm_schema.amm_reservation_items') IS NOT NULL THEN
      UPDATE amm_schema.amm_reservation_items SET warehouse_id = v_target_id WHERE warehouse_id = r.id;
    END IF;
    IF to_regclass('amm_schema.amm_material_inventory') IS NOT NULL THEN
      -- Cập nhật hoặc xóa tồn trùng lặp trong AMM
      UPDATE amm_schema.amm_material_inventory SET warehouse_id = v_target_id WHERE warehouse_id = r.id;
    END IF;
    IF to_regclass('amm_schema.amm_serial_tracking') IS NOT NULL THEN
      UPDATE amm_schema.amm_serial_tracking SET current_warehouse_id = v_target_id WHERE current_warehouse_id = r.id;
    END IF;
    IF to_regclass('amm_schema.amm_inventory_transactions') IS NOT NULL THEN
      UPDATE amm_schema.amm_inventory_transactions SET warehouse_id = v_target_id WHERE warehouse_id = r.id;
    END IF;

    -- 2.10 Xóa nhà kho dư thừa
    DELETE FROM inventory_schema.warehouses WHERE id = r.id;
    IF to_regclass('amm_schema.amm_warehouses') IS NOT NULL THEN
      DELETE FROM amm_schema.amm_warehouses WHERE id = r.id;
    END IF;
  END LOOP;

  -- 3. Cập nhật và dọn dẹp bảng AMM để chỉ còn đúng 3 kho
  IF to_regclass('amm_schema.amm_warehouses') IS NOT NULL THEN
    IF to_regclass('amm_schema.amm_reservation_items') IS NOT NULL THEN
      UPDATE amm_schema.amm_reservation_items SET warehouse_id = v_hpp_id WHERE warehouse_id NOT IN (v_hpp_id, v_spp_id, v_wpp_id);
    END IF;
    IF to_regclass('amm_schema.amm_material_inventory') IS NOT NULL THEN
      UPDATE amm_schema.amm_material_inventory SET warehouse_id = v_hpp_id WHERE warehouse_id NOT IN (v_hpp_id, v_spp_id, v_wpp_id);
    END IF;
    IF to_regclass('amm_schema.amm_serial_tracking') IS NOT NULL THEN
      UPDATE amm_schema.amm_serial_tracking SET current_warehouse_id = v_hpp_id WHERE current_warehouse_id NOT IN (v_hpp_id, v_spp_id, v_wpp_id);
    END IF;
    IF to_regclass('amm_schema.amm_inventory_transactions') IS NOT NULL THEN
      UPDATE amm_schema.amm_inventory_transactions SET warehouse_id = v_hpp_id WHERE warehouse_id NOT IN (v_hpp_id, v_spp_id, v_wpp_id);
    END IF;
    IF to_regclass('amm_schema.amm_warehouse_locations') IS NOT NULL THEN
      UPDATE amm_schema.amm_warehouse_locations SET warehouse_id = v_hpp_id WHERE warehouse_id NOT IN (v_hpp_id, v_spp_id, v_wpp_id);
    END IF;

    DELETE FROM amm_schema.amm_warehouses WHERE id NOT IN (v_hpp_id, v_spp_id, v_wpp_id);
  END IF;

  DELETE FROM inventory_schema.warehouses WHERE id NOT IN (v_hpp_id, v_spp_id, v_wpp_id);

END
$consolidate_to_3_warehouses$;
