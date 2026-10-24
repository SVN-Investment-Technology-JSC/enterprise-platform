-- Người duyệt dự phòng cuối cấu hình được: chức danh nhận duyệt đơn của nhân viên không có "Báo cáo cho".
-- Trước đây gán cứng theo tên chức danh chứa "Tổng giám đốc". Cột NULL (mặc định) = không dùng bậc dự phòng cuối.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.approval_policy_settings
  ADD COLUMN IF NOT EXISTS last_resort_position_id uuid;
