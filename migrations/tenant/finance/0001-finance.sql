SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Finance Schema: Tài chính (phiếu thu, phiếu chi, lệnh chuyển tiền, tài khoản, báo cáo)
-- Nguyên tắc:
-- 1. Schema riêng của module (finance_schema); chỉ tham chiếu Core bằng uuid, không FK chéo schema.
-- 2. Sổ cái chỉ thêm (ledger_entries): số dư tài khoản = số dư đầu kỳ + tổng bút toán.
--    Phiếu chỉ ghi sổ khi được duyệt; huỷ phiếu đã ghi sổ bằng bút toán đảo, không sửa/xoá dòng cũ.
-- 3. Mọi bất biến về dữ liệu (tiền không âm, nguồn khác đích, mã phiếu duy nhất) có CHECK/UNIQUE ở DB.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS finance_schema;

-- ----------------------------------------------------------------------------
-- 1. Danh mục
-- ----------------------------------------------------------------------------

-- Tài khoản ngân hàng / quỹ tiền mặt của công ty.
CREATE TABLE IF NOT EXISTS finance_schema.accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('BANK', 'CASH')),
    bank_name VARCHAR(120),
    account_number VARCHAR(60),
    account_holder VARCHAR(255),
    branch VARCHAR(255),
    currency CHAR(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    opening_date DATE NOT NULL DEFAULT CURRENT_DATE,
    allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_accounts_code UNIQUE (tenant_id, code),
    -- Tài khoản ngân hàng phải có số tài khoản; quỹ tiền mặt thì không.
    CONSTRAINT ck_finance_accounts_bank_number CHECK (account_type <> 'BANK' OR account_number IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_finance_accounts_tenant ON finance_schema.accounts (tenant_id, is_active);

-- Lý do thu / lý do chi.
CREATE TABLE IF NOT EXISTS finance_schema.reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('RECEIPT', 'PAYMENT')),
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_reasons_code UNIQUE (tenant_id, kind, code)
);

-- Nhóm đối tượng thu/chi: khách hàng, nhà cung cấp, nhân viên...
CREATE TABLE IF NOT EXISTS finance_schema.counterparty_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_counterparty_groups_code UNIQUE (tenant_id, code)
);

-- Trung tâm chi phí / đơn vị hạch toán nội bộ.
CREATE TABLE IF NOT EXISTS finance_schema.cost_centers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_finance_cost_centers_code UNIQUE (tenant_id, code)
);

-- Cấu hình chung của tenant: khoá sổ và quy tắc tự duyệt.
CREATE TABLE IF NOT EXISTS finance_schema.settings (
    tenant_id UUID PRIMARY KEY,
    books_locked_until DATE,
    allow_self_approval BOOLEAN NOT NULL DEFAULT FALSE,
    -- Đã nạp nhóm đối tượng mặc định một lần; xoá hết sau đó thì không nạp lại.
    defaults_seeded BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Bộ đếm mã phiếu theo loại. Tăng nguyên tử trong cùng giao dịch tạo phiếu.
CREATE TABLE IF NOT EXISTS finance_schema.counters (
    tenant_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('RECEIPT', 'PAYMENT', 'TRANSFER')),
    last_value BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, kind)
);

-- ----------------------------------------------------------------------------
-- 2. Phiếu
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_schema.vouchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('RECEIPT', 'PAYMENT', 'TRANSFER')),
    code VARCHAR(60) NOT NULL,
    voucher_date DATE NOT NULL,
    posting_date DATE NOT NULL,
    content VARCHAR(500) NOT NULL,
    reason_id UUID REFERENCES finance_schema.reasons(id),
    -- Phiếu thu/chi: tài khoản thu/chi. Lệnh chuyển tiền: tài khoản nguồn.
    account_id UUID REFERENCES finance_schema.accounts(id),
    dest_account_id UUID REFERENCES finance_schema.accounts(id),
    counterparty_group_id UUID REFERENCES finance_schema.counterparty_groups(id),
    counterparty_name VARCHAR(255),
    counterparty_account_no VARCHAR(60),
    counterparty_bank VARCHAR(120),
    cost_center_id UUID REFERENCES finance_schema.cost_centers(id),
    tax_included BOOLEAN NOT NULL DEFAULT FALSE,
    tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    total_amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    revision INTEGER NOT NULL DEFAULT 1,
    approval_mode VARCHAR(20) NOT NULL DEFAULT 'DIRECT' CHECK (approval_mode IN ('DIRECT', 'PROCEDURE')),
    created_by UUID NOT NULL,
    -- Tên người thao tác lưu kèm (bản chụp) để module không phải đọc bảng người dùng của Core.
    created_by_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_by UUID,
    submitted_at TIMESTAMPTZ,
    decided_by UUID,
    decided_by_name VARCHAR(255),
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    posted_at TIMESTAMPTZ,
    CONSTRAINT uq_finance_vouchers_code UNIQUE (tenant_id, code),
    -- Chỉ lệnh chuyển tiền có tài khoản đích; nguồn và đích phải khác nhau.
    CONSTRAINT ck_finance_vouchers_dest CHECK (kind = 'TRANSFER' OR dest_account_id IS NULL),
    CONSTRAINT ck_finance_vouchers_transfer_accounts CHECK (
        kind <> 'TRANSFER' OR account_id IS NULL OR dest_account_id IS NULL OR account_id <> dest_account_id
    ),
    -- Phiếu đã ghi sổ phải có đủ tài khoản và dấu thời gian ghi sổ.
    CONSTRAINT ck_finance_vouchers_posted CHECK (
        status <> 'APPROVED' OR (posted_at IS NOT NULL AND account_id IS NOT NULL AND (kind <> 'TRANSFER' OR dest_account_id IS NOT NULL))
    )
);
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_list ON finance_schema.vouchers (tenant_id, kind, status, voucher_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_creator ON finance_schema.vouchers (tenant_id, created_by, kind);
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_account ON finance_schema.vouchers (tenant_id, account_id) WHERE account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_dest_account ON finance_schema.vouchers (tenant_id, dest_account_id) WHERE dest_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_reason ON finance_schema.vouchers (tenant_id, reason_id, posting_date) WHERE status = 'APPROVED';

CREATE TABLE IF NOT EXISTS finance_schema.voucher_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_id UUID NOT NULL REFERENCES finance_schema.vouchers(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL,
    description VARCHAR(500) NOT NULL,
    quantity NUMERIC(18,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_amount NUMERIC(18,2) NOT NULL CHECK (unit_amount >= 0),
    total NUMERIC(18,2) NOT NULL CHECK (total >= 0),
    CONSTRAINT uq_finance_voucher_lines UNIQUE (voucher_id, line_no)
);

CREATE TABLE IF NOT EXISTS finance_schema.voucher_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_id UUID NOT NULL REFERENCES finance_schema.vouchers(id) ON DELETE CASCADE,
    invoice_no VARCHAR(80) NOT NULL,
    invoice_date DATE,
    tax_code VARCHAR(30),
    amount NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_finance_voucher_invoices_voucher ON finance_schema.voucher_invoices (voucher_id);

CREATE TABLE IF NOT EXISTS finance_schema.voucher_related (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_id UUID NOT NULL REFERENCES finance_schema.vouchers(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('VOUCHER', 'REFERENCE')),
    related_voucher_id UUID REFERENCES finance_schema.vouchers(id) ON DELETE SET NULL,
    label VARCHAR(255) NOT NULL,
    CONSTRAINT ck_finance_voucher_related_target CHECK (kind <> 'VOUCHER' OR related_voucher_id IS NOT NULL OR label <> '')
);
CREATE INDEX IF NOT EXISTS idx_finance_voucher_related_voucher ON finance_schema.voucher_related (voucher_id);

CREATE TABLE IF NOT EXISTS finance_schema.voucher_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_id UUID NOT NULL REFERENCES finance_schema.vouchers(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    storage_key VARCHAR(500) NOT NULL,
    uploaded_by UUID,
    uploaded_by_name VARCHAR(255),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_voucher_attachments_voucher ON finance_schema.voucher_attachments (voucher_id);

-- Nhật ký thao tác trên phiếu (lập, gửi duyệt, duyệt, từ chối, huỷ, đảo).
CREATE TABLE IF NOT EXISTS finance_schema.voucher_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    voucher_id UUID NOT NULL REFERENCES finance_schema.vouchers(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'REVERSED')),
    actor_id UUID,
    actor_name VARCHAR(255),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_finance_voucher_events_voucher ON finance_schema.voucher_events (voucher_id, created_at);

-- ----------------------------------------------------------------------------
-- 3. Sổ cái tài khoản (chỉ thêm)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance_schema.ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq BIGINT GENERATED ALWAYS AS IDENTITY,
    tenant_id UUID NOT NULL,
    account_id UUID NOT NULL REFERENCES finance_schema.accounts(id),
    voucher_id UUID NOT NULL REFERENCES finance_schema.vouchers(id),
    posted_date DATE NOT NULL,
    -- Dương: tiền vào tài khoản. Âm: tiền ra khỏi tài khoản.
    amount NUMERIC(18,2) NOT NULL CHECK (amount <> 0),
    description VARCHAR(500),
    is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Mỗi phiếu ghi sổ đúng một lần và đảo đúng một lần cho mỗi tài khoản.
    CONSTRAINT uq_finance_ledger_voucher_account UNIQUE (voucher_id, account_id, is_reversal)
);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_account ON finance_schema.ledger_entries (tenant_id, account_id, seq);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_posted ON finance_schema.ledger_entries (tenant_id, posted_date);

-- Sổ cái không được sửa hay xoá: sai thì ghi bút toán đảo.
CREATE OR REPLACE FUNCTION finance_schema.forbid_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Sổ cái tài chính chỉ được thêm; dùng bút toán đảo để điều chỉnh.'
        USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_finance_ledger_immutable ON finance_schema.ledger_entries;
CREATE TRIGGER trg_finance_ledger_immutable
    BEFORE UPDATE OR DELETE ON finance_schema.ledger_entries
    FOR EACH ROW EXECUTE FUNCTION finance_schema.forbid_ledger_mutation();
