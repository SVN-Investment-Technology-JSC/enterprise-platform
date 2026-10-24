SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ · ĐỢT 2: QUYỀN XEM BÀI, NHÓM MỞ RỘNG, LỊCH SỬ SỬA, BÁO CÁO
--
-- Quyền xem bài Tường công ty (company/unit/custom/private) và danh sách chia sẻ; tắt bình
-- luận; lịch sử chỉnh sửa; chủ đề của nhóm, nhóm theo phòng ban/vị trí, quyền đăng bài,
-- ưu tiên nhóm; báo cáo nhóm/bài/bình luận.
--
-- Cột id người dùng và id phòng ban là id của tenant/Core, không có khoá ngoại sang schema khác.
-- Bản app đợt 1 vẫn chạy với schema này: mọi cột mới có mặc định hoặc cho NULL.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- NHÓM: cột mới
-- ---------------------------------------------------------------------------
ALTER TABLE social_schema.groups
    -- Mô tả rich text đã làm sạch; `description` vẫn là bản chữ thuần cho tìm kiếm.
    ADD COLUMN IF NOT EXISTS description_html TEXT,
    -- Khoá ảnh bìa mặc định (SOCIAL_GROUP_COVER_PRESETS); kiểm ở tầng ứng dụng.
    ADD COLUMN IF NOT EXISTS cover_preset VARCHAR(30),
    -- Ai được đăng bài vào nhóm. Admin nhóm luôn được đăng.
    ADD COLUMN IF NOT EXISTS post_permission VARCHAR(10) NOT NULL DEFAULT 'all',
    -- manual: thêm tay. org: nở từ phòng ban/vị trí (bảng group_member_sources).
    ADD COLUMN IF NOT EXISTS membership_mode VARCHAR(10) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_synced_by UUID;

ALTER TABLE social_schema.groups DROP CONSTRAINT IF EXISTS chk_social_groups_post_permission;
ALTER TABLE social_schema.groups ADD CONSTRAINT chk_social_groups_post_permission
    CHECK (post_permission IN ('all', 'admins', 'selected'));

ALTER TABLE social_schema.groups DROP CONSTRAINT IF EXISTS chk_social_groups_membership_mode;
ALTER TABLE social_schema.groups ADD CONSTRAINT chk_social_groups_membership_mode
    CHECK (membership_mode IN ('manual', 'org'));

-- Cách thành viên vào nhóm: để "đồng bộ lại" chỉ gỡ người do đồng bộ mang vào.
ALTER TABLE social_schema.group_members
    ADD COLUMN IF NOT EXISTS added_via VARCHAR(10) NOT NULL DEFAULT 'manual';

ALTER TABLE social_schema.group_members DROP CONSTRAINT IF EXISTS chk_social_group_members_added_via;
ALTER TABLE social_schema.group_members ADD CONSTRAINT chk_social_group_members_added_via
    CHECK (added_via IN ('manual', 'join', 'sync', 'creator'));

-- Người được phép đăng khi post_permission = 'selected'.
CREATE TABLE IF NOT EXISTS social_schema.group_post_permitted (
    group_id UUID NOT NULL REFERENCES social_schema.groups(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

-- Nguồn thành viên khi membership_mode = 'org'. source_id là id nút trong sơ đồ tổ chức của Core.
CREATE TABLE IF NOT EXISTS social_schema.group_member_sources (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id            UUID NOT NULL REFERENCES social_schema.groups(id) ON DELETE CASCADE,
    source_type         VARCHAR(10) NOT NULL CHECK (source_type IN ('unit', 'position')),
    source_id           UUID NOT NULL,
    -- Tên tại lúc lưu, để hiển thị khi không đọc được sơ đồ tổ chức.
    source_name         VARCHAR(200) NOT NULL,
    include_descendants BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_social_group_member_sources UNIQUE (group_id, source_type, source_id)
);

-- ---------------------------------------------------------------------------
-- CHỦ ĐỀ CỦA NHÓM (khác chuyên mục `topics` của Tường công ty)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.group_topics (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   UUID NOT NULL REFERENCES social_schema.groups(id) ON DELETE CASCADE,
    name       VARCHAR(60) NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_group_topics_name
    ON social_schema.group_topics (group_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_social_group_topics_group
    ON social_schema.group_topics (group_id, position, id);

-- ---------------------------------------------------------------------------
-- ƯU TIÊN NHÓM LÊN TRÊN (riêng từng người)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.group_priorities (
    user_id   UUID NOT NULL,
    group_id  UUID NOT NULL REFERENCES social_schema.groups(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_social_group_priorities_user
    ON social_schema.group_priorities (user_id, pinned_at DESC);

-- ---------------------------------------------------------------------------
-- BÀI VIẾT: quyền xem, tắt bình luận, chủ đề nhóm, bộ đếm sửa
-- ---------------------------------------------------------------------------
ALTER TABLE social_schema.posts
    -- company: mọi người; unit: phòng ban của tác giả; custom: post_audience; private: chỉ tác giả.
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'company',
    -- Phòng ban của tác giả lúc đặt quyền `unit` (không đổi khi tác giả chuyển phòng). NULL với quyền khác.
    ADD COLUMN IF NOT EXISTS author_unit_id UUID,
    ADD COLUMN IF NOT EXISTS comments_disabled BOOLEAN NOT NULL DEFAULT false,
    -- Số bản cũ trong post_edits (đếm sẵn để không phải nối khi dựng danh sách).
    ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS group_topic_id UUID REFERENCES social_schema.group_topics(id) ON DELETE SET NULL;

ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_visibility;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_visibility
    CHECK (visibility IN ('company', 'unit', 'custom', 'private'));

-- Bài nhóm theo nhóm, không dùng quyền xem riêng.
ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_group_visibility;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_group_visibility
    CHECK (group_id IS NULL OR visibility = 'company');

-- Quyền `unit` phải biết phòng ban của tác giả.
ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_unit_visibility;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_unit_visibility
    CHECK (visibility <> 'unit' OR author_unit_id IS NOT NULL);

-- Chủ đề nhóm chỉ đi với bài nhóm.
ALTER TABLE social_schema.posts DROP CONSTRAINT IF EXISTS chk_social_posts_group_topic_scope;
ALTER TABLE social_schema.posts ADD CONSTRAINT chk_social_posts_group_topic_scope
    CHECK (group_topic_id IS NULL OR group_id IS NOT NULL);

-- Bài của một chủ đề nhóm.
CREATE INDEX IF NOT EXISTS idx_social_posts_group_topic
    ON social_schema.posts (group_topic_id, published_at DESC, id DESC)
    WHERE status = 'published' AND group_topic_id IS NOT NULL;

-- Bài Tường công ty có giới hạn quyền xem (phòng ban/tuỳ chỉnh/riêng tư): trang cá nhân, "bài của tôi".
CREATE INDEX IF NOT EXISTS idx_social_posts_restricted
    ON social_schema.posts (author_id, published_at DESC, id DESC)
    WHERE status = 'published' AND group_id IS NULL AND visibility <> 'company';

-- Bài quyền `unit`: tìm theo phòng ban của tác giả.
CREATE INDEX IF NOT EXISTS idx_social_posts_unit_visibility
    ON social_schema.posts (author_unit_id, published_at DESC, id DESC)
    WHERE status = 'published' AND visibility = 'unit';

-- Danh sách chia sẻ của bài `custom`. principal_id là id người dùng hoặc id nút tổ chức (gồm nút con).
CREATE TABLE IF NOT EXISTS social_schema.post_audience (
    post_id        UUID NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    principal_type VARCHAR(4) NOT NULL CHECK (principal_type IN ('user', 'unit')),
    principal_id   UUID NOT NULL,
    PRIMARY KEY (post_id, principal_type, principal_id)
);

-- Tìm bài chia sẻ cho một người hoặc cho một phòng ban.
CREATE INDEX IF NOT EXISTS idx_social_post_audience_principal
    ON social_schema.post_audience (principal_type, principal_id, post_id);

-- ---------------------------------------------------------------------------
-- LỊCH SỬ CHỈNH SỬA: bản cũ lưu NGAY TRƯỚC khi bị ghi đè.
-- version 1 là bản gốc; bản hiện tại ở posts (version = edit_count + 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.post_edits (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id   UUID NOT NULL REFERENCES social_schema.posts(id) ON DELETE CASCADE,
    version   INTEGER NOT NULL CHECK (version >= 1),
    title     VARCHAR(200),
    body_html TEXT NOT NULL,
    -- Người sửa bản này thành bản kế tiếp.
    edited_by UUID NOT NULL,
    -- Thời điểm bản này bị thay thế.
    edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_social_post_edits_version UNIQUE (post_id, version)
);

CREATE INDEX IF NOT EXISTS idx_social_post_edits_post
    ON social_schema.post_edits (post_id, version DESC);

-- ---------------------------------------------------------------------------
-- BÁO CÁO nhóm / bài / bình luận (bảng chung)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_schema.reports (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('group', 'post', 'comment')),
    target_id   UUID NOT NULL,
    -- Nhóm chứa đối tượng (bản thân nhóm khi target_type = 'group'); NULL là Tường công ty.
    -- Dùng để định tuyến vào hàng đợi (moderator hay admin nhóm); không khoá ngoại để báo cáo còn lại khi xoá.
    group_id    UUID,
    -- Bài của bình luận hoặc chính bài; NULL với báo cáo nhóm.
    post_id     UUID,
    reporter_id UUID NOT NULL,
    reason      VARCHAR(500) NOT NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    handled_by  UUID,
    handled_at  TIMESTAMPTZ,
    handle_note VARCHAR(500),

    CONSTRAINT chk_social_reports_handled CHECK ((status = 'open') = (handled_by IS NULL))
);

-- Một người chỉ có một báo cáo đang mở cho mỗi đối tượng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_reports_open
    ON social_schema.reports (reporter_id, target_type, target_id) WHERE status = 'open';

-- Hàng đợi của moderator (mới nhất trước) và của admin nhóm.
CREATE INDEX IF NOT EXISTS idx_social_reports_open
    ON social_schema.reports (created_at DESC, id DESC) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_social_reports_group_open
    ON social_schema.reports (group_id, created_at DESC, id DESC) WHERE status = 'open' AND group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_reports_status
    ON social_schema.reports (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_social_reports_target
    ON social_schema.reports (target_type, target_id);
