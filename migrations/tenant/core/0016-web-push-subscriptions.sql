-- 0016: đăng ký nhận thông báo đẩy (Web Push) của trình duyệt, để báo tin nhắn chat cả khi người dùng đã đóng hết
-- tab ERP. Mỗi trình duyệt (endpoint) thuộc một người; đăng nhập người khác trên cùng trình duyệt thì chuyển chủ.
-- Endpoint chỉ được nhận khi là máy chủ push chính thức của trình duyệt (kiểm ở API và lúc gửi).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_schema.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (char_length(endpoint) <= 2048),
  p256dh varchar(200) NOT NULL,
  auth varchar(100) NOT NULL,
  user_agent varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user
  ON core_schema.web_push_subscriptions(user_id, updated_at DESC);

-- Cặp khoá VAPID của công ty (một dòng duy nhất), sinh tự động lần đầu dùng thông báo đẩy nên không phải cấu hình gì
-- khi triển khai. Biến môi trường WEB_PUSH_VAPID_* (nếu đặt) được ưu tiên hơn. Đổi khoá thì trình duyệt tự đăng ký lại
-- ở lần mở trang sau.
CREATE TABLE IF NOT EXISTS core_schema.web_push_keys (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key varchar(200) NOT NULL,
  private_key varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
