SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Phân biệt tệp đính kèm chứng từ với ảnh dán trực tiếp vào ô Ghi chú (rich text): dùng chung kho đối tượng và
-- luồng ký URL tải lên/tải xuống, nhưng đếm giới hạn số lượng riêng (xem attachments.store.ts) để ảnh ghi chú
-- không chiếm hết trần 20 tệp đính kèm của phiếu.
ALTER TABLE finance_schema.voucher_attachments
    ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) NOT NULL DEFAULT 'ATTACHMENT' CHECK (purpose IN ('ATTACHMENT', 'NOTE_IMAGE'));

CREATE INDEX IF NOT EXISTS idx_finance_voucher_attachments_purpose
    ON finance_schema.voucher_attachments (voucher_id, purpose) WHERE deleted_at IS NULL AND status = 'READY';
