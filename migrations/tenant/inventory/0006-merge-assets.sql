SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Gộp thiết bị và vật tư về MỘT bảng `inventory_schema.materials`.
--
-- Cách làm giữ nguyên mọi truy vấn hiện có: sau khi chuyển dữ liệu, bảng `assets`
-- được đổi tên thành `assets_legacy` và thay bằng một VIEW cùng tên đọc ngược ra
-- khỏi bảng gộp. Nhờ đó hợp đồng của các endpoint `internal/` — thứ mà Bảo trì
-- và Quy trình đang phụ thuộc — không đổi một chữ.
--
-- Bảng cũ được GIỮ LẠI một nhịp, drop ở migration riêng sau khi chạy ổn. Sổ cái
-- tồn kho là dữ liệu nghiệp vụ không dựng lại được, nên không xoá gì trong lượt
-- này.

-- 1. Chặn ngay nếu có mã trùng. Gộp hai bảng có mã trùng sẽ làm mất một trong
--    hai bản ghi, và không có cách nào biết bản nào đúng.
DO $$
DECLARE
  clashes text;
BEGIN
  SELECT string_agg(a.code, ', ') INTO clashes
    FROM inventory_schema.assets a
    JOIN inventory_schema.materials m ON m.code = a.code;
  IF clashes IS NOT NULL THEN
    RAISE EXCEPTION 'Không gộp được: các mã sau tồn tại ở cả thiết bị lẫn vật tư: %', clashes;
  END IF;
END $$;

-- 2. Bảng gộp nhận thêm các cột của thiết bị.
--    `kind` phân biệt hai loại; mặc định STOCK để mọi INSERT vật tư đang có
--    không phải sửa.
ALTER TABLE inventory_schema.materials
  ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'STOCK',
  ADD COLUMN IF NOT EXISTS parent_id uuid,
  ADD COLUMN IF NOT EXISTS type varchar(50),
  ADD COLUMN IF NOT EXISTS org_unit_id uuid,
  ADD COLUMN IF NOT EXISTS serial_number varchar(100),
  ADD COLUMN IF NOT EXISTS internal_code varchar(100),
  ADD COLUMN IF NOT EXISTS qr_code varchar(255),
  ADD COLUMN IF NOT EXISTS status varchar(50),
  ADD COLUMN IF NOT EXISTS criticality varchar(20),
  ADD COLUMN IF NOT EXISTS specs jsonb,
  ADD COLUMN IF NOT EXISTS task_template jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS purchase_price numeric(18,4),
  ADD COLUMN IF NOT EXISTS currency varchar(8),
  ADD COLUMN IF NOT EXISTS warranty_until date,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE inventory_schema.materials
  ADD CONSTRAINT materials_kind_check CHECK (kind IN ('STOCK', 'ASSET'));

-- 3. Nới ràng buộc của vật tư: thiết bị không có nhóm phân loại và có thể không
--    có đơn vị tính. Ràng buộc chỉ áp cho dòng STOCK.
ALTER TABLE inventory_schema.materials ALTER COLUMN category DROP NOT NULL;
ALTER TABLE inventory_schema.materials ALTER COLUMN unit DROP NOT NULL;
ALTER TABLE inventory_schema.materials DROP CONSTRAINT IF EXISTS materials_category_check;
ALTER TABLE inventory_schema.materials
  ADD CONSTRAINT materials_stock_requires_category
    CHECK (kind <> 'STOCK' OR (category IS NOT NULL AND unit IS NOT NULL));
ALTER TABLE inventory_schema.materials
  ADD CONSTRAINT materials_category_check
    CHECK (category IS NULL OR category IN ('SPARE_PART','CONSUMABLE','TOOL','ROTABLE'));

-- 4. Chuyển dữ liệu, GIỮ NGUYÊN id. Nhờ giữ id, sáu khoá ngoại chỉ cần trỏ sang
--    bảng mới chứ không phải ánh xạ lại giá trị.
INSERT INTO inventory_schema.materials
  (id, code, name, category, unit, min_stock, max_stock, is_serialized, barcode, is_active,
   kind, parent_id, type, org_unit_id, serial_number, internal_code, qr_code,
   status, criticality, specs, task_template, purchase_price, currency, warranty_until,
   created_at, updated_at)
SELECT a.id, a.code, a.name, NULL, a.unit, 0, 0, false, NULL,
       a.status <> 'DISPOSED',
       'ASSET', a.parent_id, a.type, a.org_unit_id, a.serial_number, a.internal_code, a.qr_code,
       a.status, a.criticality, a.specs, a.task_template, a.purchase_price, a.currency, a.warranty_until,
       a.created_at, a.updated_at
  FROM inventory_schema.assets a
 WHERE NOT EXISTS (SELECT 1 FROM inventory_schema.materials m WHERE m.id = a.id);

-- 5. Sáu khoá ngoại chuyển sang trỏ vào bảng gộp.
ALTER TABLE inventory_schema.asset_boms DROP CONSTRAINT IF EXISTS asset_boms_asset_id_fkey;
ALTER TABLE inventory_schema.asset_documents DROP CONSTRAINT IF EXISTS asset_documents_asset_id_fkey;
ALTER TABLE inventory_schema.asset_installations DROP CONSTRAINT IF EXISTS asset_installations_asset_id_fkey;
ALTER TABLE inventory_schema.asset_status_logs DROP CONSTRAINT IF EXISTS asset_status_logs_asset_id_fkey;
ALTER TABLE inventory_schema.serial_tracking DROP CONSTRAINT IF EXISTS serial_tracking_current_asset_id_fkey;
ALTER TABLE inventory_schema.assets DROP CONSTRAINT IF EXISTS assets_parent_id_fkey;

ALTER TABLE inventory_schema.asset_boms
  ADD CONSTRAINT asset_boms_asset_id_fkey FOREIGN KEY (asset_id)
  REFERENCES inventory_schema.materials(id) ON DELETE CASCADE;
ALTER TABLE inventory_schema.asset_documents
  ADD CONSTRAINT asset_documents_asset_id_fkey FOREIGN KEY (asset_id)
  REFERENCES inventory_schema.materials(id) ON DELETE CASCADE;
ALTER TABLE inventory_schema.asset_installations
  ADD CONSTRAINT asset_installations_asset_id_fkey FOREIGN KEY (asset_id)
  REFERENCES inventory_schema.materials(id) ON DELETE CASCADE;
ALTER TABLE inventory_schema.asset_status_logs
  ADD CONSTRAINT asset_status_logs_asset_id_fkey FOREIGN KEY (asset_id)
  REFERENCES inventory_schema.materials(id) ON DELETE CASCADE;
ALTER TABLE inventory_schema.serial_tracking
  ADD CONSTRAINT serial_tracking_current_asset_id_fkey FOREIGN KEY (current_asset_id)
  REFERENCES inventory_schema.materials(id);
ALTER TABLE inventory_schema.materials
  ADD CONSTRAINT materials_parent_id_fkey FOREIGN KEY (parent_id)
  REFERENCES inventory_schema.materials(id) ON DELETE CASCADE;

-- 6. Bảng cũ lui về tên legacy, VIEW cùng tên thay chỗ nó.
ALTER TABLE inventory_schema.assets RENAME TO assets_legacy;

CREATE OR REPLACE VIEW inventory_schema.assets AS
  SELECT id, code, internal_code, name, parent_id, type, org_unit_id, serial_number,
         status, criticality, specs, task_template, qr_code, unit,
         purchase_price, currency, warranty_until, kind, created_at, updated_at
    FROM inventory_schema.materials
   WHERE kind = 'ASSET'
  WITH CASCADED CHECK OPTION;

-- View một-bảng, không gộp nhóm nên Postgres tự cho INSERT/UPDATE/DELETE. Đặt
-- mặc định `kind` ở CHÍNH VIEW: INSERT qua view không nêu `kind` sẽ thành ASSET,
-- còn INSERT thẳng vào bảng vẫn nhận mặc định STOCK.
ALTER VIEW inventory_schema.assets ALTER COLUMN kind SET DEFAULT 'ASSET';

CREATE INDEX IF NOT EXISTS idx_materials_kind ON inventory_schema.materials (kind);
CREATE INDEX IF NOT EXISTS idx_materials_parent ON inventory_schema.materials (parent_id);
