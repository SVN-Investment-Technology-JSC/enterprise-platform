-- Danh mục ca: hai giới hạn chặn chấm công trong giờ ca, NULL = không chặn (ca hiện có giữ nguyên hành vi).
--   block_late_in_minutes: chấm VÀO sau giờ bắt đầu quá số phút này thì bị từ chối (ví dụ ca 7:30 chặn 30 phút: 8:00 còn
--     chấm được và tính trễ 30 phút, 8:01 trở đi không chấm được).
--   block_early_out_minutes: chấm RA trước giờ kết thúc quá số phút này thì bị từ chối.
-- Cột check_in_before_minutes giữ lại cho tương thích nhưng không còn dùng: chấm vào sớm bao nhiêu cũng được.
-- Chỉ thêm cột nên bản app cũ vẫn chạy được với schema mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.shift_definitions ADD COLUMN IF NOT EXISTS block_late_in_minutes integer;
ALTER TABLE hrm_schema.shift_definitions ADD COLUMN IF NOT EXISTS block_early_out_minutes integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hrm_shift_block_minutes') THEN
    ALTER TABLE hrm_schema.shift_definitions
      ADD CONSTRAINT ck_hrm_shift_block_minutes CHECK (
        (block_late_in_minutes IS NULL OR block_late_in_minutes BETWEEN 0 AND 1440)
        AND (block_early_out_minutes IS NULL OR block_early_out_minutes BETWEEN 0 AND 1440)
      );
  END IF;
END $$;
