SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- LIÊN KẾT ĐƠN TỪ - BẢNG CÔNG - BẢNG LƯƠNG.
--   * timesheets.sources: mọi đơn tác động tới ngày công (nghỉ, làm thêm giờ, công tác, giải trình công, đổi ca)
--     để truy vết từ ô công về đơn gốc; ot_request_id/leave_request_id/business_trip_request_id chỉ là đơn chính.
--   * business_trip_allowance_rates: mức công tác phí theo hình thức công tác, có phiên bản theo ngày hiệu lực.
--   * payroll_runs.timesheet_fingerprint: dấu vân tay bảng công lúc tính lương để chặn chốt lương khi bảng công đã đổi.
--   * Mỗi kỳ công chỉ có một kỳ lương.

ALTER TABLE hrm_schema.timesheets
  ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE hrm_schema.timesheets DROP CONSTRAINT IF EXISTS timesheets_sources_check;
ALTER TABLE hrm_schema.timesheets ADD CONSTRAINT timesheets_sources_check CHECK (jsonb_typeof(sources) = 'array');
COMMENT ON COLUMN hrm_schema.timesheets.sources IS 'Đơn tác động tới ngày công: [{kind: LEAVE|OT|TRIP|CORRECTION|SHIFT_CHANGE, id, minutes, label}]';

CREATE TABLE IF NOT EXISTS hrm_schema.business_trip_allowance_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  trip_type varchar(50) NOT NULL CHECK (trip_type IN ('DOMESTIC','OVERSEAS','INTERSITE')),
  daily_amount numeric(14,2) NOT NULL CHECK (daily_amount >= 0),
  effective_from date NOT NULL,
  effective_to date,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_hrm_trip_allowance_rates_lookup
  ON hrm_schema.business_trip_allowance_rates (tenant_id, trip_type, effective_from DESC) WHERE status = 'ACTIVE';

ALTER TABLE hrm_schema.payroll_runs
  ADD COLUMN IF NOT EXISTS timesheet_fingerprint text;
COMMENT ON COLUMN hrm_schema.payroll_runs.timesheet_fingerprint IS 'Dấu vân tay bảng công (số dòng, thời điểm cập nhật mới nhất, tổng phút) lúc tính lương';

-- Chỉ tạo chỉ mục duy nhất khi dữ liệu hiện có chưa có hai kỳ lương trùng kỳ công; có trùng thì để quản trị xử lý.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM hrm_schema.payroll_periods
     WHERE timesheet_period_id IS NOT NULL
     GROUP BY tenant_id, timesheet_period_id HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_payroll_periods_timesheet
      ON hrm_schema.payroll_periods (tenant_id, timesheet_period_id) WHERE timesheet_period_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'payroll_periods: có kỳ lương trùng kỳ công, bỏ qua chỉ mục duy nhất uq_hrm_payroll_periods_timesheet';
  END IF;
END $$;
