-- Địa điểm chấm công: xóa mềm. Địa điểm đã xóa có deleted_at, không hiện trong danh mục và không còn được dùng để chấm công;
-- dòng vẫn giữ lại để nhật ký kiểm toán và chứng cứ chấm công (tên, tọa độ lúc chấm) còn truy vết được.
-- Chỉ thêm cột nên bản app cũ vẫn chạy được với schema mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.attendance_sites ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
