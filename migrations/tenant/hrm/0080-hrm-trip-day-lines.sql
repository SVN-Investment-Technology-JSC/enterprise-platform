-- Đơn công tác khai giờ làm theo từng ngày (tùy chọn): giờ dự kiến khi đăng ký trước, giờ thực tế bổ sung sau chuyến đi và được
-- người duyệt trực tiếp hoặc dự phòng xác nhận. Giờ thực tế đã duyệt được tách thành giờ ca (theo ca của nhân viên trong ngày)
-- và giờ làm thêm; phần làm thêm ghi vào overtime_blocks để tính trần làm thêm và quỹ nghỉ bù. Chỉ thêm bảng và cột.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS hrm_schema.business_trip_day_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  trip_request_id uuid NOT NULL REFERENCES hrm_schema.business_trip_requests(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  -- Danh sách khung giờ trong ngày: [{"from":"18:00","to":"05:00"}]; giờ kết thúc không sau giờ bắt đầu nghĩa là sang ngày hôm sau.
  planned_windows jsonb,
  actual_windows jsonb,
  status varchar(20) NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'ACTUAL_PENDING', 'ACTUAL_APPROVED', 'ACTUAL_REJECTED')),
  submitted_by uuid,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  -- Kết quả phân loại khi duyệt giờ thực tế (phút): ca của nhân viên trong ngày, giờ trong ca, giờ làm thêm, giờ đêm trong làm thêm.
  scheduled_minutes integer,
  normal_minutes integer,
  ot_minutes integer,
  night_minutes integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrm_trip_day_lines UNIQUE (trip_request_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_hrm_trip_day_lines_employee
  ON hrm_schema.business_trip_day_lines (tenant_id, employee_id, work_date);
COMMENT ON TABLE hrm_schema.business_trip_day_lines IS 'Giờ làm theo ngày của đơn công tác: dự kiến, thực tế và kết quả phân loại sau khi người duyệt xác nhận';

-- Ca làm thêm sinh từ giờ thực tế của đơn công tác: không có đơn làm thêm đi kèm.
ALTER TABLE hrm_schema.overtime_blocks ALTER COLUMN ot_request_id DROP NOT NULL;
ALTER TABLE hrm_schema.overtime_blocks
  ADD COLUMN IF NOT EXISTS trip_day_line_id uuid REFERENCES hrm_schema.business_trip_day_lines(id) ON DELETE CASCADE;
ALTER TABLE hrm_schema.overtime_blocks DROP CONSTRAINT IF EXISTS overtime_blocks_rule_set_check;
ALTER TABLE hrm_schema.overtime_blocks
  ADD CONSTRAINT overtime_blocks_rule_set_check CHECK (rule_set IN ('NIGHT_REST', 'CLOCK_WINDOW', 'DECLARED'));
ALTER TABLE hrm_schema.overtime_blocks DROP CONSTRAINT IF EXISTS overtime_blocks_source_check;
ALTER TABLE hrm_schema.overtime_blocks
  ADD CONSTRAINT overtime_blocks_source_check CHECK (source IN ('RULE', 'MANUAL', 'IMPORT_1OFFICE', 'CT_DECLARED'));
ALTER TABLE hrm_schema.overtime_blocks DROP CONSTRAINT IF EXISTS overtime_blocks_origin;
ALTER TABLE hrm_schema.overtime_blocks
  ADD CONSTRAINT overtime_blocks_origin CHECK (ot_request_id IS NOT NULL OR trip_day_line_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_overtime_blocks_trip_line
  ON hrm_schema.overtime_blocks (tenant_id, trip_day_line_id, start_at) WHERE trip_day_line_id IS NOT NULL;
