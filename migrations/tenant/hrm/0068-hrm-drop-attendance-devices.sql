-- Bỏ tính năng "thiết bị chấm công đã duyệt": quy định chấm công chỉ còn IP và GPS, không còn đăng ký, duyệt hay
-- thu hồi thiết bị. Đã kiểm tra trên Production: bảng thiết bị, cột device_id của sự kiện chấm công, nhật ký
-- ATTENDANCE_DEVICE_* và quyền hrm.device.manage đều rỗng nên không có dữ liệu cần giữ.
-- Chỉ đụng bảng và cột của HRM. Cột attendance_records.device_id (0001) là bản ghi cũ khác, không đổi.
-- Chạy lại được (IF EXISTS). Phải triển khai SAU bản app đã bỏ mọi chỗ đọc/ghi hai đối tượng này.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DROP INDEX IF EXISTS hrm_schema.hrm_one_active_attendance_device;
DROP TABLE IF EXISTS hrm_schema.attendance_devices;
ALTER TABLE hrm_schema.attendance_events DROP COLUMN IF EXISTS device_id;
