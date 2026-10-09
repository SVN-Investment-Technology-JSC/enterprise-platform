-- Loại đơn (danh mục) động theo tenant: mỗi loại đơn là một tab trong Danh mục đơn từ
-- và sở hữu danh sách lý do riêng. OVERTIME/BUSINESS_TRIP là loại hệ thống (không xoá được).
CREATE TABLE IF NOT EXISTS hrm_schema.request_reason_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code varchar(50) NOT NULL,
  name varchar(255) NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_request_reason_categories_code
  ON hrm_schema.request_reason_categories (tenant_id, upper(code)) WHERE deleted_at IS NULL;
ALTER TABLE hrm_schema.request_reasons DROP CONSTRAINT IF EXISTS request_reasons_kind_check;
ALTER TABLE hrm_schema.request_reasons ALTER COLUMN kind TYPE varchar(50);
