SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ: TỆP ĐÍNH KÈM CỦA BÌNH LUẬN
--
-- Dùng lại bảng `attachments` (cùng luồng tải lên, dọn tệp mồ côi và tính dung lượng của tenant):
-- thêm `comment_id`. Một tệp thuộc bài viết HOẶC bình luận, không thuộc cả hai. Tệp chưa gắn vào đâu
-- (post_id và comment_id cùng NULL) vẫn là tệp mồ côi như trước.
-- Chỉ thêm cột, ràng buộc và chỉ mục nên bản app cũ vẫn chạy với schema này.
-- ===========================================================================
ALTER TABLE social_schema.attachments
    ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES social_schema.comments(id) ON DELETE CASCADE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_social_attachments_single_owner'
           AND conrelid = 'social_schema.attachments'::regclass
    ) THEN
        ALTER TABLE social_schema.attachments
            ADD CONSTRAINT chk_social_attachments_single_owner CHECK (post_id IS NULL OR comment_id IS NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_attachments_comment
    ON social_schema.attachments (comment_id, created_at, id) WHERE comment_id IS NOT NULL;
