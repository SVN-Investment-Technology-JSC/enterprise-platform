-- 0005-consolidate-items-and-balances.sql
-- Tự động gộp các vật tư và số dư tồn kho trùng lặp trong từng nhà kho (đặc biệt sau khi xuất hết tồn về 0)

DO $dedup_items_and_balances$
DECLARE
  dup RECORD;
  main_item_id uuid;
  main_bal_id uuid;
BEGIN
  -- 1. Gom các item trùng mã (do nhập lại hoặc sai biệt hoa/thường/khoảng trắng) về 1 item duy nhất
  FOR dup IN 
    SELECT lower(trim(code)) as clean_code, count(*) 
    FROM inventory_schema.items 
    GROUP BY lower(trim(code)) 
    HAVING count(*) > 1
  LOOP
    SELECT id INTO main_item_id 
    FROM inventory_schema.items 
    WHERE lower(trim(code)) = dup.clean_code 
    ORDER BY created_at ASC 
    LIMIT 1;

    UPDATE inventory_schema.stock_balances 
    SET item_id = main_item_id 
    WHERE item_id IN (SELECT id FROM inventory_schema.items WHERE lower(trim(code)) = dup.clean_code AND id <> main_item_id);

    UPDATE inventory_schema.stock_transactions 
    SET item_id = main_item_id 
    WHERE item_id IN (SELECT id FROM inventory_schema.items WHERE lower(trim(code)) = dup.clean_code AND id <> main_item_id);

    UPDATE inventory_schema.stock_receipt_items 
    SET item_id = main_item_id 
    WHERE item_id IN (SELECT id FROM inventory_schema.items WHERE lower(trim(code)) = dup.clean_code AND id <> main_item_id);

    UPDATE inventory_schema.stock_issue_items 
    SET item_id = main_item_id 
    WHERE item_id IN (SELECT id FROM inventory_schema.items WHERE lower(trim(code)) = dup.clean_code AND id <> main_item_id);

    UPDATE inventory_schema.item_serials 
    SET item_id = main_item_id 
    WHERE item_id IN (SELECT id FROM inventory_schema.items WHERE lower(trim(code)) = dup.clean_code AND id <> main_item_id);

    DELETE FROM inventory_schema.items 
    WHERE lower(trim(code)) = dup.clean_code AND id <> main_item_id;
  END LOOP;

  -- 2. Gộp các dòng tồn kho stock_balances trùng (warehouse_id, item_id) về 1 dòng duy nhất
  FOR dup IN
    SELECT warehouse_id, item_id, count(*)
    FROM inventory_schema.stock_balances
    GROUP BY warehouse_id, item_id
    HAVING count(*) > 1
  LOOP
    SELECT id INTO main_bal_id
    FROM inventory_schema.stock_balances
    WHERE warehouse_id = dup.warehouse_id AND item_id = dup.item_id
    ORDER BY on_hand_qty DESC, updated_at DESC
    LIMIT 1;

    UPDATE inventory_schema.stock_balances
    SET on_hand_qty = (SELECT coalesce(sum(on_hand_qty), 0) FROM inventory_schema.stock_balances WHERE warehouse_id = dup.warehouse_id AND item_id = dup.item_id),
        reserved_qty = (SELECT coalesce(sum(reserved_qty), 0) FROM inventory_schema.stock_balances WHERE warehouse_id = dup.warehouse_id AND item_id = dup.item_id),
        quarantine_qty = (SELECT coalesce(sum(quarantine_qty), 0) FROM inventory_schema.stock_balances WHERE warehouse_id = dup.warehouse_id AND item_id = dup.item_id),
        damaged_qty = (SELECT coalesce(sum(damaged_qty), 0) FROM inventory_schema.stock_balances WHERE warehouse_id = dup.warehouse_id AND item_id = dup.item_id),
        updated_at = now()
    WHERE id = main_bal_id;

    DELETE FROM inventory_schema.stock_balances
    WHERE warehouse_id = dup.warehouse_id AND item_id = dup.item_id AND id <> main_bal_id;
  END LOOP;
END $dedup_items_and_balances$;
