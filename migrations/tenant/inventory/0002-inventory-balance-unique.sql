SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- material_inventory rows are keyed by (warehouse, location, material), but
-- location_id is nullable and a plain UNIQUE treats NULLs as distinct. That made
-- ON CONFLICT never fire for warehouse-level stock, so every ledger entry inserted
-- a fresh balance row instead of moving the existing one — silently splitting the
-- on-hand quantity across rows.

-- 1. Fold any rows that were already split back into a single balance.
WITH merged AS (
    SELECT warehouse_id,
           location_id,
           material_id,
           SUM(quantity) AS quantity,
           SUM(quantity_reserved) AS quantity_reserved,
           (array_agg(id ORDER BY id))[1] AS keep_id
      FROM inventory_schema.material_inventory
     GROUP BY warehouse_id, location_id, material_id
    HAVING COUNT(*) > 1
)
UPDATE inventory_schema.material_inventory mi
   SET quantity = merged.quantity,
       quantity_reserved = merged.quantity_reserved,
       updated_at = now()
  FROM merged
 WHERE mi.id = merged.keep_id;

DELETE FROM inventory_schema.material_inventory mi
 USING (
    SELECT warehouse_id, location_id, material_id, (array_agg(id ORDER BY id))[1] AS keep_id
      FROM inventory_schema.material_inventory
     GROUP BY warehouse_id, location_id, material_id
    HAVING COUNT(*) > 1
 ) dup
 WHERE mi.warehouse_id = dup.warehouse_id
   AND mi.material_id = dup.material_id
   AND mi.location_id IS NOT DISTINCT FROM dup.location_id
   AND mi.id <> dup.keep_id;

-- 2. Re-key so NULL location compares equal (Postgres 15+).
ALTER TABLE inventory_schema.material_inventory
    DROP CONSTRAINT IF EXISTS material_inventory_warehouse_id_location_id_material_id_key;

ALTER TABLE inventory_schema.material_inventory
    ADD CONSTRAINT material_inventory_warehouse_location_material_key
    UNIQUE NULLS NOT DISTINCT (warehouse_id, location_id, material_id);
