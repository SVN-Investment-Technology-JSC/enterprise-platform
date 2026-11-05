-- Bán hàng (crm) · kho tài liệu CRM (GĐ C, P2C-01): loại tài liệu cấu hình theo tenant, thư mục lồng nhau,
-- tài liệu có phiên bản và khoá, gắn vào đối tượng CRM qua `entity_type` + `entity_id` (khách, lead, cơ hội,
-- báo giá, hợp đồng, đơn bán, bảo hành). Chỉ lưu siêu dữ liệu; tệp nằm trên S3/MinIO theo `object_key`.
-- Nạp sẵn bộ loại tài liệu mẫu (đã chốt cho luồng chào thầu).
-- Chạy lại được: CREATE ... IF NOT EXISTS, nạp mẫu bằng ON CONFLICT DO NOTHING.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- LOẠI TÀI LIỆU
--
-- Phân loại nghiệp vụ (không giới hạn loại file). `code` ổn định, là tham chiếu `ref` của điều kiện
-- chuyển giai đoạn DOCUMENT_TYPE; `active = false` là tắt: không chọn cho tài liệu mới, tài liệu cũ giữ.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.document_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(32) NOT NULL,
    name        VARCHAR(200) NOT NULL,
    description VARCHAR(500),
    active      BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID,

    CONSTRAINT uq_crm_document_types_code UNIQUE (code),
    CONSTRAINT ck_crm_document_types_name CHECK (btrim(name) <> '')
);

INSERT INTO crm_schema.document_types (code, name, sort_order) VALUES
    ('TENDER_DOSSIER',     'Hồ sơ mời thầu',       10),
    ('LEGAL_DOSSIER',      'Hồ sơ pháp lý',        20),
    ('ESTIMATE',           'Dự toán',              30),
    ('BUSINESS_PLAN',      'Phương án kinh doanh', 40),
    ('SAMPLE_CONTRACT',    'Hợp đồng mẫu',         50),
    ('SURVEY_MINUTES',     'Biên bản khảo sát',    60),
    ('ACCEPTANCE_MINUTES', 'Biên bản nghiệm thu',  70)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- THƯ MỤC
--
-- Thuộc một đối tượng; lồng nhau qua `parent_id`, `depth` từ 1 (gốc) tới độ sâu tối đa do ứng dụng kiểm.
-- Tên thư mục không phân biệt hoa thường và duy nhất trong cùng thư mục cha.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.document_folders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(24) NOT NULL,
    entity_id   UUID NOT NULL,
    parent_id   UUID REFERENCES crm_schema.document_folders (id) ON DELETE RESTRICT,
    name        VARCHAR(200) NOT NULL,
    depth       SMALLINT NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID NOT NULL,

    CONSTRAINT ck_crm_document_folders_entity_type CHECK (entity_type IN
        ('customer', 'lead', 'opportunity', 'quote', 'contract', 'sales_order', 'warranty_case')),
    CONSTRAINT ck_crm_document_folders_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_crm_document_folders_depth CHECK (depth >= 1)
);

CREATE INDEX IF NOT EXISTS ix_crm_document_folders_entity
    ON crm_schema.document_folders (entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_document_folders_name
    ON crm_schema.document_folders (entity_type, entity_id,
        COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- ---------------------------------------------------------------------------
-- TÀI LIỆU
--
-- `audience`: internal (nội bộ) hoặc customer (hồ sơ hướng ra khách). `current_version_no` rỗng cho tới khi
-- phiên bản đầu tải lên xong (xác nhận); từ đó là phiên bản đã xác nhận mới nhất. `locked_by_user_id` rỗng
-- = không khoá. `entity_id` không có khoá ngoại (nhiều bảng đích); ứng dụng kiểm đối tượng tồn tại và trong
-- phạm vi dữ liệu trước khi ghi.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.documents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type        VARCHAR(24) NOT NULL,
    entity_id          UUID NOT NULL,
    folder_id          UUID REFERENCES crm_schema.document_folders (id) ON DELETE RESTRICT,
    document_type_id   UUID REFERENCES crm_schema.document_types (id) ON DELETE RESTRICT,
    name               VARCHAR(255) NOT NULL,
    description        VARCHAR(1000),
    audience           VARCHAR(8) NOT NULL DEFAULT 'internal',
    current_version_no INTEGER,
    locked_by_user_id  UUID,
    locked_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by         UUID,

    CONSTRAINT ck_crm_documents_entity_type CHECK (entity_type IN
        ('customer', 'lead', 'opportunity', 'quote', 'contract', 'sales_order', 'warranty_case')),
    CONSTRAINT ck_crm_documents_audience CHECK (audience IN ('internal', 'customer')),
    CONSTRAINT ck_crm_documents_name CHECK (btrim(name) <> ''),
    CONSTRAINT ck_crm_documents_lock CHECK ((locked_by_user_id IS NULL) = (locked_at IS NULL))
);

-- Danh sách theo đối tượng (tab Tài liệu) và kiểm điều kiện DOCUMENT_TYPE theo loại.
CREATE INDEX IF NOT EXISTS ix_crm_documents_entity
    ON crm_schema.documents (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_documents_entity_type_id
    ON crm_schema.documents (entity_type, entity_id, document_type_id);
CREATE INDEX IF NOT EXISTS ix_crm_documents_folder
    ON crm_schema.documents (folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_documents_type
    ON crm_schema.documents (document_type_id) WHERE document_type_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PHIÊN BẢN
--
-- Mỗi lần tải lên một dòng. `object_key` duy nhất (khoá object trên S3, sinh ở máy chủ, không chứa tên file
-- thô của người dùng). `size_bytes` và `uploaded_at` rỗng cho tới khi xác nhận tải lên xong;
-- `declared_size_bytes` là dung lượng người dùng khai lúc xin URL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.document_versions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id         UUID NOT NULL REFERENCES crm_schema.documents (id) ON DELETE CASCADE,
    version_no          INTEGER NOT NULL,
    object_key          VARCHAR(512) NOT NULL,
    file_name           VARCHAR(255) NOT NULL,
    content_type        VARCHAR(127) NOT NULL,
    declared_size_bytes BIGINT,
    size_bytes          BIGINT,
    change_note         VARCHAR(500),
    uploaded_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID NOT NULL,

    CONSTRAINT uq_crm_document_versions_object_key UNIQUE (object_key),
    CONSTRAINT uq_crm_document_versions_no UNIQUE (document_id, version_no),
    CONSTRAINT ck_crm_document_versions_no CHECK (version_no >= 1),
    CONSTRAINT ck_crm_document_versions_size CHECK (size_bytes IS NULL OR size_bytes >= 0)
);
