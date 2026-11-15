-- 0077: `hrm.employee.offboarded` gửi ngày nghỉ việc thật thay vì ngày ghi sự kiện. Bản 0034 ghi
-- `effectiveDate = CURRENT_DATE`, nên nghỉ việc có hiệu lực từ một ngày trước đó (người dùng nhập ở
-- POST /employees/:id/deactivate, lưu vào `inactive_from`) vẫn được Core đóng bổ nhiệm theo ngày hôm nay.
-- `effectiveDate` là `inactive_from` của hồ sơ (ngày đầu tiên không còn làm việc), cập nhật cùng câu UPDATE đổi
-- trạng thái nên NEW đã có giá trị; hồ sơ không có `inactive_from` thì giữ CURRENT_DATE như cũ.
-- Chỉ thay thân hàm; trigger `trg_hrm_employee_offboarded` (0021) giữ nguyên, tên loại sự kiện giữ nguyên.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

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
          'effectiveDate', to_char(COALESCE(NEW.inactive_from, CURRENT_DATE), 'YYYY-MM-DD')
        )
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
