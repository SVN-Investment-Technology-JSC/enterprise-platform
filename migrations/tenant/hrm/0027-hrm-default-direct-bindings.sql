-- FIX-E-06: mọi tenant HRM đã có phải có binding chế độ duyệt mặc định (DIRECT) cho 7 loại đơn,
-- để gửi đơn không còn lỗi 409 "Chưa cấu hình chế độ duyệt". Idempotent; không đổi binding đã có.
-- Tenant mới được seed tương đương ở bước provisioning (seedHrmDirectBindings).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

INSERT INTO hrm_schema.request_procedure_bindings(tenant_id, request_kind, mode)
SELECT t.tenant_id, k.kind, 'DIRECT'
FROM (
  SELECT tenant_id FROM hrm_schema.employee_profiles
  UNION SELECT tenant_id FROM hrm_schema.request_procedure_bindings
  UNION SELECT tenant_id FROM hrm_schema.payroll_periods
  UNION SELECT tenant_id FROM hrm_schema.timesheet_periods
  UNION SELECT tenant_id FROM hrm_schema.leave_types
) t
CROSS JOIN unnest(ARRAY['leave','ot','business_trip','shift_change','correction','advance','profile_correction']) k(kind)
WHERE NOT EXISTS (
  SELECT 1 FROM hrm_schema.request_procedure_bindings b
  WHERE b.tenant_id = t.tenant_id AND b.request_kind = k.kind
    AND b.sub_type_code IS NULL AND b.is_active
);
