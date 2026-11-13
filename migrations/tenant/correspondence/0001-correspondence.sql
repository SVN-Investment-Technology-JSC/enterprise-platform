-- Phân hệ Văn thư: sổ công văn đến, phòng ban được giao, tệp của hồ sơ, nhật ký xử lý, bộ đếm số và cấu hình.
-- Luồng duyệt nằm trong phân hệ (không qua Quy trình). Tệp nằm ở kho tài liệu của Hệ dùng chung; bảng
-- `attachments` chỉ giữ id tài liệu bên đó. Phân hệ mới nên chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS correspondence_schema;

-- Bộ đếm số đến, số đi, số hồ sơ lưu trữ theo năm. Cấp số bằng UPSERT ... RETURNING trong cùng transaction
-- với dòng công văn, nên hai người vào sổ cùng lúc không trùng số.
CREATE TABLE IF NOT EXISTS correspondence_schema.counters (
    kind       VARCHAR(20) NOT NULL CHECK (kind IN ('incoming', 'outgoing', 'archive')),
    year       SMALLINT    NOT NULL,
    value      INTEGER     NOT NULL DEFAULT 0 CHECK (value >= 0),
    PRIMARY KEY (kind, year)
);

CREATE TABLE IF NOT EXISTS correspondence_schema.letters (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year             SMALLINT     NOT NULL,
    seq              INTEGER      NOT NULL CHECK (seq > 0),
    incoming_no      VARCHAR(60)  NOT NULL,
    received_on      DATE         NOT NULL,
    sender_org       VARCHAR(255) NOT NULL,
    sender_ref       VARCHAR(120),
    sender_date      DATE,
    subject          VARCHAR(1000) NOT NULL,
    kind             VARCHAR(20)  NOT NULL DEFAULT 'other'
                       CHECK (kind IN ('directive', 'commercial', 'finance', 'technical', 'legal', 'other')),
    urgency          VARCHAR(20)  NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'urgent', 'flash')),
    confidentiality  VARCHAR(20)  NOT NULL DEFAULT 'normal' CHECK (confidentiality IN ('normal', 'confidential')),
    due_on           DATE,
    stage            VARCHAR(20)  NOT NULL DEFAULT 'received'
                       CHECK (stage IN ('received', 'registered', 'directing', 'processing', 'reviewing',
                                        'publishing', 'closing', 'archived', 'cancelled')),
    -- Lãnh đạo được trình (người giữ quyền correspondence.letter.direct).
    leader_user_id   UUID,
    instruction      TEXT,
    approval_note    TEXT,
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
    received_by      UUID         NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT uq_correspondence_letters_seq UNIQUE (year, seq),
    CONSTRAINT chk_correspondence_letters_outgoing
        CHECK ((outgoing_no IS NULL) = (outgoing_seq IS NULL)),
    CONSTRAINT chk_correspondence_letters_archive
        CHECK ((archive_code IS NULL) = (archive_seq IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_outgoing
    ON correspondence_schema.letters (outgoing_year, outgoing_seq) WHERE outgoing_seq IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_archive
    ON correspondence_schema.letters (archive_year, archive_seq) WHERE archive_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_stage
    ON correspondence_schema.letters (stage, due_on);
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_leader
    ON correspondence_schema.letters (leader_user_id) WHERE leader_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_received
    ON correspondence_schema.letters (received_on DESC, seq DESC);

-- Phòng ban được lãnh đạo giao xử lý. Một dòng cho mỗi (công văn, đơn vị); yêu cầu sửa dự thảo thì tăng
-- `round` và đưa về `pending`, ý kiến cũ còn trong nhật ký.
CREATE TABLE IF NOT EXISTS correspondence_schema.assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    letter_id       UUID         NOT NULL REFERENCES correspondence_schema.letters(id) ON DELETE CASCADE,
    -- Node đơn vị của sơ đồ tổ chức (Tenant Core); tên chụp lại lúc giao.
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
    CONSTRAINT chk_correspondence_assignments_submitted
        CHECK ((status = 'submitted') = (submitted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_correspondence_assignments_unit
    ON correspondence_schema.assignments (unit_id, status);

-- Tệp của hồ sơ. Nội dung là tài liệu của Hệ dùng chung; `size_bytes` rỗng là chưa tải lên xong.
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

-- Nhật ký xử lý, chỉ ghi thêm. `actor_user_id` rỗng là hệ thống tự làm.
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
