SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Tài chính: duyệt phiếu qua Procedure Engine (quy trình RCSI) hoặc duyệt trực tiếp.
-- Module chỉ giữ liên kết và kết quả; việc ai được duyệt do định nghĩa quy trình quyết định.
-- Không có khoá ngoại sang schema của Procedure: chỉ lưu id và bản chụp định nghĩa lúc gửi.
-- ============================================================================

-- Mỗi loại phiếu chọn một cách duyệt. Chưa có dòng nghĩa là duyệt trực tiếp.
CREATE TABLE IF NOT EXISTS finance_schema.approval_bindings (
    tenant_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('RECEIPT', 'PAYMENT', 'TRANSFER')),
    mode VARCHAR(20) NOT NULL DEFAULT 'DIRECT' CHECK (mode IN ('DIRECT', 'PROCEDURE')),
    procedure_definition_id UUID,
    procedure_definition_name VARCHAR(255),
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, kind),
    CONSTRAINT ck_finance_binding_definition CHECK (mode = 'DIRECT' OR procedure_definition_id IS NOT NULL)
);

-- Một lần gửi duyệt qua quy trình = một liên kết. Gửi lại sau khi bị từ chối tạo liên kết mới (revision mới).
-- `id` đồng thời là sourceId của hồ sơ trong Procedure, nên sự kiện kết quả luôn khớp đúng lần gửi,
-- kể cả khi sự kiện đến trước lúc phản hồi tạo hồ sơ được ghi lại.
CREATE TABLE IF NOT EXISTS finance_schema.procedure_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_id UUID NOT NULL REFERENCES finance_schema.vouchers(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    definition_id UUID NOT NULL,
    definition_snapshot JSONB NOT NULL,
    title VARCHAR(255) NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    initiated_by UUID NOT NULL,
    start_idempotency_key VARCHAR(180) NOT NULL,
    instance_id UUID,
    instance_code VARCHAR(80),
    -- START_PENDING: chờ tạo hồ sơ; RUNNING: hồ sơ đang chạy; FAILED: tạo hồ sơ lỗi, sẽ thử lại;
    -- APPLIED: kết quả đã áp vào phiếu; CONFLICT: có kết quả nhưng chưa áp được (cần xử lý); CLOSED: lần gửi cũ, bỏ qua.
    sync_status VARCHAR(20) NOT NULL DEFAULT 'START_PENDING'
        CHECK (sync_status IN ('START_PENDING', 'RUNNING', 'FAILED', 'APPLIED', 'CONFLICT', 'CLOSED')),
    result VARCHAR(20) CHECK (result IN ('completed', 'rejected', 'cancelled')),
    result_actor_id UUID,
    result_event_id UUID,
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_token UUID,
    lease_until TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_procedure_links_revision UNIQUE (voucher_id, revision),
    CONSTRAINT uq_finance_procedure_links_key UNIQUE (tenant_id, start_idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_procedure_links_instance
    ON finance_schema.procedure_links (instance_id) WHERE instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_procedure_links_pending
    ON finance_schema.procedure_links (tenant_id, sync_status, updated_at)
    WHERE sync_status IN ('START_PENDING', 'FAILED', 'CONFLICT');

-- Sự kiện kết quả từ Procedure đã nhận, để xử lý trùng lặp (broker giao ít nhất một lần) không áp hai lần.
CREATE TABLE IF NOT EXISTS finance_schema.procedure_inbox (
    tenant_id UUID NOT NULL,
    event_id UUID NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    link_id UUID,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, event_id)
);
