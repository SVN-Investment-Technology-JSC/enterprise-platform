SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Phương tiện di chuyển của phiếu sự cố (kỹ thuật viên đi hiện trường). Lịch xe nằm ở HRM: Maintenance chỉ
-- giữ lựa chọn của người dùng và trạng thái đặt xe do HRM trả lời qua sự kiện
-- (REQUESTED -> CONFIRMED hoặc CONFLICT). EXTERNAL là phương tiện tự sắp xếp, không đặt xe.
CREATE TABLE IF NOT EXISTS maintenance_schema.fleet_transports (
  source_type varchar(30) NOT NULL CHECK (source_type IN ('INCIDENT')),
  source_id uuid NOT NULL,
  mode varchar(20) NOT NULL CHECK (mode IN ('COMPANY_VEHICLE', 'EXTERNAL')),
  detail varchar(100),
  vehicle_id uuid,
  driver_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  destination varchar(255),
  source_label varchar(255),
  requester_user_id uuid,
  status varchar(20) NOT NULL DEFAULT 'NONE' CHECK (status IN ('NONE', 'REQUESTED', 'CONFIRMED', 'CONFLICT')),
  status_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_type, source_id),
  CONSTRAINT fleet_transports_company_vehicle CHECK (
    mode = 'EXTERNAL'
    OR (vehicle_id IS NOT NULL AND driver_id IS NOT NULL AND start_at IS NOT NULL AND end_at > start_at)
  )
);
