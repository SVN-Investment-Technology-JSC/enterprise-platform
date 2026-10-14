-- Chính sách công chuẩn của bảng công: có hiệu lực từ một tháng đến khi có chính sách mới thay thế.
-- Tách khỏi cấu hình công chuẩn trong chính sách lương (chỉ dùng cho tính lương). Chưa có chính sách thì công chuẩn động theo lịch ca.
CREATE TABLE IF NOT EXISTS hrm_schema.timesheet_standard_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  effective_month char(7) NOT NULL CHECK (effective_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  mode varchar(16) NOT NULL CHECK (mode IN ('DYNAMIC', 'FIXED')),
  workdays numeric(5,2) CHECK (workdays IS NULL OR (workdays > 0 AND workdays <= 31)),
  note text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_standard_policies_mode_workdays CHECK (
    (mode = 'FIXED' AND workdays IS NOT NULL) OR (mode = 'DYNAMIC' AND workdays IS NULL)
  ),
  CONSTRAINT timesheet_standard_policies_unique UNIQUE (tenant_id, effective_month)
);
