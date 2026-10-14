SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Cấu hình "Chấm công tự động" của tenant, tách khỏi phân ca: bật/tắt và chọn các thứ trong tuần mà không cần phân ca lại.
-- Ngày làm việc có ca (lịch từng ngày hoặc lịch định kỳ) rơi vào thứ đã chọn thì tới khi ca kết thúc, hệ thống sinh sự kiện
-- vào/ra đúng giờ ca (nguồn AUTO) cho nhân viên chưa chấm công. weekdays: 0 = Chủ nhật, 1 = thứ Hai ... 6 = thứ Bảy.
-- enabled_from: ngày bật gần nhất; chỉ sinh cho các ngày từ ngày này trở đi để bật không làm đổi dữ liệu đã qua.
-- Cờ auto_attendance trên phân ca (migration 0053) không còn được dùng.
CREATE TABLE IF NOT EXISTS hrm_schema.auto_attendance_settings (
  tenant_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  weekdays smallint[] NOT NULL DEFAULT '{}',
  enabled_from date,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_attendance_settings_weekdays CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);
