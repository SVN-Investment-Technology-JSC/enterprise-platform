SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ · BẢNG TIN (P1)
--
-- Bài viết cấp công ty, chuyên mục, phản ứng, bình luận hai cấp, tệp đính kèm.
-- Mọi cột người dùng (`author_id`, `user_id`...) là id người dùng của tenant;
-- tên hiển thị lấy qua API của HRM, không sao chép sang đây và không có khoá
-- ngoại sang schema khác.
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS social_schema;

-- ---------------------------------------------------------------------------
-- CHUYÊN MỤC
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.topics (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       VARCHAR(80) NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_topics_name
    ON social_schema.topics (lower(name));

-- ---------------------------------------------------------------------------
-- BÀI VIẾT
--
-- `body_html` đã được làm sạch ở tầng ứng dụng trước khi lưu.
-- `status` chỉ có 'published' và 'deleted' ở P1; 'pending', 'scheduled' dành cho
-- duyệt bài và hẹn giờ. Xoá là xoá mềm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.posts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id     UUID NOT NULL,
    kind          VARCHAR(20) NOT NULL DEFAULT 'post' CHECK (kind IN ('post', 'announcement')),
    title         VARCHAR(200),
    body_html     TEXT NOT NULL,
    topic_id      UUID REFERENCES social_schema.topics(id) ON DELETE SET NULL,
    pinned        BOOLEAN NOT NULL DEFAULT false,
    mentions_all  BOOLEAN NOT NULL DEFAULT false,
    status        VARCHAR(20) NOT NULL DEFAULT 'published'
                  CHECK (status IN ('published', 'pending', 'scheduled', 'deleted')),
    published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at     TIMESTAMPTZ,
    deleted_at    TIMESTAMPTZ,
    deleted_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_social_posts_deleted CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);

-- Bảng tin: bài đã đăng, mới nhất trước; `id` phá thế hoà để con trỏ ổn định.
CREATE INDEX IF NOT EXISTS idx_social_posts_feed
    ON social_schema.posts (published_at DESC, id DESC)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_social_posts_topic
    ON social_schema.posts (topic_id, published_at DESC, id DESC)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_social_posts_author
    ON social_schema.posts (author_id, published_at DESC, id DESC)
    WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_social_posts_pinned
    ON social_schema.posts (published_at DESC)
    WHERE status = 'published' AND pinned;

CREATE TABLE IF NOT EXISTS social_schema.post_mentions (
    post_id UUID NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    PRIMARY KEY (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- TỆP ĐÍNH KÈM
--
-- Tải lên hai bước qua URL ký sẵn. `post_id` NULL là tệp chưa gắn vào bài;
-- tệp mồ côi quá 24 giờ bị dọn. `completed_at` NULL là chưa tải xong.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.attachments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id       UUID REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    uploaded_by   UUID NOT NULL,
    file_name     VARCHAR(255) NOT NULL,
    content_type  VARCHAR(150) NOT NULL,
    size_bytes    BIGINT NOT NULL CHECK (size_bytes > 0),
    storage_key   VARCHAR(512) NOT NULL,
    completed_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_attachments_post
    ON social_schema.attachments (post_id) WHERE post_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_attachments_orphans
    ON social_schema.attachments (created_at) WHERE post_id IS NULL;

-- ---------------------------------------------------------------------------
-- PHẢN ỨNG: mỗi người một phản ứng trên mỗi bài.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.post_reactions (
    post_id    UUID NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    type       VARCHAR(20) NOT NULL CHECK (type IN ('like', 'love', 'celebrate', 'insightful')),
    reacted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

-- ---------------------------------------------------------------------------
-- BÌNH LUẬN: bình luận gốc và trả lời (hai cấp). Xoá mềm để giữ chuỗi trả lời.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.comments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    parent_id   UUID REFERENCES social_schema.comments(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at   TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    deleted_by  UUID,

    CONSTRAINT chk_social_comments_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_social_comments_post
    ON social_schema.comments (post_id, created_at, id) WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_social_comments_parent
    ON social_schema.comments (parent_id, created_at, id) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_schema.comment_mentions (
    comment_id UUID NOT NULL REFERENCES social_schema.comments(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    PRIMARY KEY (comment_id, user_id)
);
