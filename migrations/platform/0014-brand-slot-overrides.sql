-- Ghi đè theo từng trường cho vị trí icon có sẵn (hằng số trong code) của Brand Studio.
-- Cột NULL nghĩa là không ghi đè trường đó (dùng mặc định trong code); hàng mà mọi cột ghi đè đều NULL thì ứng dụng xoá hàng.
-- Mã vị trí không đổi được. Dữ liệu cũ: không có, bảng mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS brand_schema.slot_overrides (
  slot_id text PRIMARY KEY CHECK (slot_id ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  label text NULL CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 120),
  description text NULL,
  group_key text NULL CHECK (group_key IS NULL OR group_key ~ '^[a-z][a-z0-9_-]{1,31}$'),
  color_mode text NULL CHECK (color_mode IS NULL OR color_mode IN ('brand', 'mono')),
  recommended_size integer NULL CHECK (recommended_size IS NULL OR recommended_size BETWEEN 8 AND 512),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
