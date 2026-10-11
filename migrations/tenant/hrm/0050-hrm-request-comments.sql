SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- TRAO ĐỔI VÀ Ý KIẾN PHÊ DUYỆT TRÊN ĐƠN TỪ. Mỗi đơn (mọi loại: nghỉ, tăng ca, công tác, đổi ca, giải trình, tạm ứng,
-- đính chính hồ sơ, đơn tuỳ chỉnh) có một luồng trao đổi giữa người gửi, người duyệt và những người được nhắc tên (@).
-- Ý kiến khi duyệt, từ chối hoặc xử lý qua quy trình cũng được ghi vào cùng luồng (kind = 'DECISION') để lịch sử không mất.
-- Không xoá cứng: bình luận bị gỡ chỉ đặt deleted_at.
CREATE TABLE IF NOT EXISTS hrm_schema.request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_kind varchar(30) NOT NULL,
  request_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  author_name varchar(255) NOT NULL,
  kind varchar(12) NOT NULL DEFAULT 'COMMENT' CHECK (kind IN ('COMMENT', 'DECISION')),
  -- Quyết định đi kèm ý kiến (APPROVE, REJECT, RETURN, COMPLETE...); NULL với bình luận thường.
  decision varchar(20),
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  mention_user_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_hrm_request_comments_request
  ON hrm_schema.request_comments (tenant_id, request_kind, request_id, created_at)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE hrm_schema.request_comments IS 'Trao đổi và ý kiến phê duyệt trên đơn từ HRM (mọi loại đơn)';
COMMENT ON COLUMN hrm_schema.request_comments.mention_user_ids IS 'Người dùng được nhắc tên (@); được đọc và trả lời luồng trao đổi của đơn này';
