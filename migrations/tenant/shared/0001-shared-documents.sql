SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- HỆ DÙNG CHUNG · TÀI LIỆU CÔNG TY
--
-- Kho tài liệu cấp công ty, tách hẳn khỏi tài liệu dự án của Workspace
-- (`workspace_schema`). Hai kho không chia sẻ dòng nào: muốn đưa tệp dự án
-- vào kho công ty thì lưu một bản sao, ghi nguồn ở `source_label`.
-- ===========================================================================
CREATE SCHEMA IF NOT EXISTS shared_schema;

-- ---------------------------------------------------------------------------
-- CÂY THƯ MỤC
--
-- Tối đa 6 cấp (depth 0..5). Một thư mục có thể là "hồ sơ" — thư mục hợp
-- đồng mang số hợp đồng, đối tác, hạn hiệu lực — nên các cột thông tin hồ sơ
-- có ở cả thư mục lẫn tài liệu.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shared_schema.folders (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RESTRICT: xoá nhầm một thư mục gốc không được kéo theo cả nhánh.
    parent_id    UUID REFERENCES shared_schema.folders(id) ON DELETE RESTRICT,
    name         VARCHAR(180) NOT NULL,
    depth        SMALLINT NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5),
    doc_kind     VARCHAR(40),
    doc_number   VARCHAR(120),
    partner      VARCHAR(255),
    issued_on    DATE,
    effective_to DATE,
    note         TEXT,
    -- Ẩn thay cho xoá; tầng ứng dụng chỉ ẩn thư mục rỗng.
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_shared_folders_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Tên không trùng giữa các thư mục anh em đang dùng (không phân biệt hoa thường).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_folders_active_name
    ON shared_schema.folders (
        COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
        lower(name)
    )
    WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_shared_folders_parent
    ON shared_schema.folders (parent_id);

-- ---------------------------------------------------------------------------
-- TÀI LIỆU
--
-- Một dòng là MỘT TÀI LIỆU LOGIC; nội dung tệp ở `document_versions`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shared_schema.documents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id          UUID NOT NULL REFERENCES shared_schema.folders(id) ON DELETE RESTRICT,
    name               VARCHAR(255) NOT NULL,
    description        TEXT,
    doc_kind           VARCHAR(40),
    doc_number         VARCHAR(120),
    partner            VARCHAR(255),
    issued_on          DATE,
    effective_from     DATE,
    effective_to       DATE,
    confidentiality    VARCHAR(20) NOT NULL DEFAULT 'internal'
                         CHECK (confidentiality IN ('internal','restricted','confidential')),
    tags               TEXT[] NOT NULL DEFAULT '{}',
    -- Bản sao lưu từ phân hệ khác: ghi nhãn nguồn, không có khoá ngoại.
    source_label       VARCHAR(255),
    current_version_id UUID,
    status             VARCHAR(20) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','archived')),
    locked_by_user_id  UUID,
    locked_at          TIMESTAMPTZ,
    created_by         UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_shared_documents_lock_pair
        CHECK ((locked_by_user_id IS NULL) = (locked_at IS NULL)),
    CONSTRAINT chk_shared_documents_effective_range
        CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_documents_active_name
    ON shared_schema.documents (folder_id, lower(name))
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_shared_documents_folder
    ON shared_schema.documents (folder_id, status);

-- Trang Tổng quan đọc "sắp hết hiệu lực" liên tục.
CREATE INDEX IF NOT EXISTS idx_shared_documents_effective_to
    ON shared_schema.documents (effective_to)
    WHERE status = 'active' AND effective_to IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PHIÊN BẢN
--
-- Bất biến: không sửa, không xoá. `size_bytes` rỗng = CHƯA TẢI LÊN XONG.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shared_schema.document_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID NOT NULL REFERENCES shared_schema.documents(id) ON DELETE CASCADE,
    version_no   INTEGER NOT NULL CHECK (version_no >= 1),
    storage_key  TEXT NOT NULL UNIQUE,
    file_name    VARCHAR(255) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes   BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    change_note  VARCHAR(500),
    uploaded_by  UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (document_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_shared_versions_document
    ON shared_schema.document_versions (document_id, version_no DESC);

-- ---------------------------------------------------------------------------
-- NHẬT KÝ TRUY CẬP — chỉ ghi thêm.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shared_schema.document_access_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES shared_schema.documents(id) ON DELETE CASCADE,
    version_id  UUID REFERENCES shared_schema.document_versions(id) ON DELETE SET NULL,
    action      VARCHAR(32) NOT NULL
                  CHECK (action IN ('view','download','upload','update','move','lock','unlock','archive','restore')),
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_access_document
    ON shared_schema.document_access_logs (document_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- KHOÁ NGOẠI VÒNG TRÒN — tạo tài liệu kèm phiên bản đầu trong MỘT transaction.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_shared_documents_current_version'
    ) THEN
        ALTER TABLE shared_schema.documents
            ADD CONSTRAINT fk_shared_documents_current_version
            FOREIGN KEY (current_version_id)
            REFERENCES shared_schema.document_versions(id)
            ON DELETE SET NULL
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END
$$;
