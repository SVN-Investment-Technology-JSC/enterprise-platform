-- Kết nối NAS: Tài liệu chung hiện thẳng các thư mục chia sẻ của NAS công ty (ánh xạ, không sao chép tệp).
-- `nas_connection` một dòng: địa chỉ NAS, tài khoản dịch vụ (mật khẩu đã mã hoá như khoá kho ngoài), các thư
-- mục chia sẻ được ánh xạ, chu kỳ đồng bộ.
-- `nas_accounts`, `nas_groups`, `nas_share_permissions`: bản sao người dùng, nhóm, quyền thư mục chia sẻ đọc từ
-- NAS theo chu kỳ; NAS là gốc, ERP chỉ đọc. Ghép tài khoản NAS với nhân sự ERP nằm ở `nas_accounts.erp_user_id`;
-- ghép tay (`manual`) không bị lượt đồng bộ ghi đè.
-- `nas_access_logs`: ai xem, tải, tải lên, đổi tên, xoá gì trên NAS qua ERP. Bảng mới, không đụng dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS shared_schema.nas_connection (
    id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled           BOOLEAN NOT NULL DEFAULT false,
    label             VARCHAR(120) NOT NULL DEFAULT '',
    provider          VARCHAR(20) NOT NULL DEFAULT 'synology' CHECK (provider IN ('synology')),
    base_url          VARCHAR(500) NOT NULL,
    username          VARCHAR(255) NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    shares            JSONB NOT NULL DEFAULT '[]'::jsonb,
    sync_minutes      INTEGER NOT NULL DEFAULT 15 CHECK (sync_minutes BETWEEN 5 AND 1440),
    last_sync_at      TIMESTAMPTZ,
    last_sync_ok      BOOLEAN,
    last_sync_message VARCHAR(500),
    version           INTEGER NOT NULL DEFAULT 1,
    updated_by        UUID NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shared_schema.nas_accounts (
    name        VARCHAR(255) PRIMARY KEY,
    description VARCHAR(500) NOT NULL DEFAULT '',
    email       VARCHAR(255),
    disabled    BOOLEAN NOT NULL DEFAULT false,
    groups      TEXT[] NOT NULL DEFAULT '{}',
    erp_user_id UUID,
    link_source VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (link_source IN ('none', 'auto', 'manual')),
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Một nhân sự ERP ghép với nhiều nhất một tài khoản NAS.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_nas_accounts_erp_user
    ON shared_schema.nas_accounts (erp_user_id)
    WHERE erp_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS shared_schema.nas_groups (
    name        VARCHAR(255) PRIMARY KEY,
    description VARCHAR(500) NOT NULL DEFAULT '',
    members     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shared_schema.nas_share_permissions (
    share_name     VARCHAR(255) NOT NULL,
    principal_type VARCHAR(10) NOT NULL CHECK (principal_type IN ('user', 'group')),
    principal_name VARCHAR(255) NOT NULL,
    rule           VARCHAR(10) NOT NULL CHECK (rule IN ('deny', 'read', 'write')),
    PRIMARY KEY (share_name, principal_type, principal_name)
);

CREATE TABLE IF NOT EXISTS shared_schema.nas_access_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_name VARCHAR(255) NOT NULL,
    path       TEXT NOT NULL,
    action     VARCHAR(20) NOT NULL
                 CHECK (action IN ('view', 'download', 'upload', 'create_folder', 'rename', 'delete')),
    detail     TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_nas_access_logs_created
    ON shared_schema.nas_access_logs (created_at DESC);
