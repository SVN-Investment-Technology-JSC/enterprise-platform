SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Phiếu có nguồn từ phân hệ khác ngoài Quy trình (trước mắt: phiếu thu từ lần thu tiền của Bán hàng, `source_module = 'crm'`).
--
-- 1. `source_module`: phân hệ tạo ra phiếu. Dòng cũ đều do Quy trình tạo nên nhận mặc định `procedure-engine`.
-- 2. `source_ref`: id bản ghi bên phân hệ nguồn (id lần thu của Bán hàng). Nguồn Quy trình vẫn dùng `instance_id`, để NULL.
--    Mỗi (tenant, phân hệ, source_ref) chỉ một phiếu.
-- 3. `idempotency_key` + `request_hash`: bên gọi gửi lặp cùng khoá và cùng nội dung thì nhận lại đúng phiếu cũ; cùng khoá mà khác
--    nội dung thì bị từ chối (409). Khoá duy nhất theo tenant.
-- 4. `instance_id`, `step_instance_id` nhận NULL cho nguồn không phải Quy trình. Ràng buộc cũ UNIQUE (tenant_id, instance_id) giữ
--    nguyên: PostgreSQL coi các NULL là khác nhau, nên ràng buộc vẫn bảo đảm "một hồ sơ = một phiếu" cho nguồn Quy trình mà không
--    chặn nhiều phiếu nguồn Bán hàng (instance_id NULL). CHECK bảo đảm dòng Quy trình luôn có hồ sơ, dòng khác luôn có source_ref.
-- 5. Trạng thái nguồn thêm REVERSED: phiếu nguồn Bán hàng đã ghi sổ bị người có quyền duyệt đảo thủ công.
-- ============================================================================

ALTER TABLE finance_schema.voucher_sources
    ADD COLUMN IF NOT EXISTS source_module VARCHAR(40) NOT NULL DEFAULT 'procedure-engine',
    ADD COLUMN IF NOT EXISTS source_ref VARCHAR(100),
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200),
    ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);

ALTER TABLE finance_schema.voucher_sources ALTER COLUMN instance_id DROP NOT NULL;
ALTER TABLE finance_schema.voucher_sources ALTER COLUMN step_instance_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_voucher_sources_origin') THEN
        ALTER TABLE finance_schema.voucher_sources ADD CONSTRAINT ck_finance_voucher_sources_origin
            CHECK (
                (source_module = 'procedure-engine' AND instance_id IS NOT NULL AND step_instance_id IS NOT NULL)
                OR (source_module <> 'procedure-engine' AND source_ref IS NOT NULL)
            );
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_voucher_sources_ref
    ON finance_schema.voucher_sources (tenant_id, source_module, source_ref) WHERE source_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_voucher_sources_idempotency
    ON finance_schema.voucher_sources (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE finance_schema.voucher_sources DROP CONSTRAINT IF EXISTS ck_finance_voucher_sources_status;
ALTER TABLE finance_schema.voucher_sources ADD CONSTRAINT ck_finance_voucher_sources_status
    CHECK (status IN ('OPEN', 'RETURNED', 'POSTED', 'CLOSED', 'REVERSAL_PENDING', 'REVERSED'));
