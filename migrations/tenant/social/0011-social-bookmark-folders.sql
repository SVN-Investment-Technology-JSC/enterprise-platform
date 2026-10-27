SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ: THƯ MỤC CHO BÀI ĐÃ LƯU
--
-- Mỗi người tự tạo thư mục (tên không phân biệt hoa thường, không trùng trong cùng một người) để xếp bài đã lưu.
-- `post_bookmarks.folder_id` NULL là chưa phân loại; xoá thư mục thì bài về chưa phân loại. Bảng cũ chỉ thêm cột
-- nullable nên bản app cũ vẫn chạy với schema mới; chạy lại không đổi gì thêm.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS social_schema.bookmark_folders (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL,
    name       VARCHAR(60) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_bookmark_folders_user_name
    ON social_schema.bookmark_folders (user_id, lower(name));

ALTER TABLE social_schema.post_bookmarks
    ADD COLUMN IF NOT EXISTS folder_id UUID NULL REFERENCES social_schema.bookmark_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_post_bookmarks_user_folder
    ON social_schema.post_bookmarks (user_id, folder_id);
