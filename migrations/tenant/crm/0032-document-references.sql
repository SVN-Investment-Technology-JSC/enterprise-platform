-- Bán hàng (crm) · tham chiếu tài liệu có sẵn vào báo giá (GĐI, Q-P2-11): đính kèm tài liệu của đối tượng khác
-- (khách hàng, dự án, báo giá cùng dự án) vào khối Đính kèm của báo giá mà không nhân bản file trên S3: chỉ lưu liên kết
-- tới tài liệu nguồn; tải xuống vẫn ký URL theo object của tài liệu nguồn. Xoá tài liệu nguồn thì liên kết mất theo.
-- Bảng mới, không có dữ liệu cũ. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm_schema.document_references (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id        UUID NOT NULL REFERENCES crm_schema.documents (id) ON DELETE CASCADE,
    target_entity_type VARCHAR(24) NOT NULL DEFAULT 'quote' CHECK (target_entity_type IN ('quote')),
    target_entity_id   UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         UUID NOT NULL,
    CONSTRAINT uq_crm_document_references UNIQUE (document_id, target_entity_type, target_entity_id)
);
CREATE INDEX IF NOT EXISTS ix_crm_document_references_target
    ON crm_schema.document_references (target_entity_type, target_entity_id);
