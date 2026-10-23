-- 0015: chat nội bộ của core (không thuộc phân hệ nào: tắt mọi phân hệ chat vẫn chạy).
-- Ba loại cuộc trò chuyện: 'company' (Tất cả nội bộ, mọi người dùng đang hoạt động, mỗi công ty một),
-- 'direct' (1-1, mỗi cặp người một) và 'group' (nhóm có tên, thành viên do người trong nhóm thêm).
-- Đã đọc / đã nhận là mốc thời gian theo từng người ở chat_schema.members, không phải bản ghi theo từng tin.
-- Tệp đính kèm nằm trong kho đối tượng (khoá tenants/<tenantId>/core/chat/...); bảng chỉ giữ khoá.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS chat_schema;

CREATE TABLE IF NOT EXISTS chat_schema.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(16) NOT NULL CHECK (kind IN ('company', 'direct', 'group')),
  title varchar(120),
  -- Chat 1-1: hai id người theo thứ tự tăng dần, nối bằng ':'; chặn hai cuộc 1-1 trùng nhau.
  direct_key varchar(80),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT ck_chat_conversations_direct CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CONSTRAINT ck_chat_conversations_title CHECK (kind <> 'group' OR (title IS NOT NULL AND char_length(btrim(title)) > 0))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversations_direct
  ON chat_schema.conversations(direct_key) WHERE direct_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversations_company
  ON chat_schema.conversations((kind)) WHERE kind = 'company';

CREATE TABLE IF NOT EXISTS chat_schema.members (
  conversation_id uuid NOT NULL REFERENCES chat_schema.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- Rời hoặc bị mời ra khỏi nhóm; giữ dòng để còn mốc đã đọc khi được thêm lại. Null là đang trong nhóm.
  left_at timestamptz,
  last_read_at timestamptz,
  last_delivered_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user
  ON chat_schema.members(user_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_schema.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_schema.conversations(id) ON DELETE CASCADE,
  -- Không khoá ngoại tới người dùng: tin vẫn còn khi tài khoản người gửi bị xoá.
  sender_id uuid NOT NULL,
  kind varchar(16) NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 5000),
  mentions uuid[] NOT NULL DEFAULT '{}',
  reply_to_id uuid REFERENCES chat_schema.messages(id) ON DELETE SET NULL,
  -- Mã trình duyệt sinh cho một lần gửi: gửi lại khi mạng chập chờn không tạo tin trùng.
  client_id varchar(64),
  -- Tin hệ thống (tạo nhóm, thêm, bớt người...): loại sự kiện và người liên quan.
  system_event jsonb,
  is_edited boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  -- clock_timestamp: nhiều tin ghi trong cùng một giao dịch (tạo nhóm + tin hệ thống) vẫn giữ đúng thứ tự.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_chat_messages_reply CHECK (reply_to_id IS NULL OR reply_to_id <> id),
  CONSTRAINT ck_chat_messages_system CHECK ((kind = 'system') = (system_event IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_schema.messages(conversation_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_client
  ON chat_schema.messages(conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentions
  ON chat_schema.messages USING GIN (mentions);

CREATE TABLE IF NOT EXISTS chat_schema.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_schema.conversations(id) ON DELETE CASCADE,
  -- Null khi đã tải lên nhưng chưa gửi kèm tin nào.
  message_id uuid REFERENCES chat_schema.messages(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  file_name varchar(255) NOT NULL,
  content_type varchar(150) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  storage_key varchar(700) NOT NULL UNIQUE,
  is_image boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
  ON chat_schema.attachments(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_attachments_pending
  ON chat_schema.attachments(uploaded_by, created_at) WHERE message_id IS NULL;

CREATE TABLE IF NOT EXISTS chat_schema.reactions (
  message_id uuid NOT NULL REFERENCES chat_schema.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reaction varchar(16) NOT NULL CHECK (reaction IN ('like', 'love', 'haha', 'wow', 'sad', 'angry')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
