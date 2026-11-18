SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Gỡ thiết bị khỏi ma trận trước đây xoá cứng lịch và toàn bộ phiếu (kể cả phiếu đã hoàn thành và tệp đính kèm).
-- Nay chỉ đánh dấu lưu trữ: lịch ẩn khỏi ma trận, ngừng sinh phiếu, còn lịch sử phiếu giữ nguyên.
-- Cột mới cho phép NULL nên bản app cũ vẫn chạy được với schema này.
ALTER TABLE maintenance_schema.schedules
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
