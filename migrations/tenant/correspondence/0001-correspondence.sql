-- Phân hệ Văn thư: sổ công văn đến, danh mục và quy trình duyệt do tenant cấu hình, các bước duyệt của
-- từng công văn, phòng ban được giao, tệp, nhật ký, bộ đếm số và cấu hình sổ. Luồng duyệt nằm trong phân
-- hệ (không qua Quy trình). Tệp nằm ở kho tài liệu của Hệ dùng chung; `attachments` chỉ giữ id tài liệu.
-- Phân hệ mới nên chưa có dữ liệu cũ; dữ liệu mặc định (danh mục, quy trình) ghi bằng ON CONFLICT DO NOTHING.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS correspondence_schema;

-- Danh mục cấu hình được: loại văn bản, độ khẩn, độ mật. Công văn giữ `code`; mục đã dùng chỉ ngừng dùng.
CREATE TABLE IF NOT EXISTS correspondence_schema.catalog_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind             VARCHAR(30)  NOT NULL CHECK (kind IN ('letter_type', 'urgency', 'confidentiality')),
    code             VARCHAR(40)  NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
    name             VARCHAR(120) NOT NULL,
    sort_order       INTEGER      NOT NULL DEFAULT 0,
    is_active        BOOLEAN      NOT NULL DEFAULT true,
    -- Loại văn bản: hạn mặc định (ngày) và quy trình duyệt mặc định.
    default_due_days INTEGER CHECK (default_due_days IS NULL OR default_due_days BETWEEN 0 AND 365),
    workflow_id      UUID,
    -- Độ khẩn: tô đỏ. Độ mật: chỉ người liên quan thấy.
    highlight        BOOLEAN      NOT NULL DEFAULT false,
    restricted       BOOLEAN      NOT NULL DEFAULT false,
    updated_by       UUID,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_correspondence_catalog_code UNIQUE (kind, code)
);

-- Quy trình duyệt. `steps` là mảng bước (tên, loại direct/approve, luật người duyệt); công văn chép lại các
-- bước lúc trình nên sửa quy trình không đổi công văn đang chạy.
CREATE TABLE IF NOT EXISTS correspondence_schema.workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(160) NOT NULL,
    description TEXT,
    is_active   BOOLEAN      NOT NULL DEFAULT true,
    is_default  BOOLEAN      NOT NULL DEFAULT false,
    steps       JSONB        NOT NULL CHECK (jsonb_typeof(steps) = 'array'),
    updated_by  UUID,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Một quy trình mặc định.
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_workflows_default
    ON correspondence_schema.workflows ((true)) WHERE is_default;

-- Bộ đếm số đến, số đi, số hồ sơ theo năm; cấp bằng UPSERT ... RETURNING trong cùng transaction.
CREATE TABLE IF NOT EXISTS correspondence_schema.counters (
    kind  VARCHAR(20) NOT NULL CHECK (kind IN ('incoming', 'outgoing', 'archive')),
    year  SMALLINT    NOT NULL,
    value INTEGER     NOT NULL DEFAULT 0 CHECK (value >= 0),
    PRIMARY KEY (kind, year)
);

CREATE TABLE IF NOT EXISTS correspondence_schema.letters (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year             SMALLINT      NOT NULL,
    seq              INTEGER       NOT NULL CHECK (seq > 0),
    incoming_no      VARCHAR(60)   NOT NULL,
    received_on      DATE          NOT NULL,
    sender_org       VARCHAR(255)  NOT NULL,
    sender_ref       VARCHAR(120),
    sender_date      DATE,
    subject          VARCHAR(1000) NOT NULL,
    -- Mã trong danh mục (catalog_items.code theo từng kind).
    kind             VARCHAR(40)   NOT NULL,
    urgency          VARCHAR(40)   NOT NULL,
    confidentiality  VARCHAR(40)   NOT NULL,
    due_on           DATE,
    stage            VARCHAR(20)   NOT NULL DEFAULT 'received'
                       CHECK (stage IN ('received', 'registered', 'reviewing', 'directing', 'processing',
                                        'publishing', 'closing', 'archived', 'cancelled')),
    workflow_id      UUID,
    workflow_name    VARCHAR(160),
    -- Người đã chỉ đạo (bước direct), để luật "người đã chỉ đạo" của các bước sau dùng.
    director_user_id UUID,
    instruction      TEXT,
    outgoing_year    SMALLINT,
    outgoing_seq     INTEGER,
    outgoing_no      VARCHAR(60),
    published_on     DATE,
    recipient        VARCHAR(255),
    archive_year     SMALLINT,
    archive_seq      INTEGER,
    archive_code     VARCHAR(60),
    archived_on      DATE,
    cancel_reason    TEXT,
    -- Thư mục hồ sơ bên Hệ dùng chung (shared_schema.folders); không có khoá ngoại vì khác schema.
    shared_folder_id UUID,
    received_by      UUID          NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT uq_correspondence_letters_seq UNIQUE (year, seq),
    CONSTRAINT chk_correspondence_letters_outgoing CHECK ((outgoing_no IS NULL) = (outgoing_seq IS NULL)),
    CONSTRAINT chk_correspondence_letters_archive CHECK ((archive_code IS NULL) = (archive_seq IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_outgoing
    ON correspondence_schema.letters (outgoing_year, outgoing_seq) WHERE outgoing_seq IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_archive
    ON correspondence_schema.letters (archive_year, archive_seq) WHERE archive_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_stage
    ON correspondence_schema.letters (stage, due_on);
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_received
    ON correspondence_schema.letters (received_on DESC, seq DESC);

-- Các bước của quy trình trên từng công văn. `assignee_user_ids` giải theo sơ đồ tổ chức lúc bước bắt đầu;
-- `chosen_user_id` là người được chọn trước khi bước luật `choose` bắt đầu.
CREATE TABLE IF NOT EXISTS correspondence_schema.letter_steps (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    letter_id         UUID         NOT NULL REFERENCES correspondence_schema.letters(id) ON DELETE CASCADE,
    seq               SMALLINT     NOT NULL CHECK (seq >= 1),
    name              VARCHAR(160) NOT NULL,
    kind              VARCHAR(20)  NOT NULL CHECK (kind IN ('direct', 'approve')),
    approver          JSONB        NOT NULL,
    due_days          INTEGER,
    status            VARCHAR(20)  NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting', 'active', 'done', 'skipped')),
    chosen_user_id    UUID,
    assignee_user_ids UUID[]       NOT NULL DEFAULT '{}',
    activated_at      TIMESTAMPTZ,
    acted_by          UUID,
    acted_at          TIMESTAMPTZ,
    decision          VARCHAR(20) CHECK (decision IN ('approved', 'directed', 'closed', 'returned', 'revision')),
    note              TEXT,

    CONSTRAINT uq_correspondence_letter_steps_seq UNIQUE (letter_id, seq)
);

-- Mỗi công văn tối đa một bước đang chạy.
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letter_steps_active
    ON correspondence_schema.letter_steps (letter_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_correspondence_letter_steps_assignees
    ON correspondence_schema.letter_steps USING gin (assignee_user_ids) WHERE status = 'active';

-- Phòng ban được giao xử lý. Một dòng cho mỗi (công văn, đơn vị); yêu cầu sửa thì tăng `round`.
CREATE TABLE IF NOT EXISTS correspondence_schema.assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    letter_id       UUID         NOT NULL REFERENCES correspondence_schema.letters(id) ON DELETE CASCADE,
    unit_id         UUID         NOT NULL,
    unit_name       VARCHAR(255) NOT NULL,
    round           INTEGER      NOT NULL DEFAULT 1 CHECK (round >= 1),
    status          VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted')),
    response_note   TEXT,
    submitted_by    UUID,
    submitted_at    TIMESTAMPTZ,
    revision_reason TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_correspondence_assignments_unit UNIQUE (letter_id, unit_id),
    CONSTRAINT chk_correspondence_assignments_submitted CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_correspondence_assignments_unit
    ON correspondence_schema.assignments (unit_id, status);

CREATE TABLE IF NOT EXISTS correspondence_schema.attachments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    letter_id          UUID         NOT NULL REFERENCES correspondence_schema.letters(id) ON DELETE CASCADE,
    kind               VARCHAR(20)  NOT NULL CHECK (kind IN ('incoming', 'draft', 'outgoing', 'reference')),
    assignment_id      UUID REFERENCES correspondence_schema.assignments(id) ON DELETE SET NULL,
    shared_document_id UUID         NOT NULL,
    shared_version_id  UUID         NOT NULL,
    file_name          VARCHAR(255) NOT NULL,
    content_type       VARCHAR(160) NOT NULL,
    size_bytes         BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    uploaded_by        UUID         NOT NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correspondence_attachments_letter
    ON correspondence_schema.attachments (letter_id, created_at);

CREATE TABLE IF NOT EXISTS correspondence_schema.history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    letter_id     UUID         NOT NULL REFERENCES correspondence_schema.letters(id) ON DELETE CASCADE,
    action        VARCHAR(40)  NOT NULL,
    summary       VARCHAR(500) NOT NULL,
    note          TEXT,
    actor_user_id UUID,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correspondence_history_letter
    ON correspondence_schema.history (letter_id, created_at);

CREATE TABLE IF NOT EXISTS correspondence_schema.settings (
    key        VARCHAR(80) PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------------
-- Dữ liệu mặc định. Tenant sửa, thêm, ngừng dùng ở trang Cấu hình; chạy lại migration không ghi đè.
-- ---------------------------------------------------------------------------------------------------

-- Quy trình mặc định như văn thư thường làm: người trình chọn lãnh đạo chỉ đạo, lãnh đạo giao phòng ban,
-- trưởng các phòng được giao kiểm tra, rồi chính lãnh đạo đã chỉ đạo duyệt và ký.
INSERT INTO correspondence_schema.workflows (id, name, description, is_default, steps)
VALUES (
    'c0000000-0000-4000-8000-000000000001',
    'Quy trình mặc định',
    'Lãnh đạo chỉ đạo, phòng ban xử lý, trưởng phòng kiểm tra, lãnh đạo duyệt và ký.',
    true,
    '[
      {"key": "direct", "name": "Lãnh đạo chỉ đạo", "kind": "direct", "approver": {"type": "choose", "pool": "leaders"}},
      {"key": "unit-check", "name": "Trưởng phòng kiểm tra", "kind": "approve", "approver": {"type": "assigned_unit_heads"}},
      {"key": "sign", "name": "Lãnh đạo duyệt và ký", "kind": "approve", "approver": {"type": "director"}}
    ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO correspondence_schema.catalog_items (kind, code, name, sort_order, highlight, restricted)
VALUES
    ('letter_type', 'directive', 'Chỉ đạo – điều hành', 10, false, false),
    ('letter_type', 'commercial', 'Hợp đồng – thương mại', 20, false, false),
    ('letter_type', 'finance', 'Tài chính – thuế', 30, false, false),
    ('letter_type', 'technical', 'Kỹ thuật – dự án', 40, false, false),
    ('letter_type', 'legal', 'Pháp lý', 50, false, false),
    ('letter_type', 'other', 'Khác', 90, false, false),
    ('urgency', 'normal', 'Thường', 10, false, false),
    ('urgency', 'urgent', 'Khẩn', 20, true, false),
    ('urgency', 'flash', 'Hỏa tốc', 30, true, false),
    ('confidentiality', 'normal', 'Thường', 10, false, false),
    ('confidentiality', 'confidential', 'Mật', 20, false, true)
ON CONFLICT (kind, code) DO NOTHING;
