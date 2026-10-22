SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ · NHÓM (P2)
--
-- Nhóm công khai hoặc riêng tư, thành viên có vai trò, yêu cầu tham gia.
-- Cột người dùng là id người dùng của tenant, không có khoá ngoại sang schema khác.
-- Chỉ THÊM: không đụng bảng của 0001.
-- ===========================================================================

-- Hàm gập chữ để tìm kiếm không phân biệt hoa thường và dấu tiếng Việt. Không dùng
-- extension `unaccent` (cần quyền cài extension; xem postgres-notification-store.ts).
-- Bảng ký tự trùng SEARCH_TRANSLATE_FROM/TO của contracts-realtime, kèm chữ hoa vì
-- lower() của PostgreSQL không đổi chữ hoa ngoài ASCII khi DB dùng locale C.
CREATE OR REPLACE FUNCTION social_schema.fold_text(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fold$
    SELECT lower(translate(
        coalesce(input, ''),
        'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ',
        'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydaaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'
    ))
$fold$;

CREATE TABLE IF NOT EXISTS social_schema.groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(80) NOT NULL,
    description VARCHAR(500),
    privacy     VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'private')),
    -- Khoá màu và biểu tượng bìa; bảng giá trị hợp lệ ở contracts-social, kiểm ở tầng ứng dụng.
    color       VARCHAR(20) NOT NULL DEFAULT 'blue',
    icon        VARCHAR(30) NOT NULL DEFAULT 'users',
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Xoá mềm; bài của nhóm đã xoá không còn ai thấy.
    deleted_at  TIMESTAMPTZ,
    deleted_by  UUID,
    search_text TEXT GENERATED ALWAYS AS (
        social_schema.fold_text(name || ' ' || coalesce(description, ''))
    ) STORED,

    CONSTRAINT chk_social_groups_deleted CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

-- Tên nhóm đang hoạt động không trùng nhau (không phân biệt hoa thường).
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_groups_name
    ON social_schema.groups (lower(name)) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_social_groups_listing
    ON social_schema.groups (created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS social_schema.group_members (
    group_id  UUID NOT NULL REFERENCES social_schema.groups(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL,
    role      VARCHAR(10) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Người thêm vào; NULL khi tự tham gia nhóm công khai hoặc là người tạo nhóm.
    added_by  UUID,
    PRIMARY KEY (group_id, user_id)
);

-- "Nhóm của bạn" và lọc bài theo nhóm tôi tham gia.
CREATE INDEX IF NOT EXISTS idx_social_group_members_user
    ON social_schema.group_members (user_id, group_id);

CREATE INDEX IF NOT EXISTS idx_social_group_members_admin
    ON social_schema.group_members (group_id) WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS social_schema.group_join_requests (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   UUID NOT NULL REFERENCES social_schema.groups(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    message    VARCHAR(300),
    status     VARCHAR(10) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by UUID,
    decided_at TIMESTAMPTZ,

    CONSTRAINT chk_social_join_requests_decided CHECK ((status = 'pending') = (decided_at IS NULL))
);

-- Mỗi người chỉ có một yêu cầu đang chờ cho mỗi nhóm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_join_requests_pending
    ON social_schema.group_join_requests (group_id, user_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_social_join_requests_group
    ON social_schema.group_join_requests (group_id, created_at, id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_social_join_requests_user
    ON social_schema.group_join_requests (user_id, created_at DESC) WHERE status = 'pending';
