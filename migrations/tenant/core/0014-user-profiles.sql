-- 0014: hồ sơ hiển thị của người dùng (hiện có ảnh đại diện), tách khỏi core_schema.users.
-- Không thêm cột vào core_schema.users: mọi lần ghi bảng đó chạy trigger tăng revision phân quyền (0005, 0012),
-- phát core.authorization.changed tới mọi phiên của công ty. Đổi ảnh đại diện không phải là đổi quyền.
-- Ảnh nằm trong kho đối tượng (khoá tenants/<tenantId>/core/avatars/...); bảng chỉ giữ khoá và phiên bản.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_schema.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES core_schema.users(id) ON DELETE CASCADE,
  avatar_key varchar(500),
  avatar_content_type varchar(100),
  avatar_size_bytes bigint,
  -- Tăng mỗi lần đổi hoặc gỡ ảnh; giao diện gắn vào URL ảnh (?v=) để trình duyệt cache lâu mà vẫn thấy ảnh mới.
  avatar_version integer NOT NULL DEFAULT 0,
  avatar_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_user_profiles_avatar CHECK ((avatar_key IS NULL) = (avatar_content_type IS NULL)),
  CONSTRAINT ck_user_profiles_avatar_size CHECK (avatar_size_bytes IS NULL OR avatar_size_bytes >= 0),
  CONSTRAINT ck_user_profiles_avatar_version CHECK (avatar_version >= 0)
);
