-- Kho lưu trữ ngoài của tenant (NAS, MinIO, S3, R2…): khi bật, tệp mới của Tài liệu chung lưu vào kho do
-- tenant tự cấu hình thay vì kho của nền tảng.
-- `document_versions.storage_location` ghi mỗi phiên bản đang nằm ở đâu. Dòng cũ nhận mặc định 'platform',
-- đúng nơi tệp đang lưu, nên bản app cũ vẫn chạy được với schema mới.
-- `storage_settings` chỉ có một dòng. Khoá bí mật lưu dạng đã mã hoá (AES-256-GCM, khoá của máy chủ ở biến
-- môi trường `SHARED_STORAGE_SECRET_KEY`); cơ sở dữ liệu không giữ khoá rõ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE shared_schema.document_versions
    ADD COLUMN IF NOT EXISTS storage_location VARCHAR(20) NOT NULL DEFAULT 'platform';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_shared_versions_storage_location'
           AND conrelid = 'shared_schema.document_versions'::regclass
    ) THEN
        ALTER TABLE shared_schema.document_versions
            ADD CONSTRAINT chk_shared_versions_storage_location
            CHECK (storage_location IN ('platform', 'external'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS shared_schema.storage_settings (
    id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled           BOOLEAN NOT NULL DEFAULT false,
    label             VARCHAR(120) NOT NULL DEFAULT '',
    access_mode       VARCHAR(20) NOT NULL DEFAULT 'proxy' CHECK (access_mode IN ('proxy', 'direct')),
    endpoint          VARCHAR(500) NOT NULL,
    public_endpoint   VARCHAR(500),
    region            VARCHAR(64) NOT NULL DEFAULT 'us-east-1',
    bucket            VARCHAR(63) NOT NULL,
    path_style        BOOLEAN NOT NULL DEFAULT true,
    access_key_id     VARCHAR(255) NOT NULL,
    secret_ciphertext TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1,
    updated_by        UUID NOT NULL,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
