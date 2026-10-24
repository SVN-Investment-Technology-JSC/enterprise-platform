SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ · BÀI VIẾT P2/P3
--
-- Mở rộng `posts` (nhóm, duyệt bài, hẹn giờ, xác nhận đã đọc, bài tự sinh, tìm kiếm),
-- thêm bình chọn, xác nhận đã đọc, bài đã lưu và cài đặt. Bản app cũ vẫn chạy với
-- schema này: mọi cột mới có mặc định hoặc cho NULL.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Cột mới của posts
-- ---------------------------------------------------------------------------
ALTER TABLE social_schema.posts
    -- NULL là bài trên Tường công ty.
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES social_schema.groups(id),
    -- Giờ hẹn đăng; có khi status = 'scheduled'. Giữ lại sau khi đã đăng để tra cứu.
    ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS moderated_by UUID,
    ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reject_reason VARCHAR(500),
    ADD COLUMN IF NOT EXISTS requires_read_confirmation BOOLEAN NOT NULL DEFAULT false,
    -- Bài tự sinh từ hoạt động (kind = 'activity'), ví dụ 'avatar.updated'.
    ADD COLUMN IF NOT EXISTS activity_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS activity_payload JSONB;

-- Văn bản gập (không dấu, chữ thường) để tìm kiếm: tiêu đề + nội dung bỏ thẻ HTML và thực thể.
-- Là cột sinh nên bài cũ tự có giá trị và app không phải tính khi ghi.
ALTER TABLE social_schema.posts
    ADD COLUMN IF NOT EXISTS search_text TEXT GENERATED ALWAYS AS (
        social_schema.fold_text(
            coalesce(title, '') || ' ' ||
            regexp_replace(regexp_replace(body_html, '<[^>]*>', ' ', 'g'), '&[a-zA-Z#0-9]+;', ' ', 'g')
        )
    ) STORED;

-- ---------------------------------------------------------------------------
-- Ràng buộc: mở rộng trạng thái và loại bài. Ràng buộc inline của 0001 có tên tự sinh.
-- ---------------------------------------------------------------------------
ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_status;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_status
    CHECK (status IN ('published', 'pending', 'scheduled', 'rejected', 'deleted'));

ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS posts_kind_check;
ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_kind;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_kind
    CHECK (kind IN ('post', 'announcement', 'activity'));

ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_scheduled;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_scheduled
    CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL);

ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_rejected;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_rejected
    CHECK (status <> 'rejected' OR reject_reason IS NOT NULL);

ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_activity;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_activity
    CHECK ((kind = 'activity') = (activity_type IS NOT NULL));

-- Bài nhóm không có chuyên mục (chuyên mục là của Tường công ty).
ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_group_topic;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_group_topic
    CHECK (group_id IS NULL OR topic_id IS NULL);

-- ---------------------------------------------------------------------------
-- Chỉ mục
-- ---------------------------------------------------------------------------
-- Tường công ty: bài đã đăng không thuộc nhóm.
CREATE INDEX IF NOT EXISTS idx_social_posts_wall
    ON social_schema.posts (published_at DESC, id DESC)
    WHERE status = 'published' AND group_id IS NULL;

-- Bảng tin của một nhóm, và tab "Bài thông báo" của nhóm.
CREATE INDEX IF NOT EXISTS idx_social_posts_group_feed
    ON social_schema.posts (group_id, published_at DESC, id DESC)
    WHERE status = 'published' AND group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_posts_group_announcements
    ON social_schema.posts (group_id, published_at DESC, id DESC)
    WHERE status = 'published' AND group_id IS NOT NULL AND kind = 'announcement';

-- Job hẹn giờ quét bài đến hạn.
CREATE INDEX IF NOT EXISTS idx_social_posts_due
    ON social_schema.posts (scheduled_at, id) WHERE status = 'scheduled';

-- Hàng chờ duyệt của moderator (chỉ bài Tường công ty).
CREATE INDEX IF NOT EXISTS idx_social_posts_pending
    ON social_schema.posts (created_at, id) WHERE status = 'pending';

-- "Bài của tôi" đang chờ, hẹn giờ hoặc bị từ chối.
CREATE INDEX IF NOT EXISTS idx_social_posts_author_unpublished
    ON social_schema.posts (author_id, created_at DESC, id DESC)
    WHERE status IN ('pending', 'scheduled', 'rejected');

-- Tìm kiếm từ khoá (cấu hình 'simple' vì không có từ điển tiếng Việt); truy vấn dùng tiền tố `từ:*`.
CREATE INDEX IF NOT EXISTS idx_social_posts_search
    ON social_schema.posts USING gin (to_tsvector('simple', search_text))
    WHERE status = 'published';

-- Bài cần xác nhận đã đọc, mới nhất trước.
CREATE INDEX IF NOT EXISTS idx_social_posts_requires_confirmation
    ON social_schema.posts (published_at DESC, id DESC)
    WHERE status = 'published' AND requires_read_confirmation;

-- ---------------------------------------------------------------------------
-- BÌNH CHỌN: tối đa một bình chọn cho mỗi bài. Sau khi có phiếu đầu tiên, các lựa chọn
-- không đổi được (ràng buộc ở tầng ứng dụng).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.polls (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id        UUID NOT NULL UNIQUE REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    question       VARCHAR(300) NOT NULL,
    allow_multiple BOOLEAN NOT NULL DEFAULT false,
    -- Bình chọn ẩn danh: API không bao giờ trả danh sách người bỏ phiếu, kể cả cho tác giả.
    anonymous      BOOLEAN NOT NULL DEFAULT false,
    closes_at      TIMESTAMPTZ,
    -- Đóng sớm thủ công bởi tác giả hoặc moderator.
    closed_at      TIMESTAMPTZ,
    closed_by      UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_social_polls_closed CHECK ((closed_at IS NULL) = (closed_by IS NULL))
);

CREATE TABLE IF NOT EXISTS social_schema.poll_options (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    poll_id  UUID NOT NULL REFERENCES social_schema.polls(id) ON DELETE CASCADE,
    position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 9),
    text     VARCHAR(200) NOT NULL,

    CONSTRAINT uq_social_poll_options_position UNIQUE (poll_id, position)
);

CREATE TABLE IF NOT EXISTS social_schema.poll_votes (
    option_id UUID NOT NULL REFERENCES social_schema.poll_options(id) ON DELETE CASCADE,
    -- Lặp lại để đếm người bỏ phiếu và kiểm "một lựa chọn" mà không phải nối bảng.
    poll_id   UUID NOT NULL REFERENCES social_schema.polls(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL,
    voted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (option_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_poll_votes_user
    ON social_schema.poll_votes (poll_id, user_id);

-- ---------------------------------------------------------------------------
-- XÁC NHẬN ĐÃ ĐỌC (bài có requires_read_confirmation)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.read_confirmations (
    post_id      UUID NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_social_read_confirmations_post
    ON social_schema.read_confirmations (post_id, confirmed_at, user_id);

-- ---------------------------------------------------------------------------
-- BÀI ĐÃ LƯU
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.post_bookmarks (
    user_id    UUID NOT NULL,
    post_id    UUID NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, post_id)
);

-- Danh sách "Đã lưu": lưu gần nhất trước; `post_id` phá thế hoà để con trỏ ổn định.
CREATE INDEX IF NOT EXISTS idx_social_post_bookmarks_user
    ON social_schema.post_bookmarks (user_id, created_at DESC, post_id DESC);

-- ---------------------------------------------------------------------------
-- CÀI ĐẶT PHÂN HỆ (key/value JSON). Khoá và kiểu giá trị ở contracts-social
-- (SOCIAL_SETTING_KEYS); thiếu dòng thì dùng mặc định.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.settings (
    key        VARCHAR(80) PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
