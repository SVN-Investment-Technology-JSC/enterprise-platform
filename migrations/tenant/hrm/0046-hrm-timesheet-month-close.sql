SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Bảng công theo tháng: chốt đơn từ (từ lúc chốt không tạo, sửa, duyệt đơn có ngày thuộc tháng).
-- requests_closed_at/by do POST /timesheet-months/:month/close-requests ghi; mở lại tháng thì xóa.
ALTER TABLE hrm_schema.timesheet_periods
  ADD COLUMN IF NOT EXISTS requests_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS requests_closed_by uuid;

-- Tìm kỳ theo tháng (khoảng ngày) của một tenant.
CREATE INDEX IF NOT EXISTS idx_hrm_timesheet_periods_range
  ON hrm_schema.timesheet_periods (tenant_id, from_date, to_date);

COMMENT ON COLUMN hrm_schema.timesheet_periods.requests_closed_at IS 'Thời điểm chốt đơn từ của tháng; NULL = đơn từ còn mở';
COMMENT ON COLUMN hrm_schema.timesheet_periods.requests_closed_by IS 'Người chốt đơn từ';
