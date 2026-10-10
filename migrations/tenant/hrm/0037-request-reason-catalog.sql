-- Danh mục lý do động cho đơn làm thêm (OVERTIME) và đơn công tác (BUSINESS_TRIP).
-- Đơn lưu tên lý do trong chi tiết đơn nên đổi tên/ngừng dùng không làm đổi đơn cũ.
CREATE TABLE IF NOT EXISTS hrm_schema.request_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind varchar(30) NOT NULL CHECK (kind IN ('OVERTIME','BUSINESS_TRIP')),
  name varchar(255) NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_request_reasons_name
  ON hrm_schema.request_reasons (tenant_id, kind, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hrm_request_reasons_kind
  ON hrm_schema.request_reasons (tenant_id, kind, active, sort_order);
