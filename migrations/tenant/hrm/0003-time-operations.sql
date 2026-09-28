SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.shift_definitions
  ADD COLUMN IF NOT EXISTS break_start_time time,
  ADD COLUMN IF NOT EXISTS break_end_time time,
  ADD COLUMN IF NOT EXISTS check_in_before_minutes integer NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS check_out_after_minutes integer NOT NULL DEFAULT 240;

CREATE TABLE IF NOT EXISTS hrm_schema.attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  event_kind varchar(3) NOT NULL CHECK (event_kind IN ('IN','OUT')),
  occurred_at timestamptz NOT NULL,
  source varchar(50) NOT NULL,
  external_event_id varchar(180) NOT NULL,
  device_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_by uuid,
  voided_by_correction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, external_event_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS hrm_event_employee_date ON hrm_schema.attendance_events(tenant_id, employee_id, work_date, occurred_at);

ALTER TABLE hrm_schema.attendance_corrections ADD COLUMN IF NOT EXISTS corrected_sessions jsonb;

-- Existing summaries remain readable. Mark converted events to retain provenance.
INSERT INTO hrm_schema.attendance_events (tenant_id,employee_id,work_date,event_kind,occurred_at,source,external_event_id,evidence)
SELECT a.tenant_id,a.employee_id,a.work_date,p.kind,p.at,'LEGACY',a.id::text || ':' || p.kind,'{"migratedSummary":true}'::jsonb
FROM hrm_schema.attendances a
JOIN core_schema.employees e ON e.id=a.employee_id AND e.tenant_id=a.tenant_id
CROSS JOIN LATERAL (VALUES ('IN',a.check_in_at),('OUT',a.check_out_at)) p(kind,at)
WHERE p.at IS NOT NULL ON CONFLICT DO NOTHING;

ALTER TABLE hrm_schema.attendances
  ADD COLUMN IF NOT EXISTS scheduled_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculation_snapshot jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS hrm_schema.work_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_date date NOT NULL,
  day_kind varchar(20) NOT NULL CHECK(day_kind IN ('WORK','OFF','HOLIDAY')),
  name varchar(180) NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  created_by uuid,
  UNIQUE(tenant_id, work_date)
);

CREATE TABLE IF NOT EXISTS hrm_schema.attendance_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(180) NOT NULL,
  latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  radius_meters integer NOT NULL CHECK(radius_meters BETWEEN 1 AND 100000),
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  UNIQUE(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS hrm_schema.attendance_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  token_hash varchar(64) NOT NULL,
  name varchar(180) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','REVOKED')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hrm_one_active_attendance_device
  ON hrm_schema.attendance_devices(tenant_id,employee_id) WHERE status='ACTIVE';

CREATE TABLE IF NOT EXISTS hrm_schema.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_id uuid,
  action varchar(100) NOT NULL,
  entity_type varchar(100),
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
