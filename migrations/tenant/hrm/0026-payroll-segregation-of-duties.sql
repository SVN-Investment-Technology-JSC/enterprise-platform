-- FIX-C-12: phân tách nhiệm vụ lương (SoD).
-- Cấu hình theo tenant. Tenant MỚI (chưa có dòng cấu hình) được backend coi là BẬT cả hai.
-- Tenant ĐÃ có dữ liệu HRM trước migration này nhận dòng cấu hình = FALSE để không đổi hành vi đang chạy.
CREATE TABLE IF NOT EXISTS hrm_schema.payroll_sod_settings (
  tenant_id uuid PRIMARY KEY,
  separate_calc_finalize boolean NOT NULL DEFAULT true,
  separate_finalize_publish boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hrm_schema.payroll_runs ADD COLUMN IF NOT EXISTS calculated_by uuid;
ALTER TABLE hrm_schema.payroll_runs ADD COLUMN IF NOT EXISTS published_by uuid;

INSERT INTO hrm_schema.payroll_sod_settings(tenant_id, separate_calc_finalize, separate_finalize_publish)
SELECT DISTINCT tenant_id, false, false FROM (
  SELECT tenant_id FROM hrm_schema.employee_profiles
  UNION SELECT tenant_id FROM hrm_schema.payroll_periods
  UNION SELECT tenant_id FROM hrm_schema.timesheet_periods
) existing
ON CONFLICT (tenant_id) DO NOTHING;
