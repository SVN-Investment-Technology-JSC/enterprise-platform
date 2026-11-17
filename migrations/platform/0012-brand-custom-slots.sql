-- Bảng định nghĩa vị trí icon tuỳ chỉnh do quản trị viên tự tạo trên Brand Studio.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS brand_schema.custom_slots (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  group_key text NOT NULL DEFAULT 'custom' CHECK (group_key ~ '^[a-z][a-z0-9_-]{1,31}$'),
  color_mode text NOT NULL DEFAULT 'brand' CHECK (color_mode IN ('brand', 'mono')),
  recommended_size integer NOT NULL DEFAULT 24 CHECK (recommended_size BETWEEN 12 AND 128),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS custom_slots_group_idx ON brand_schema.custom_slots (group_key);
