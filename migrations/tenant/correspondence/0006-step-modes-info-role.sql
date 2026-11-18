-- Quy trình động, đợt 1:
-- - Bước duyệt "tất cả cùng duyệt": ghi ai phải duyệt (giải lúc bước bắt đầu, không tính người được ủy quyền) và ai đã duyệt.
-- - Bước phòng ban xử lý: xong khi mọi phòng gửi kết quả (mặc định) hay khi phòng chủ trì gửi.
-- - Phòng ban "nhận để biết": được xem, được báo, không phải gửi kết quả, không chặn bước.
-- Dữ liệu cũ: cách xong trống là mặc định của loại bước, như trước.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE correspondence_schema.letter_steps
    ADD COLUMN IF NOT EXISTS mode              VARCHAR(10),
    ADD COLUMN IF NOT EXISTS required_user_ids UUID[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS approved_by       UUID[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letter_steps_mode') THEN
        ALTER TABLE correspondence_schema.letter_steps
            ADD CONSTRAINT chk_correspondence_letter_steps_mode CHECK (mode IS NULL OR mode IN ('any', 'all', 'lead'));
    END IF;
END
$$;

ALTER TABLE correspondence_schema.assignments DROP CONSTRAINT IF EXISTS chk_correspondence_assignments_role;
ALTER TABLE correspondence_schema.assignments
    ADD CONSTRAINT chk_correspondence_assignments_role CHECK (role IN ('lead', 'support', 'info'));
