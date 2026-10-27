-- Bán hàng (crm) · hoạt động chăm sóc khách hàng: gọi điện, email, gặp mặt,
-- công việc; gắn khách hàng hoặc cơ hội, có người được giao, hạn, kết quả.
-- Notification-worker đọc bảng này để nhắc trước hạn và khi quá hạn. Bảng mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm_schema.activities (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             VARCHAR(16) NOT NULL CHECK (type IN ('CALL', 'EMAIL', 'MEETING', 'TASK')),
    subject          VARCHAR(300) NOT NULL,
    description      VARCHAR(4000),
    customer_id      UUID REFERENCES crm_schema.customers (id) ON DELETE CASCADE,
    opportunity_id   UUID REFERENCES crm_schema.opportunities (id) ON DELETE CASCADE,
    assignee_user_id UUID NOT NULL,
    due_at           TIMESTAMPTZ,
    status           VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
    result           VARCHAR(4000),
    completed_at     TIMESTAMPTZ,
    completed_by     UUID,
    version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by       UUID,

    CONSTRAINT ck_crm_activities_target CHECK (customer_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

-- Việc của tôi theo hạn.
CREATE INDEX IF NOT EXISTS ix_crm_activities_assignee_due
    ON crm_schema.activities (assignee_user_id, due_at);
CREATE INDEX IF NOT EXISTS ix_crm_activities_customer
    ON crm_schema.activities (customer_id, created_at) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_activities_opportunity
    ON crm_schema.activities (opportunity_id, created_at) WHERE opportunity_id IS NOT NULL;
-- Bộ quét nhắc hạn chỉ đọc hoạt động đang mở có hạn.
CREATE INDEX IF NOT EXISTS ix_crm_activities_open_due
    ON crm_schema.activities (due_at) WHERE status = 'OPEN' AND due_at IS NOT NULL;

-- Nhắc trước hạn bao nhiêu phút (notification-worker đọc), mặc định 30.
INSERT INTO crm_schema.settings (key, value)
VALUES ('activity.reminder', '{"leadMinutes": 30}'::jsonb)
ON CONFLICT (key) DO NOTHING;
