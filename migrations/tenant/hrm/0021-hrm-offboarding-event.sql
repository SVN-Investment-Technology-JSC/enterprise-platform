-- Hàm trigger ghi nhận sự kiện nhân viên nghỉ việc để giải phóng chức danh bên CORE
CREATE OR REPLACE FUNCTION hrm_schema.record_employee_offboarded_event() RETURNS trigger AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
BEGIN
  IF NEW.employment_status IN ('RESIGNED', 'TERMINATED')
     AND OLD.employment_status NOT IN ('RESIGNED', 'TERMINATED') THEN
     
    INSERT INTO integration_schema.outbox_events
      (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
    VALUES (
      v_event_id,
      'hrm-employee',
      NEW.employee_id::text,
      'hrm.employee.offboarded',
      1,
      jsonb_build_object(
        'id', v_event_id,
        'type', 'hrm.employee.offboarded',
        'employeeId', NEW.employee_id,
        'employmentStatus', NEW.employment_status,
        'effectiveDate', CURRENT_DATE
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hrm_employee_offboarded ON hrm_schema.employee_profiles;
CREATE TRIGGER trg_hrm_employee_offboarded
  AFTER UPDATE OF employment_status ON hrm_schema.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION hrm_schema.record_employee_offboarded_event();
