-- Bổ sung envelope đầy đủ cho sự kiện hrm.employee.offboarded (trước đây thiếu occurredAt/tenantId/source,
-- khiến RabbitMqPublisher gặp timestamp NaN). Consumer org-hrm-bridge đọc `payload.payload || payload`.
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
        'version', 1,
        'occurredAt', now(),
        'tenantId', NEW.tenant_id,
        'source', 'hrm',
        'correlationId', NEW.employee_id,
        'payload', jsonb_build_object(
          'employeeId', NEW.employee_id,
          'employmentStatus', NEW.employment_status,
          'effectiveDate', CURRENT_DATE
        )
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
