-- Tin chat đính kèm được nhiều tài liệu.
--  · chat_messages.attachment_document_ids: danh sách tài liệu đính kèm (uuid[], mặc định rỗng). Không có khoá ngoại
--    (như cột cũ, tài liệu bị xoá thì tên hiện "Tài liệu đính kèm").
--  · Cột cũ attachment_document_id GIỮ NGUYÊN và luôn ghi tài liệu đầu tiên: bản app cũ vẫn đọc được tin mới (thấy tệp
--    đầu), bộ lọc "có đính kèm" vẫn đúng, và lùi image không cần lùi schema.
--  · Tin cũ: chép tài liệu đính kèm duy nhất sang mảng.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.chat_messages
    ADD COLUMN IF NOT EXISTS attachment_document_ids UUID[] NOT NULL DEFAULT '{}';

UPDATE workspace_schema.chat_messages
   SET attachment_document_ids = ARRAY[attachment_document_id]
 WHERE attachment_document_id IS NOT NULL
   AND attachment_document_ids = '{}';
