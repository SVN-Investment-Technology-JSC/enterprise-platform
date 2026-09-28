SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- KÊNH CHAT
--
-- Mỗi node trong cây — dự án hoặc công việc — có đúng một kênh. Kênh được tạo
-- LƯỜI: chỉ sinh khi ai đó gửi tin đầu tiên. Tạo sẵn kênh cho mọi node sẽ
-- sinh hàng nghìn dòng rỗng cho một dự án lớn mà không ai dùng tới.
--
-- `entity_id` đa hình nên không đặt khoá ngoại; `project_id` lưu dư để lọc
-- phân quyền mà không phải join ngược qua bảng công việc.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.chat_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     VARCHAR(32) NOT NULL CHECK (entity_type IN ('project','work_item')),
    entity_id       UUID NOT NULL,
    project_id      UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    -- Sắp xếp danh sách kênh và biết nhanh kênh nào vừa có tin mới.
    last_message_at TIMESTAMPTZ,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_channels_project
    ON workspace_schema.chat_channels (project_id, last_message_at DESC);

-- ===========================================================================
-- TIN NHẮN
--
-- Xoá mềm: xoá cứng một tin có người trả lời sẽ làm đứt luồng và các trả lời
-- bên dưới mất ngữ cảnh. Dòng ở lại, nội dung bị che ở tầng ứng dụng.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.chat_messages (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id             UUID NOT NULL REFERENCES workspace_schema.chat_channels(id) ON DELETE CASCADE,
    -- Trả lời, tối đa 2 cấp. Ràng buộc độ sâu nằm ở tầng ứng dụng: SQL không
    -- diễn tả được "cha của cha phải rỗng" bằng một CHECK.
    parent_id              UUID REFERENCES workspace_schema.chat_messages(id) ON DELETE CASCADE,
    body                   TEXT NOT NULL,
    -- Danh sách người được nhắc. Mảng thay vì bảng nối: luôn đọc và ghi trọn
    -- gói cùng tin nhắn, không bao giờ truy vấn riêng một lượt nhắc.
    mentions               UUID[] NOT NULL DEFAULT '{}',
    -- Trỏ sang `documents`, KHÔNG nhân bản tệp. `0002` chạy trước `0004` nên
    -- bảng đó đã tồn tại. SET NULL chứ không CASCADE: lưu trữ một tài liệu
    -- không được làm bốc hơi tin nhắn đã trao đổi quanh nó.
    attachment_document_id UUID REFERENCES workspace_schema.documents(id) ON DELETE SET NULL,
    is_edited              BOOLEAN NOT NULL DEFAULT false,
    is_deleted             BOOLEAN NOT NULL DEFAULT false,
    created_by             UUID NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_chat_messages_body_length CHECK (char_length(body) <= 5000),
    CONSTRAINT chk_chat_messages_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- Luồng tin của một kênh, mới nhất trước.
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel
    ON workspace_schema.chat_messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent
    ON workspace_schema.chat_messages (parent_id);
-- GIN trên mảng: nuôi khối "nhắc tôi" ở trang Công việc của tôi. Không có
-- index này thì truy vấn đó quét toàn bảng tin nhắn.
CREATE INDEX IF NOT EXISTS idx_chat_messages_mentions
    ON workspace_schema.chat_messages USING GIN (mentions);

-- ===========================================================================
-- DẤU ĐÃ ĐỌC — nguồn của chấm đỏ trên cây
--
-- Lưu một mốc thời gian cho mỗi cặp (kênh, người), không lưu từng tin đã đọc:
-- số tin chưa đọc = đếm tin có `created_at` lớn hơn mốc đó.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.chat_reads (
    channel_id   UUID NOT NULL REFERENCES workspace_schema.chat_channels(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (channel_id, user_id)
);

-- ===========================================================================
-- THẺ DÙNG CHUNG
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.tags (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Chuẩn hoá về chữ thường ở tầng ứng dụng trước khi ghi, để UNIQUE thật
    -- sự chặn được "Khẩn" và "khẩn".
    name       VARCHAR(40) NOT NULL UNIQUE,
    color      VARCHAR(16),
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_schema.entity_tags (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id      UUID NOT NULL REFERENCES workspace_schema.tags(id) ON DELETE CASCADE,
    entity_type VARCHAR(32) NOT NULL CHECK (entity_type IN ('project','work_item','document')),
    entity_id   UUID NOT NULL,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (tag_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_tags_entity
    ON workspace_schema.entity_tags (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_tags_tag
    ON workspace_schema.entity_tags (tag_id);

-- ===========================================================================
-- CON TRỎ SANG MODULE KHÁC
--
-- Hiện thực nguyên tắc "Workspace hiển thị, module gốc sở hữu".
--
-- Bốn quy tắc bắt buộc:
--   1. Chỉ lưu con trỏ và nhãn hiển thị, không sao chép nội dung nghiệp vụ.
--   2. `cached_label` và `cached_status` chỉ để render nhanh; KHÔNG dùng làm
--      căn cứ cho bất kỳ quyết định nghiệp vụ nào của Workspace.
--   3. Một chiều, chỉ đọc: Workspace gọi module khác bằng GET từ trình duyệt.
--   4. Gỡ tham chiếu là xoá cứng dòng này — ngoại lệ hợp lý so với quy ước
--      không xoá cứng, vì dòng này chỉ là một liên kết.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.external_references (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type   VARCHAR(32) NOT NULL CHECK (entity_type IN ('project','work_item')),
    entity_id     UUID NOT NULL,
    project_id    UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    module_key    VARCHAR(64) NOT NULL
                    CHECK (module_key IN ('procedure-engine','maintenance','inventory','crm')),
    external_id   VARCHAR(160) NOT NULL,
    external_code VARCHAR(100),
    -- Lấy từ chính module đó lúc gắn, KHÔNG tự ghép chuỗi: đường dẫn của
    -- module khác là chuyện của module đó, tự đoán là sẽ gãy khi họ đổi.
    launch_url    VARCHAR(255) NOT NULL,
    cached_label  VARCHAR(255),
    cached_status VARCHAR(64),
    synced_at     TIMESTAMPTZ,
    created_by    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (entity_type, entity_id, module_key, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_refs_entity
    ON workspace_schema.external_references (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_external_refs_project
    ON workspace_schema.external_references (project_id);
