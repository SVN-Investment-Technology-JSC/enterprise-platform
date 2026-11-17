SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Theo dõi số lần gửi phiếu sang Quy trình để tự thử lại lỗi tạm thời (mạng, 5xx) có giới hạn.
-- dispatch_attempts: số lần đã gửi; dispatch_attempted_at: lần gửi gần nhất, làm mốc cách quãng giữa các lần thử.
-- Cột mới có giá trị mặc định nên bản app cũ vẫn chạy được với schema này.
ALTER TABLE maintenance_schema.occurrences
  ADD COLUMN IF NOT EXISTS dispatch_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispatch_attempted_at timestamptz;
