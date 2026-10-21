SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Mở rộng ràng buộc kiểm tra nguồn chấm công của attendances để chấp nhận nguồn 'AUTO' (chấm công tự động).
ALTER TABLE hrm_schema.attendances
  DROP CONSTRAINT IF EXISTS attendances_attendance_source_check,
  ADD CONSTRAINT attendances_attendance_source_check
    CHECK (attendance_source IN ('BIOMETRIC_DEVICE', 'MOBILE_GPS', 'WEB_PORTAL', 'MANUAL_CORRECTION', 'AUTO'));
