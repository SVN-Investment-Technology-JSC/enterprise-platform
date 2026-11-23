-- Cách theo dõi của mặt hàng là cột thật: materials.tracking_mode (NONE, LOT, SERIAL).
--
-- Trước đây "theo lô" chỉ là suy ngược ở giao diện từ nhóm CONSUMABLE (material-form,
-- getTrackingMode) nên mọi vật tư tiêu hao tự thành theo lô và không có cách khai một
-- phụ tùng theo lô. Cột mới thay cách suy đó; nhóm không còn quyết định cách theo dõi.
-- Ba giá trị loại trừ nhau: một mặt hàng chỉ theo lô, hoặc chỉ theo serial, hoặc chỉ theo số lượng.
--
-- 1. Cột `tracking_mode` mặc định NONE, CHECK ba giá trị; dịch vụ chỉ được NONE.
-- 2. Backfill từ dữ liệu thật, KHÔNG suy từ `category`:
--      is_serialized  -> SERIAL
--      đã có lô       -> LOT
--      còn lại        -> NONE
--    Mặt hàng vừa is_serialized vừa có lô (xung đột với quy tắc loại trừ) lấy SERIAL và in
--    danh sách mã ở NOTICE; dòng lô cũ vẫn đọc được.
-- 3. Giữ `is_serialized` đồng bộ bằng trigger để bản app cũ (chỉ ghi is_serialized) và bản mới
--    (ghi cả hai) cùng đúng khi rollback image hoặc khi hai bản chạy song song lúc deploy.
-- 4. `material_tracking_history`: mỗi lần đổi cách theo dõi một dòng, chỉ ghi thêm.
-- 5. Tenant đã có dữ liệu lô hoặc serial thì tự bật công tắc tương ứng
--    (`tracking.lot.enabled`, `tracking.serial.enabled`) để không ai đột ngột mất chức năng.
--    Tenant chưa có dữ liệu giữ mặc định tắt (thiếu dòng nghĩa là dùng mặc định trong code).
--
-- Chạy lại được: mọi lệnh IF NOT EXISTS / DROP IF EXISTS / ON CONFLICT DO NOTHING, và backfill
-- chỉ chạm các dòng còn NONE.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS tracking_mode VARCHAR(10) NOT NULL DEFAULT 'NONE';

ALTER TABLE inventory_schema.materials
    DROP CONSTRAINT IF EXISTS materials_tracking_mode_check;
ALTER TABLE inventory_schema.materials
    ADD CONSTRAINT materials_tracking_mode_check
    CHECK (tracking_mode IN ('NONE', 'LOT', 'SERIAL'));

-- Báo các mặt hàng xung đột TRƯỚC khi backfill, khi cờ is_serialized và dòng lô còn nguyên.
DO $$
DECLARE
    conflict_codes TEXT;
BEGIN
    SELECT string_agg(m.code, ', ' ORDER BY m.code)
      INTO conflict_codes
      FROM inventory_schema.materials m
     WHERE m.kind <> 'SERVICE'
       AND m.tracking_mode = 'NONE'
       AND m.is_serialized
       AND EXISTS (SELECT 1 FROM inventory_schema.lots l WHERE l.material_id = m.id);
    IF conflict_codes IS NOT NULL THEN
        RAISE NOTICE '0028: mặt hàng vừa theo serial vừa có lô, đặt SERIAL (lô cũ vẫn đọc được): %', conflict_codes;
    END IF;
END;
$$;

UPDATE inventory_schema.materials
   SET tracking_mode = 'SERIAL'
 WHERE tracking_mode = 'NONE'
   AND kind <> 'SERVICE'
   AND is_serialized;

UPDATE inventory_schema.materials m
   SET tracking_mode = 'LOT'
 WHERE m.tracking_mode = 'NONE'
   AND m.kind <> 'SERVICE'
   AND EXISTS (SELECT 1 FROM inventory_schema.lots l WHERE l.material_id = m.id);

-- Dịch vụ không theo dõi lô hay serial. Đặt sau backfill: dịch vụ cũ lọt is_serialized = true
-- (đường cập nhật trước đây không ép) vẫn ở NONE nên qua được ràng buộc.
ALTER TABLE inventory_schema.materials
    DROP CONSTRAINT IF EXISTS materials_service_no_tracking;
ALTER TABLE inventory_schema.materials
    ADD CONSTRAINT materials_service_no_tracking
    CHECK (kind <> 'SERVICE' OR tracking_mode = 'NONE');

-- Đồng bộ hai cột. Quy tắc:
--   INSERT: ghi is_serialized = true mà để NONE (bản cũ) thì thành SERIAL; ngược lại is_serialized
--           theo tracking_mode.
--   UPDATE đổi tracking_mode (bản mới): is_serialized theo tracking_mode.
--   UPDATE chỉ đổi is_serialized (bản cũ): true thì SERIAL; false thì SERIAL về NONE, LOT giữ nguyên.
CREATE OR REPLACE FUNCTION inventory_schema.sync_material_tracking_mode()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.tracking_mode = 'NONE' AND NEW.is_serialized AND NEW.kind <> 'SERVICE' THEN
            NEW.tracking_mode := 'SERIAL';
        END IF;
        NEW.is_serialized := (NEW.tracking_mode = 'SERIAL');
    ELSIF NEW.tracking_mode IS DISTINCT FROM OLD.tracking_mode THEN
        NEW.is_serialized := (NEW.tracking_mode = 'SERIAL');
    ELSIF NEW.is_serialized IS DISTINCT FROM OLD.is_serialized THEN
        IF NEW.is_serialized AND NEW.kind <> 'SERVICE' THEN
            NEW.tracking_mode := 'SERIAL';
        ELSIF NOT NEW.is_serialized AND OLD.tracking_mode = 'SERIAL' THEN
            NEW.tracking_mode := 'NONE';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS materials_sync_tracking_mode ON inventory_schema.materials;
CREATE TRIGGER materials_sync_tracking_mode
    BEFORE INSERT OR UPDATE ON inventory_schema.materials
    FOR EACH ROW EXECUTE FUNCTION inventory_schema.sync_material_tracking_mode();

CREATE TABLE IF NOT EXISTS inventory_schema.material_tracking_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    from_mode VARCHAR(10) NOT NULL CHECK (from_mode IN ('NONE', 'LOT', 'SERIAL')),
    to_mode VARCHAR(10) NOT NULL CHECK (to_mode IN ('NONE', 'LOT', 'SERIAL')),
    reason TEXT,
    changed_by UUID,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_tracking_history_material
    ON inventory_schema.material_tracking_history(material_id, changed_at);

-- Tenant đã dùng thì tự bật. `module_settings` không seed dòng nào (0003): thiếu dòng là mặc định
-- trong code (tắt), nên chỉ thêm dòng khi có dữ liệu thật và không đè dòng admin đã đặt.
INSERT INTO inventory_schema.module_settings (key, value)
SELECT 'tracking.serial.enabled', '{"enabled": true}'::jsonb
 WHERE EXISTS (SELECT 1 FROM inventory_schema.serial_tracking)
    OR EXISTS (SELECT 1 FROM inventory_schema.materials WHERE tracking_mode = 'SERIAL')
ON CONFLICT (key) DO NOTHING;

INSERT INTO inventory_schema.module_settings (key, value)
SELECT 'tracking.lot.enabled', '{"enabled": true}'::jsonb
 WHERE EXISTS (SELECT 1 FROM inventory_schema.lots)
    OR EXISTS (SELECT 1 FROM inventory_schema.materials WHERE tracking_mode = 'LOT')
ON CONFLICT (key) DO NOTHING;
