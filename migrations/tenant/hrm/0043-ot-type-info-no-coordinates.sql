-- Loại OT chỉ là trường thông tin do người dùng chọn từ danh mục (6 mã), không còn giới hạn 4 giá trị cố định.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'hrm_schema.ot_requests'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%ot_type%'
  LOOP
    EXECUTE format('ALTER TABLE hrm_schema.ot_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
-- Bỏ tọa độ địa điểm công tác (không dùng).
ALTER TABLE hrm_schema.business_trip_requests DROP COLUMN IF EXISTS destination_lat;
ALTER TABLE hrm_schema.business_trip_requests DROP COLUMN IF EXISTS destination_lng;
