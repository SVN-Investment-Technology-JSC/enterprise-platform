-- Nhóm vị trí icon tùy chỉnh (tên hiển thị tiếng Việt) cho Brand Studio. 8 nhóm có sẵn nằm trong code, không lưu ở đây.
-- Dữ liệu cũ: mỗi group_key đang dùng bởi custom_slots mà không phải nhóm có sẵn được chép thành một nhóm, label = key.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS brand_schema.slot_groups (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_-]{1,31}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO brand_schema.slot_groups (key, label)
SELECT DISTINCT group_key, group_key
  FROM brand_schema.custom_slots
 WHERE group_key NOT IN ('brand', 'module', 'nav', 'header', 'shell', 'dashboard', 'sidebar', 'custom')
ON CONFLICT (key) DO NOTHING;
