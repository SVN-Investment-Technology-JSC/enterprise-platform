SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Chốt chặn chồng đơn xét theo GIỜ, không chỉ theo ngày: đơn nghỉ phép và công tác lưu giờ bắt đầu (ngày đầu)
-- và giờ kết thúc (ngày cuối). Để trống (đơn cũ, hoặc client không gửi) nghĩa là cả ngày như trước đây.
-- Đơn làm thêm giờ đã có start_time / end_time.
ALTER TABLE hrm_schema.leave_requests
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE hrm_schema.business_trip_requests
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time;

COMMENT ON COLUMN hrm_schema.leave_requests.start_time IS 'Giờ bắt đầu nghỉ ở ngày đầu; null = từ đầu ngày';
COMMENT ON COLUMN hrm_schema.leave_requests.end_time IS 'Giờ kết thúc nghỉ ở ngày cuối; null = hết ngày';
COMMENT ON COLUMN hrm_schema.business_trip_requests.start_time IS 'Giờ bắt đầu công tác ở ngày đầu; null = từ đầu ngày';
COMMENT ON COLUMN hrm_schema.business_trip_requests.end_time IS 'Giờ kết thúc công tác ở ngày cuối; null = hết ngày';
