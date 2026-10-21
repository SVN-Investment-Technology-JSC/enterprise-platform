-- 1. Số dư được phép âm thay vì chặn duyệt phiếu: mọi tài khoản hiện có chuyển sang cho phép âm, tài khoản mới mặc định
--    cho phép âm. Ai cần chặn cho riêng một tài khoản thì vẫn tắt được ở màn Tài khoản (cột allow_negative giữ nguyên).
-- 2. Cấu hình cột hiển thị của danh sách phiếu theo từng người dùng (mỗi người chọn cột riêng, theo từng loại phiếu).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE finance_schema.accounts ALTER COLUMN allow_negative SET DEFAULT TRUE;
UPDATE finance_schema.accounts SET allow_negative = TRUE, updated_at = now() WHERE allow_negative = FALSE;

CREATE TABLE IF NOT EXISTS finance_schema.user_list_columns (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    -- Danh sách nào: RECEIPT, PAYMENT, TRANSFER.
    list_key VARCHAR(40) NOT NULL,
    -- Mã các cột đang hiện, theo thứ tự hiển thị.
    columns JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, list_key),
    CONSTRAINT ck_finance_user_list_columns_array CHECK (jsonb_typeof(columns) = 'array')
);
