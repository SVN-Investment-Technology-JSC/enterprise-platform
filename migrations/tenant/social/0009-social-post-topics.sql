SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ: MỘT BÀI CÓ NHIỀU CHUYÊN MỤC
--
-- Trước đây mỗi bài chỉ có một chuyên mục (`posts.topic_id`). Bảng `post_topics` lưu toàn bộ chuyên mục của bài
-- (`position` là thứ tự tác giả chọn). `posts.topic_id` giữ lại làm chuyên mục chính (phần tử đầu) để bản app cũ và
-- các truy vấn cũ vẫn chạy; bài cũ được chép sang bảng mới. Chỉ thêm bảng và chỉ mục.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS social_schema.post_topics (
    post_id  UUID     NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    topic_id UUID     NOT NULL REFERENCES social_schema.topics(id) ON DELETE CASCADE,
    position SMALLINT NOT NULL DEFAULT 0,
    PRIMARY KEY (post_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_social_post_topics_topic
    ON social_schema.post_topics (topic_id, post_id);

INSERT INTO social_schema.post_topics (post_id, topic_id, position)
SELECT id, topic_id, 0
  FROM social_schema.posts
 WHERE topic_id IS NOT NULL
ON CONFLICT (post_id, topic_id) DO NOTHING;
