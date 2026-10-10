-- Danh mục Loại OT chỉ còn khai báo loại (mã, tên, trạng thái); bỏ hệ số lương.
-- Đơn OT đã tạo giữ nguyên ot_rate_multiplier đã chụp.
ALTER TABLE hrm_schema.request_reasons DROP CONSTRAINT IF EXISTS request_reasons_rate_multiplier_check;
ALTER TABLE hrm_schema.request_reasons DROP COLUMN IF EXISTS rate_multiplier;
UPDATE hrm_schema.request_reason_categories
   SET name = 'Loại OT', updated_at = now()
 WHERE upper(code) = 'OT_TYPE' AND name = 'Loại OT (hệ số lương)';
