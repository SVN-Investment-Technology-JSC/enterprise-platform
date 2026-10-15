SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Phiếu tạo từ bước Tài chính của một hồ sơ quy trình.
--
-- 1. Cách duyệt INHERITED: hồ sơ đã duyệt ở quy trình, kế toán chỉ ghi sổ hoặc trả hồ sơ về. Phiếu INHERITED không bao giờ
--    mở thêm hồ sơ duyệt khác (không dùng approval_bindings).
-- 2. `voucher_sources`: một hồ sơ = một phiếu (UNIQUE tenant_id, instance_id). Không khoá ngoại sang Procedure (khác schema,
--    khác module): chỉ lưu id và nhãn chụp lúc nhận sự kiện.
-- 3. `assignee_ids` / `assignee_subjects` chỉ để lọc "Chờ tôi ghi sổ" và hiển thị; quyền thao tác hỏi Procedure (`can-act`).
-- 4. Khoá mềm `handling_by`: ai đang xử lý phiếu, chỉ để báo cho người khác; người có quyền vẫn nhận xử lý thay được.
-- ============================================================================

ALTER TABLE finance_schema.vouchers DROP CONSTRAINT IF EXISTS vouchers_approval_mode_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_vouchers_approval_mode') THEN
        ALTER TABLE finance_schema.vouchers ADD CONSTRAINT ck_finance_vouchers_approval_mode
            CHECK (approval_mode IN ('DIRECT', 'PROCEDURE', 'INHERITED'));
    END IF;
END $$;

ALTER TABLE finance_schema.voucher_events DROP CONSTRAINT IF EXISTS voucher_events_action_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_voucher_events_action') THEN
        ALTER TABLE finance_schema.voucher_events ADD CONSTRAINT ck_finance_voucher_events_action
            CHECK (action IN ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'REVERSED', 'TAKEN_OVER'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS finance_schema.voucher_sources (
    voucher_id UUID PRIMARY KEY REFERENCES finance_schema.vouchers(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    instance_id UUID NOT NULL,
    instance_code VARCHAR(80) NOT NULL,
    instance_title VARCHAR(255),
    definition_id UUID,
    definition_name VARCHAR(255),
    -- Id bước của hồ sơ do Procedure sinh; giữ dạng chuỗi để không phụ thuộc định dạng id bên đó.
    step_instance_id VARCHAR(100) NOT NULL,
    step_name VARCHAR(255),
    activation INTEGER NOT NULL CHECK (activation >= 1),
    -- Giá trị đã nhận từ hồ sơ (values, projectId, workItemId), để hiển thị khối "Nguồn".
    snapshot JSONB NOT NULL,
    -- Trường lấy từ hồ sơ, bị khoá trên form.
    locked_fields TEXT[] NOT NULL DEFAULT '{}',
    assignee_ids UUID[] NOT NULL DEFAULT '{}',
    assignee_subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
    assignee_label VARCHAR(255),
    handling_by UUID,
    handling_by_name VARCHAR(255),
    handling_since TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RETURNED', 'POSTED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_voucher_sources_instance UNIQUE (tenant_id, instance_id),
    CONSTRAINT ck_finance_voucher_sources_handling CHECK ((handling_by IS NULL) = (handling_since IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_finance_voucher_sources_open
    ON finance_schema.voucher_sources (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_voucher_sources_assignees
    ON finance_schema.voucher_sources USING GIN (assignee_ids) WHERE status = 'OPEN';
