SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ: BỐ CỤC ẢNH/VIDEO VÀ THỨ TÁC GIẢ SẮP CHO TỆP CỦA BÀI
--
-- Bài viết được gồm ảnh, video và tài liệu cùng nhau. Tác giả chọn một bố cục hiển thị (`posts.media_layout`) và thứ
-- tự các mục (`attachments.position`, là chỉ số trong mảng `attachmentIds` lúc đăng hoặc sửa bài). Bài và tệp cũ nhận
-- mặc định `auto` và `0`, tức giữ cách hiển thị cũ (đọc tệp theo `position, created_at, id` thì vẫn là thứ tự tải lên).
-- Chỉ thêm cột, ràng buộc và chỉ mục nên bản app cũ vẫn chạy với schema này.
-- ===========================================================================
ALTER TABLE social_schema.posts
    ADD COLUMN IF NOT EXISTS media_layout TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE social_schema.attachments
    ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_social_posts_media_layout'
           AND conrelid = 'social_schema.posts'::regclass
    ) THEN
        ALTER TABLE social_schema.posts
            ADD CONSTRAINT chk_social_posts_media_layout
            CHECK (media_layout IN ('auto', 'grid', 'featured', 'stack', 'carousel'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_social_attachments_post_position
    ON social_schema.attachments (post_id, position, created_at, id)
    WHERE post_id IS NOT NULL;
