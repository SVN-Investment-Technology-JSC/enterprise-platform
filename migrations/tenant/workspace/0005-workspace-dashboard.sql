SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- TUỲ CHỌN HIỂN THỊ CỦA TỪNG NGƯỜI
--
-- Dùng `jsonb` thay vì bảng quan hệ: bố cục dashboard là dữ liệu hiển thị
-- thuần tuý, KHÔNG bao giờ bị truy vấn hay tổng hợp theo từng phần tử. Tách
-- thành bảng `dashboard_cards` chỉ tạo ra một join không ai cần.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.user_dashboard_preferences (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Mỗi người đúng một dòng.
    user_id            UUID NOT NULL UNIQUE,
    -- Mã các thẻ KPI được bật, theo đúng thứ tự hiển thị.
    visible_cards      JSONB NOT NULL DEFAULT '[]'::jsonb,
    layout             JSONB NOT NULL DEFAULT '{}'::jsonb,
    default_view       VARCHAR(32) NOT NULL DEFAULT 'my-work'
                         CHECK (default_view IN ('my-work','projects','calendar','dashboard')),
    default_project_id UUID REFERENCES workspace_schema.projects(id) ON DELETE SET NULL,
    created_by         UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===========================================================================
-- BỘ LỌC LƯU SẴN
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.saved_filters (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id  UUID NOT NULL,
    view_key       VARCHAR(64) NOT NULL
                     CHECK (view_key IN ('projects','work_items','documents','calendar','reports')),
    name           VARCHAR(120) NOT NULL,
    -- Khoảng ngày, trạng thái, đơn vị, người phụ trách — hình dạng đổi theo
    -- từng màn hình, nên không dựng cột cố định.
    filter_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_shared      BOOLEAN NOT NULL DEFAULT false,
    -- Rỗng nghĩa là bộ lọc toàn cục, không gắn dự án nào.
    project_id     UUID REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    created_by     UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (owner_user_id, view_key, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_owner
    ON workspace_schema.saved_filters (owner_user_id, view_key);
CREATE INDEX IF NOT EXISTS idx_saved_filters_shared
    ON workspace_schema.saved_filters (project_id, view_key) WHERE is_shared;
