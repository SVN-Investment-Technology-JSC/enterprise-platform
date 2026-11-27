-- Xe và tài xế công ty: xóa mềm. Dòng đã xóa có deleted_at, không hiện trong danh mục và khi chọn xe;
-- dòng vẫn giữ lại để lịch xe cũ (fleet_bookings) còn tra được biển số, tên xe và tài xế.
-- Biển số và nhân viên chỉ phải duy nhất trong các dòng chưa xóa, để dùng lại sau khi xóa.
-- Chỉ thêm cột và đổi chỉ mục nên bản app cũ vẫn chạy được với schema mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.fleet_vehicles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE hrm_schema.fleet_drivers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DROP INDEX IF EXISTS hrm_schema.uq_hrm_fleet_vehicles_plate;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_fleet_vehicles_plate_live
  ON hrm_schema.fleet_vehicles (tenant_id, upper(plate_no)) WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS hrm_schema.uq_hrm_fleet_drivers_employee;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_fleet_drivers_employee_live
  ON hrm_schema.fleet_drivers (tenant_id, employee_id) WHERE deleted_at IS NULL;
