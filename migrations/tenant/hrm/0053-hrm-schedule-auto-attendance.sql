SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Phân ca có thể bật "tự động chấm công" cho từng ngày làm việc trong tuần: tới ngày, hệ thống sinh sự kiện vào/ra
-- đúng giờ bắt đầu/kết thúc ca cho nhân viên chưa chấm công (nguồn AUTO). Cờ nằm trên lịch từng ngày và trên từng thứ
-- của lịch định kỳ.
ALTER TABLE hrm_schema.employee_work_days
  ADD COLUMN IF NOT EXISTS auto_attendance boolean NOT NULL DEFAULT false;
ALTER TABLE hrm_schema.work_schedule_rule_days
  ADD COLUMN IF NOT EXISTS auto_attendance boolean NOT NULL DEFAULT false;
