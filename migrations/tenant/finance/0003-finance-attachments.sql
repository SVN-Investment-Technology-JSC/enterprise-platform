SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Đính kèm chứng từ của phiếu: tải lên kho đối tượng (MinIO/S3) bằng URL ký sẵn rồi xác nhận kích thước và định dạng.
-- Tệp ở trạng thái PENDING chưa hiện trên phiếu; chỉ READY mới được liệt kê và tải xuống.
-- Gỡ tệp là xoá mềm (giữ lại dấu vết người gỡ); đối tượng trong kho được giữ để truy vết.
ALTER TABLE finance_schema.voucher_attachments
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY')),
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deleted_by UUID;

CREATE INDEX IF NOT EXISTS idx_finance_voucher_attachments_live
    ON finance_schema.voucher_attachments (voucher_id) WHERE deleted_at IS NULL AND status = 'READY';
