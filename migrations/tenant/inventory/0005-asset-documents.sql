SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Tài liệu đính kèm theo thiết bị: hướng dẫn vận hành, phiếu bảo hành, biên bản
-- nghiệm thu. Bảng chỉ giữ SIÊU DỮ LIỆU; nội dung tệp nằm trong object storage
-- và được truy cập bằng URL ký trước, giống hệt cách Quy trình lưu đính kèm.
--
-- `object_key` UNIQUE để một khoá không bị hai bản ghi cùng trỏ tới; xoá bản ghi
-- không xoá object, việc dọn kho lưu trữ làm riêng.
CREATE TABLE IF NOT EXISTS inventory_schema.asset_documents (
    id           UUID PRIMARY KEY,
    asset_id     UUID NOT NULL REFERENCES inventory_schema.assets(id) ON DELETE CASCADE,
    object_key   TEXT NOT NULL UNIQUE,
    file_name    VARCHAR(255) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes   BIGINT,
    note         TEXT,
    uploaded_by  UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_documents_asset
    ON inventory_schema.asset_documents (asset_id, created_at DESC);
