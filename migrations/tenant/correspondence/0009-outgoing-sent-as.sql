-- Công văn đi gửi với danh nghĩa cá nhân người soạn hay cả phòng ban soạn thảo: hiện người gửi trên danh sách,
-- hồ sơ; cá nhân thì chỉ người soạn (và văn thư) sửa, gửi bản soạn, cả phòng thì mọi người trong phòng.
-- Dữ liệu cũ là cả phòng ban, như trước.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE correspondence_schema.letters
    ADD COLUMN IF NOT EXISTS sent_as VARCHAR(10) NOT NULL DEFAULT 'unit';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letters_sent_as') THEN
        ALTER TABLE correspondence_schema.letters
            ADD CONSTRAINT chk_correspondence_letters_sent_as CHECK (sent_as IN ('person', 'unit'));
    END IF;
END
$$;
