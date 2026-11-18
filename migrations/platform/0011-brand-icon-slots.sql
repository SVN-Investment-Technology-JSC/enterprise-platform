-- Gán icon thương hiệu vào các vị trí sử dụng cố định trong hệ thống (logo, favicon, phân hệ, điều hướng).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS brand_schema.icon_slots (
  slot text PRIMARY KEY CHECK (slot ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  icon_id text NOT NULL REFERENCES brand_schema.icons(id) ON DELETE CASCADE,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS icon_slots_icon_id_idx ON brand_schema.icon_slots (icon_id);
