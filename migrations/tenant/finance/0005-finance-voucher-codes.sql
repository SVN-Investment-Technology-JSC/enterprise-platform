SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Mã phiếu mới.
--
-- 1. Mã chính thức `PC-2610-0045` (<tiền tố>-<YYMM>-<4 số>) chỉ cấp LÚC GHI SỔ, đánh số lại từ 1 mỗi kỳ theo ngày hạch toán.
--    Bộ đếm là một dòng bảng tăng trong cùng giao dịch ghi sổ: giao dịch lùi thì số cũng lùi, nên dãy số liền mạch.
-- 2. Mã nháp `NHAP_PC_2610_0045` cấp lúc lập phiếu theo dãy riêng; giữ suốt vòng đời phiếu để tra cứu.
-- 3. `code` vẫn là mã đang hiển thị: bằng mã nháp trước khi ghi sổ, bằng mã chính thức sau khi ghi sổ.
--
-- Phiếu cũ giữ nguyên mã (`PC_45_10_2026`): phiếu đã ghi sổ coi mã cũ là mã chính thức; phiếu chưa ghi sổ coi mã cũ là
-- mã nháp và sẽ được cấp mã chính thức dạng mới khi ghi sổ. Bảng `counters` cũ không còn dùng; xoá ở migration sau.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance_schema.code_counters (
    tenant_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('RECEIPT', 'PAYMENT', 'TRANSFER')),
    series VARCHAR(10) NOT NULL CHECK (series IN ('DRAFT', 'OFFICIAL')),
    period CHAR(4) NOT NULL CHECK (period ~ '^[0-9]{2}(0[1-9]|1[0-2])$'),
    last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
    PRIMARY KEY (tenant_id, kind, series, period)
);

ALTER TABLE finance_schema.vouchers
    ADD COLUMN IF NOT EXISTS draft_code VARCHAR(60),
    ADD COLUMN IF NOT EXISTS official_code VARCHAR(60);

UPDATE finance_schema.vouchers SET official_code = code
 WHERE official_code IS NULL AND draft_code IS NULL AND posted_at IS NOT NULL;
UPDATE finance_schema.vouchers SET draft_code = code
 WHERE official_code IS NULL AND draft_code IS NULL AND posted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_vouchers_draft_code
    ON finance_schema.vouchers (tenant_id, draft_code) WHERE draft_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_vouchers_official_code
    ON finance_schema.vouchers (tenant_id, official_code) WHERE official_code IS NOT NULL;
