-- Sửa đơn khi chưa duyệt: đơn cũ được hủy và đơn mới (đã qua đủ kiểm tra như khi tạo) thay chỗ; bảng này nối hai đơn để
-- giao diện báo "đã được chỉnh sửa" và luồng trao đổi được chuyển sang đơn mới. Chỉ thêm bảng và chỉ mục.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS hrm_schema.request_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_kind varchar(30) NOT NULL,
  old_request_id uuid NOT NULL,
  new_request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_kind, old_request_id)
);

CREATE INDEX IF NOT EXISTS idx_hrm_request_replacements_new
  ON hrm_schema.request_replacements (tenant_id, request_kind, new_request_id);

COMMENT ON TABLE hrm_schema.request_replacements IS 'Đơn cũ bị thay bằng đơn mới khi người gửi sửa đơn chưa duyệt';
