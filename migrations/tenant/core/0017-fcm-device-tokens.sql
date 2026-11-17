-- 0017: đăng ký nhận thông báo đẩy Firebase Cloud Messaging (FCM) của thiết bị di động (iOS, Android), để báo
-- thông báo nghiệp vụ và tin nhắn chat nội bộ trên điện thoại. Mỗi token thuộc một người; đăng nhập tài khoản khác
-- trên cùng thiết bị thì chuyển chủ. Gắn `session_id` để khi phiên đăng xuất hoặc bị thu hồi thì tự xoá token của phiên đó.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_schema.fcm_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  session_id uuid,
  token text NOT NULL UNIQUE CHECK (char_length(token) BETWEEN 20 AND 4096),
  platform varchar(16) NOT NULL CHECK (platform IN ('ios', 'android')),
  device_id varchar(200),
  user_agent varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_fcm_device_tokens_user
  ON core_schema.fcm_device_tokens(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_fcm_device_tokens_session
  ON core_schema.fcm_device_tokens(session_id)
  WHERE session_id IS NOT NULL;
