-- Mở rộng tạo đơn hộ sang giải trình công: bảng attendance_corrections có thêm dấu đơn tạo hộ như nghỉ phép, tăng ca,
-- công tác (migration 0069), và phạm vi tạo hộ (request_proxy_rules) cho phép chọn loại 'correction'. Đơn cũ giữ
-- created_on_behalf = false. Chỉ thêm cột và nới ràng buộc nên bản app cũ vẫn chạy được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.attendance_corrections
  ADD COLUMN IF NOT EXISTS created_on_behalf boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_behalf_reason text,
  ADD COLUMN IF NOT EXISTS on_behalf_by_name text;

ALTER TABLE hrm_schema.request_proxy_rules
  DROP CONSTRAINT IF EXISTS request_proxy_rules_kinds;
ALTER TABLE hrm_schema.request_proxy_rules
  ADD CONSTRAINT request_proxy_rules_kinds CHECK (
    cardinality(request_kinds) > 0 AND request_kinds <@ ARRAY['leave', 'ot', 'business_trip', 'correction']::text[]
  );
