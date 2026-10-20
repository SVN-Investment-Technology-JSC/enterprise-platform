-- Lưu icon thương hiệu (Brand Studio): DB chỉ giữ khoá object trên MinIO và vài trường tra cứu.
--
-- Tài liệu icon (`spec.json`), SVG dựng sẵn (`icon.svg`, `icon.mono.svg`) và bảng màu/quy chuẩn
-- (`standards/v<N>.json`) nằm trong object storage dưới tiền tố `platform/brand/`, ngoài `tenants/`
-- nên xoá tenant không đụng tới. Mỗi lần lưu là một phiên bản mới; object và dòng `icon_versions`
-- đã ghi thì không sửa. Chỉ thêm schema mới `brand_schema`, không đổi bảng nào đang có.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS brand_schema;

-- `id` do client tạo (cùng mẫu với IconDocument.id). `slug` dẫn từ tên lúc tạo, không đổi khi đổi tên.
-- `published_version` là phiên bản đang công khai: lưu thêm bản mới thì bản công khai vẫn giữ nguyên
-- cho tới khi phát hành lại.
CREATE TABLE IF NOT EXISTS brand_schema.icons (
  id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 64),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  category text NOT NULL CHECK (category IN ('brand', 'module', 'system', 'custom')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 12),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  published_version integer CHECK (published_version >= 1),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT icons_published_version_range CHECK (published_version IS NULL OR published_version <= current_version),
  CONSTRAINT icons_published_state CHECK ((status = 'published') = (published_version IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS icons_status_updated_idx ON brand_schema.icons (status, updated_at DESC);

-- Một dòng cho mỗi lần lưu. Ba khoá object cùng nằm dưới `platform/brand/icons/<id>/v<N>/`.
-- `standards_version` là phiên bản bảng màu đã dùng để dựng `icon.svg` (0 = bảng màu mặc định).
CREATE TABLE IF NOT EXISTS brand_schema.icon_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  icon_id text NOT NULL REFERENCES brand_schema.icons(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  spec_key text NOT NULL CHECK (spec_key LIKE 'platform/brand/icons/%'),
  svg_key text NOT NULL CHECK (svg_key LIKE 'platform/brand/icons/%'),
  mono_svg_key text NOT NULL CHECK (mono_svg_key LIKE 'platform/brand/icons/%'),
  spec_sha256 char(64) NOT NULL CHECK (spec_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer NOT NULL CHECK (size_bytes >= 0),
  standards_version integer NOT NULL DEFAULT 0 CHECK (standards_version >= 0),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (icon_id, version)
);

-- Bảng màu và quy chuẩn thương hiệu: một dòng duy nhất trỏ tới phiên bản hiện hành.
-- `current_version = 0` nghĩa là chưa lưu lần nào, API dùng giá trị mặc định.
CREATE TABLE IF NOT EXISTS brand_schema.standards (
  id smallint PRIMARY KEY CHECK (id = 1),
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  spec_key text CHECK (spec_key IS NULL OR spec_key LIKE 'platform/brand/standards/%'),
  spec_sha256 char(64) CHECK (spec_sha256 IS NULL OR spec_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT standards_version_key CHECK ((current_version = 0) = (spec_key IS NULL))
);

INSERT INTO brand_schema.standards (id, current_version) VALUES (1, 0) ON CONFLICT DO NOTHING;
