SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ: CHUYỂN MÃ VIDEO Ở NỀN
--
-- Video tải lên được `video-worker` chuyển sang MP4 H.264 (tối đa 720p cho bình luận, 1080p cho bài viết), kèm ảnh
-- poster, rồi xoá bản gốc. Trạng thái nằm trong chính dòng `attachments` (một nguồn sự thật):
--   none        không cần xử lý (không phải video, hoặc video cũ phát được ngay)
--   queued      đã tải xong, chờ worker
--   processing  worker đang chạy (thuê tới `processing_lease_until`)
--   ready       đã xong, `storage_key` trỏ tới bản mới
--   failed      không chuyển mã được (`processing_error`)
-- `purpose` ghi nơi tệp sẽ gắn vào (post/comment) vì lúc tải xong tệp chưa gắn vào đâu, mà giới hạn và hàng đợi
-- phụ thuộc vào nó. `source_key` giữ khoá bản gốc đến khi xoá thành công để job dọn thử lại nếu xoá hỏng.
-- Chỉ thêm cột, ràng buộc và chỉ mục nên bản app cũ vẫn chạy với schema này.
-- ===========================================================================
ALTER TABLE social_schema.attachments
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'post',
    ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS processing_lease_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_error TEXT,
    ADD COLUMN IF NOT EXISTS source_key TEXT,
    ADD COLUMN IF NOT EXISTS poster_key TEXT,
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
    ADD COLUMN IF NOT EXISTS width INTEGER,
    ADD COLUMN IF NOT EXISTS height INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_social_attachments_purpose'
           AND conrelid = 'social_schema.attachments'::regclass
    ) THEN
        ALTER TABLE social_schema.attachments
            ADD CONSTRAINT chk_social_attachments_purpose CHECK (purpose IN ('post', 'comment'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_social_attachments_processing_status'
           AND conrelid = 'social_schema.attachments'::regclass
    ) THEN
        ALTER TABLE social_schema.attachments
            ADD CONSTRAINT chk_social_attachments_processing_status
            CHECK (processing_status IN ('none', 'queued', 'processing', 'ready', 'failed'));
    END IF;
END $$;

-- Worker nhận việc và đếm video đang chờ theo trạng thái.
CREATE INDEX IF NOT EXISTS idx_social_attachments_processing
    ON social_schema.attachments (processing_status, processing_lease_until)
    WHERE processing_status IN ('queued', 'processing');

-- Job dọn tệp mồ côi và tính dung lượng chưa gắn của từng người dùng.
CREATE INDEX IF NOT EXISTS idx_social_attachments_orphan
    ON social_schema.attachments (created_at)
    WHERE post_id IS NULL AND comment_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_attachments_uploader_unattached
    ON social_schema.attachments (uploaded_by, created_at)
    WHERE post_id IS NULL AND comment_id IS NULL;

-- Job xoá bản gốc còn sót sau chuyển mã.
CREATE INDEX IF NOT EXISTS idx_social_attachments_source_cleanup
    ON social_schema.attachments (id)
    WHERE source_key IS NOT NULL;
