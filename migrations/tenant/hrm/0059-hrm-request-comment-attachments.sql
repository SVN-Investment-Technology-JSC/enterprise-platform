SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Hỗ trợ gán tệp đính kèm trong luồng trao đổi / ý kiến phê duyệt trên đơn từ.
ALTER TABLE hrm_schema.request_comments
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN hrm_schema.request_comments.attachments IS 'Thông tin chi tiết các tệp đính kèm trong tin nhắn (id, name, contentType, sizeBytes)';
