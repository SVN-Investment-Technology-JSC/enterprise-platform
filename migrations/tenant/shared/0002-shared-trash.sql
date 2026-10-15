SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- HỆ DÙNG CHUNG · THÙNG RÁC
--
-- Xoá tài liệu hay thư mục là chuyển vào Thùng rác: dòng vẫn còn, chỉ gắn
-- `deleted_at`. Khôi phục xoá dấu này; "xoá vĩnh viễn" mới xoá dòng và tệp.
--
-- `deleted_batch` gom những gì bị xoá cùng một lượt. Xoá một thư mục kéo theo
-- cả nhánh: thư mục gốc của lượt có `deleted_batch = id`, mọi thư mục con và
-- tài liệu bên trong mang cùng giá trị đó để khôi phục hay xoá vĩnh viễn một
-- lần. Tài liệu xoá riêng lẻ có `deleted_batch` rỗng.
-- ===========================================================================

ALTER TABLE shared_schema.folders
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS deleted_batch UUID;

ALTER TABLE shared_schema.documents
    ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by    UUID,
    ADD COLUMN IF NOT EXISTS deleted_batch UUID;

DO $$
BEGIN
    -- Thư mục trong Thùng rác không còn "đang dùng".
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_shared_folders_trash') THEN
        ALTER TABLE shared_schema.folders
            ADD CONSTRAINT chk_shared_folders_trash
            CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)
                   AND (deleted_at IS NULL OR NOT is_active)
                   AND (deleted_batch IS NULL OR deleted_at IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_shared_documents_trash') THEN
        ALTER TABLE shared_schema.documents
            ADD CONSTRAINT chk_shared_documents_trash
            CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)
                   AND (deleted_batch IS NULL OR deleted_at IS NOT NULL));
    END IF;
END
$$;

-- Tài liệu trong Thùng rác không giữ chỗ tên của thư mục cũ.
DROP INDEX IF EXISTS shared_schema.uq_shared_documents_active_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_documents_active_name
    ON shared_schema.documents (folder_id, lower(name))
    WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shared_documents_trash
    ON shared_schema.documents (deleted_at DESC)
    WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shared_documents_deleted_batch
    ON shared_schema.documents (deleted_batch)
    WHERE deleted_batch IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shared_folders_deleted_batch
    ON shared_schema.folders (deleted_batch)
    WHERE deleted_batch IS NOT NULL;

-- Nhật ký truy cập thêm hành động "delete". Ràng buộc cũ do PostgreSQL tự đặt
-- tên nên tìm theo nội dung thay vì theo tên.
DO $$
DECLARE
    old_constraint TEXT;
BEGIN
    FOR old_constraint IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'shared_schema.document_access_logs'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%archive%'
    LOOP
        EXECUTE format('ALTER TABLE shared_schema.document_access_logs DROP CONSTRAINT %I', old_constraint);
    END LOOP;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_shared_access_logs_action') THEN
        ALTER TABLE shared_schema.document_access_logs
            ADD CONSTRAINT chk_shared_access_logs_action
            CHECK (action IN ('view','download','upload','update','move','lock','unlock','archive','restore','delete'));
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- NHẬT KÝ XOÁ VĨNH VIỄN — chỉ ghi thêm.
--
-- Xoá vĩnh viễn xoá luôn tài liệu và nhật ký truy cập của nó, nên một dòng
-- còn lại ở đây là dấu vết duy nhất: cái gì, ở đâu, bao nhiêu, ai xoá.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shared_schema.purge_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind           VARCHAR(16) NOT NULL CHECK (kind IN ('folder', 'document')),
    name           VARCHAR(255) NOT NULL,
    location       TEXT NOT NULL DEFAULT '',
    document_count INTEGER NOT NULL DEFAULT 0,
    version_count  INTEGER NOT NULL DEFAULT 0,
    total_bytes    BIGINT NOT NULL DEFAULT 0,
    deleted_by     UUID,
    deleted_at     TIMESTAMPTZ,
    purged_by      UUID NOT NULL,
    purged_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_purge_log_time
    ON shared_schema.purge_log (purged_at DESC);
