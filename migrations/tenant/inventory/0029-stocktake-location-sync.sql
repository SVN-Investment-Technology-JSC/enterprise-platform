-- Migration 0029: stocktake-location-sync
-- Thêm cột lưu vị trí gốc lúc chụp đợt kiểm kê và nới rộng cột bin_location lên 255 ký tự để khớp với material_storage_locations.location_text.

ALTER TABLE inventory_schema.stocktake_lines
  ALTER COLUMN bin_location TYPE VARCHAR(255);

ALTER TABLE inventory_schema.stocktake_lines
  ADD COLUMN IF NOT EXISTS bin_location_original VARCHAR(255);
