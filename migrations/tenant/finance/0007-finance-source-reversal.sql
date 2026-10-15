SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Phiếu tạo từ hồ sơ quy trình khi hồ sơ bị huỷ hiệu lực.
--
-- Phiếu đã ghi sổ được đảo (bút toán ngược ngày hôm nay). Nếu chưa đảo được (kỳ hiện tại đã khoá sổ, số dư không đủ...),
-- nguồn chuyển REVERSAL_PENDING kèm lý do huỷ hiệu lực và lỗi của lần thử gần nhất, để tiến trình nền và người có quyền
-- ghi sổ thử lại; sự kiện của Procedure không bị ném lại vào hàng đợi vì lỗi nghiệp vụ.
-- ============================================================================

ALTER TABLE finance_schema.voucher_sources DROP CONSTRAINT IF EXISTS voucher_sources_status_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_voucher_sources_status') THEN
        ALTER TABLE finance_schema.voucher_sources ADD CONSTRAINT ck_finance_voucher_sources_status
            CHECK (status IN ('OPEN', 'RETURNED', 'POSTED', 'CLOSED', 'REVERSAL_PENDING'));
    END IF;
END $$;

ALTER TABLE finance_schema.voucher_sources
    ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
    ADD COLUMN IF NOT EXISTS reversal_by UUID,
    ADD COLUMN IF NOT EXISTS reversal_by_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reversal_error TEXT,
    ADD COLUMN IF NOT EXISTS reversal_attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_finance_voucher_sources_reversal_pending
    ON finance_schema.voucher_sources (tenant_id, updated_at) WHERE status = 'REVERSAL_PENDING';
