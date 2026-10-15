SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Lịch xe công ty. Người tạo đơn tự chọn xe và tài xế còn trống; lịch giữ chỗ (PENDING) khi đơn
-- gốc chưa duyệt, tự xác nhận (CONFIRMED) khi đơn gốc duyệt và tự giải phóng (CANCELLED) khi đơn
-- bị từ chối, huỷ hoặc huỷ hiệu lực. Chống trùng lịch ở tầng ứng dụng (khoá dòng xe/tài xế).
CREATE TABLE IF NOT EXISTS hrm_schema.fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plate_no varchar(30) NOT NULL,
  name varchar(255) NOT NULL,
  seats integer NOT NULL DEFAULT 4 CHECK (seats > 0),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_fleet_vehicles_plate
  ON hrm_schema.fleet_vehicles (tenant_id, upper(plate_no));

CREATE TABLE IF NOT EXISTS hrm_schema.fleet_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  license_no varchar(50),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_fleet_drivers_employee
  ON hrm_schema.fleet_drivers (tenant_id, employee_id);

-- source_type: BUSINESS_TRIP / CUSTOM_REQUEST / WORK_ITEM / CALENDAR_EVENT / INCIDENT.
-- Mỗi nguồn có tối đa một lịch chưa huỷ.
CREATE TABLE IF NOT EXISTS hrm_schema.fleet_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES hrm_schema.fleet_vehicles (id),
  driver_id uuid NOT NULL REFERENCES hrm_schema.fleet_drivers (id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  destination varchar(255),
  purpose text,
  requester_employee_id uuid,
  source_module varchar(20) NOT NULL CHECK (source_module IN ('HRM', 'WORKSPACE', 'MAINTENANCE')),
  source_type varchar(30) NOT NULL
    CHECK (source_type IN ('BUSINESS_TRIP', 'CUSTOM_REQUEST', 'WORK_ITEM', 'CALENDAR_EVENT', 'INCIDENT')),
  source_id uuid NOT NULL,
  source_label varchar(255),
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_bookings_time_range CHECK (end_at > start_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_fleet_bookings_source
  ON hrm_schema.fleet_bookings (tenant_id, source_type, source_id) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_hrm_fleet_bookings_vehicle
  ON hrm_schema.fleet_bookings (tenant_id, vehicle_id, start_at) WHERE status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS idx_hrm_fleet_bookings_driver
  ON hrm_schema.fleet_bookings (tenant_id, driver_id, start_at) WHERE status <> 'CANCELLED';

-- Phương tiện di chuyển ghi trên đơn: COMPANY_VEHICLE (có lịch xe) hoặc EXTERNAL (tự sắp xếp).
ALTER TABLE hrm_schema.business_trip_requests
  ADD COLUMN IF NOT EXISTS transport_mode varchar(20)
    CHECK (transport_mode IS NULL OR transport_mode IN ('COMPANY_VEHICLE', 'EXTERNAL')),
  ADD COLUMN IF NOT EXISTS transport_detail varchar(100);
ALTER TABLE hrm_schema.custom_requests
  ADD COLUMN IF NOT EXISTS transport_mode varchar(20)
    CHECK (transport_mode IS NULL OR transport_mode IN ('COMPANY_VEHICLE', 'EXTERNAL')),
  ADD COLUMN IF NOT EXISTS transport_detail varchar(100);
ALTER TABLE hrm_schema.request_reason_categories
  ADD COLUMN IF NOT EXISTS requires_transport boolean NOT NULL DEFAULT false;

-- Đơn đổi trạng thái ở bất kỳ đường nào (duyệt DIRECT, kết quả quy trình, từ chối, rút, huỷ hiệu lực)
-- thì lịch xe của đơn đi theo.
CREATE OR REPLACE FUNCTION hrm_schema.sync_fleet_booking_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'APPROVED' THEN
    UPDATE hrm_schema.fleet_bookings SET status = 'CONFIRMED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND source_type = TG_ARGV[0] AND source_id = NEW.id AND status = 'PENDING';
  ELSIF NEW.status IN ('REJECTED', 'CANCELLED') THEN
    UPDATE hrm_schema.fleet_bookings SET status = 'CANCELLED', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND source_type = TG_ARGV[0] AND source_id = NEW.id AND status <> 'CANCELLED';
  ELSIF NEW.status = 'PENDING' THEN
    -- Đơn mở lại (huỷ hiệu lực về chờ duyệt): lịch đã xác nhận quay về giữ chỗ.
    UPDATE hrm_schema.fleet_bookings SET status = 'PENDING', updated_at = now()
     WHERE tenant_id = NEW.tenant_id AND source_type = TG_ARGV[0] AND source_id = NEW.id AND status = 'CONFIRMED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fleet_booking_status ON hrm_schema.business_trip_requests;
CREATE TRIGGER trg_fleet_booking_status AFTER UPDATE OF status ON hrm_schema.business_trip_requests
  FOR EACH ROW EXECUTE FUNCTION hrm_schema.sync_fleet_booking_status('BUSINESS_TRIP');
DROP TRIGGER IF EXISTS trg_fleet_booking_status ON hrm_schema.custom_requests;
CREATE TRIGGER trg_fleet_booking_status AFTER UPDATE OF status ON hrm_schema.custom_requests
  FOR EACH ROW EXECUTE FUNCTION hrm_schema.sync_fleet_booking_status('CUSTOM_REQUEST');
