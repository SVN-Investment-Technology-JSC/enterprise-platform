SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ: PHẢN ỨNG TRÊN BÌNH LUẬN
--
-- Giống phản ứng trên bài: mỗi người một phản ứng cho mỗi bình luận, đặt lại là đổi loại.
-- Bản app cũ vẫn chạy với schema này vì chỉ thêm bảng mới.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS social_schema.comment_reactions (
    comment_id UUID NOT NULL REFERENCES social_schema.comments(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    type       VARCHAR(20) NOT NULL CHECK (type IN ('like', 'love', 'celebrate', 'insightful')),
    reacted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);
