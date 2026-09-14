SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Tài liệu, hình ảnh, biên bản hiện trường đính kèm theo phiếu bảo trì / sự cố.
-- Tách riêng và tự chủ trong maintenance_schema, chuẩn Multi-tenant SaaS:
-- Khách hàng không cần mua hoặc bật module Quy trình vẫn lưu trữ và xem tệp bình thường.
CREATE TABLE IF NOT EXISTS maintenance_schema.occurrence_attachments (
    id           UUID PRIMARY KEY,
    occurrence_id UUID NOT NULL REFERENCES maintenance_schema.occurrences(id) ON DELETE CASCADE,
    object_key   TEXT NOT NULL UNIQUE,
    file_name    VARCHAR(255) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes   BIGINT,
    note         TEXT,
    uploaded_by  UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_occurrence_attachments_occurrence
    ON maintenance_schema.occurrence_attachments (occurrence_id, created_at DESC);
