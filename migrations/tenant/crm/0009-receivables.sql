-- Bán hàng (crm) · công nợ phải thu (D2): sổ công nợ chỉ ghi thêm (trigger chặn
-- UPDATE, DELETE), lần thu tiền (phiếu thu nháp bên Tài chính qua phiếu có nguồn,
-- Q10), phân bổ lần thu vào khoản nợ, chứng từ điều chỉnh có duyệt, yêu cầu duyệt
-- vượt hạn mức của đơn (D5), mốc đã báo quá hạn và vượt hạn mức. View số dư theo
-- khách và theo đơn tính từ sổ, không lưu số dư. Cấu hình ghi nợ khi giao hàng
-- (D3) và vượt hạn mức đưa đi duyệt (D5). Phiếu thu, chứng từ của phân hệ khác
-- chỉ lưu id và mã, không khoá ngoại sang schema khác. Bảng mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Số thứ tự cho mã lần thu `PT<yy><5 chữ số>` và mã điều chỉnh `DC<yy><5 chữ số>`.
CREATE SEQUENCE IF NOT EXISTS crm_schema.receipt_code_seq;
CREATE SEQUENCE IF NOT EXISTS crm_schema.receivable_adjustment_code_seq;

-- ---------------------------------------------------------------------------
-- SỔ CÔNG NỢ
--
-- Mỗi dòng là một phát sinh; `amount` là ảnh hưởng có dấu lên dư nợ:
--   DEBIT       > 0: phát sinh nợ (giao hàng, đến đợt thanh toán của hợp đồng);
--   CREDIT      < 0: lần thu đã ghi sổ bên Tài chính, phân bổ vào khoản nợ
--                    `ref_entry_id` (rỗng: tiền thu chưa phân bổ);
--   ADJUSTMENT <> 0: điều chỉnh đã duyệt (âm: giảm trừ vào `ref_entry_id`; dương:
--                    khoản nợ mới, `ref_entry_id` rỗng);
--   REVERSAL   <> 0: bút đảo của dòng `reverses_entry_id` (chứng từ xuất bị đảo,
--                    phiếu thu bị đảo); `ref_entry_id` là khoản nợ bị ảnh hưởng.
-- "Khoản nợ" (open item) là dòng có `ref_entry_id` rỗng và `amount > 0`; số còn
-- nợ của khoản = `amount` + tổng các dòng trỏ vào nó. Không bao giờ sửa, xoá:
-- sai thì ghi bút đảo hoặc điều chỉnh. `(source_type, source_id)` duy nhất để mỗi
-- chứng từ, mỗi phân bổ chỉ ghi một lần dù sự kiện đến lặp.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.receivable_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind              VARCHAR(16) NOT NULL CHECK (kind IN ('DEBIT', 'CREDIT', 'ADJUSTMENT', 'REVERSAL')),
    customer_id       UUID NOT NULL REFERENCES crm_schema.customers (id),
    order_id          UUID REFERENCES crm_schema.sales_orders (id),
    contract_id       UUID REFERENCES crm_schema.contracts (id),
    -- Đợt thanh toán, đợt giao, lần thu, điều chỉnh: chỉ lưu id (đợt có thể được thay khi hợp đồng còn Nháp).
    payment_term_id   UUID,
    delivery_id       UUID,
    receipt_id        UUID,
    adjustment_id     UUID,
    amount            NUMERIC(18, 2) NOT NULL,
    entry_date        DATE NOT NULL,
    due_date          DATE,
    ref_entry_id      UUID REFERENCES crm_schema.receivable_entries (id),
    reverses_entry_id UUID REFERENCES crm_schema.receivable_entries (id),
    -- Chứng từ gốc: `stock_issue` (id chứng từ xuất Kho), `service_delivery` (id đợt giao chỉ có dịch vụ),
    -- `contract_term`, `receipt_allocation`, `receipt_unapplied`, `receipt_reversal`, `adjustment`...
    source_type       VARCHAR(40) NOT NULL,
    source_id         VARCHAR(200) NOT NULL,
    description       VARCHAR(500),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Rỗng khi hệ thống tự ghi (sự kiện Kho, Tài chính, job).
    created_by        UUID,

    CONSTRAINT uq_crm_receivable_entries_source UNIQUE (source_type, source_id),
    CONSTRAINT ck_crm_receivable_entries_sign CHECK (
        (kind = 'DEBIT' AND amount > 0 AND ref_entry_id IS NULL AND reverses_entry_id IS NULL)
        OR (kind = 'CREDIT' AND amount < 0 AND reverses_entry_id IS NULL)
        OR (kind = 'ADJUSTMENT' AND amount <> 0 AND reverses_entry_id IS NULL
            AND (amount < 0 OR ref_entry_id IS NULL))
        OR (kind = 'REVERSAL' AND amount <> 0 AND reverses_entry_id IS NOT NULL)
    )
);

-- Tuổi nợ, quá hạn theo khách (mục 4.1 kế hoạch).
CREATE INDEX IF NOT EXISTS ix_crm_receivable_entries_customer_due
    ON crm_schema.receivable_entries (customer_id, due_date);
CREATE INDEX IF NOT EXISTS ix_crm_receivable_entries_order
    ON crm_schema.receivable_entries (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_receivable_entries_ref
    ON crm_schema.receivable_entries (ref_entry_id) WHERE ref_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_receivable_entries_contract
    ON crm_schema.receivable_entries (contract_id) WHERE contract_id IS NOT NULL;
-- Dòng thời gian khách hàng.
CREATE INDEX IF NOT EXISTS ix_crm_receivable_entries_customer_created
    ON crm_schema.receivable_entries (customer_id, created_at);

-- Sổ chỉ ghi thêm: chặn UPDATE, DELETE (từng dòng) và TRUNCATE (TC-AR-08).
CREATE OR REPLACE FUNCTION crm_schema.receivable_entries_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Sổ công nợ chỉ ghi thêm; sai sót sửa bằng bút đảo hoặc chứng từ điều chỉnh.'
        USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_receivable_entries_append_only ON crm_schema.receivable_entries;
CREATE TRIGGER trg_crm_receivable_entries_append_only
    BEFORE UPDATE OR DELETE ON crm_schema.receivable_entries
    FOR EACH ROW EXECUTE FUNCTION crm_schema.receivable_entries_append_only();

DROP TRIGGER IF EXISTS trg_crm_receivable_entries_no_truncate ON crm_schema.receivable_entries;
CREATE TRIGGER trg_crm_receivable_entries_no_truncate
    BEFORE TRUNCATE ON crm_schema.receivable_entries
    FOR EACH STATEMENT EXECUTE FUNCTION crm_schema.receivable_entries_append_only();

-- ---------------------------------------------------------------------------
-- LẦN THU TIỀN
--
-- PENDING_VOUCHER: chờ Tài chính tạo phiếu thu (lệnh ở `integration_requests`,
-- khoá `crm-receipt:<id>`, gửi lại thì thêm số lần); VOUCHER_DRAFT: Tài chính đã
-- có phiếu nháp, chờ kế toán ghi sổ; POSTED: phiếu đã ghi sổ, phân bổ có hiệu
-- lực (dòng CREDIT); RETURNED: kế toán trả lại, người thu sửa rồi gửi lại;
-- REVERSED: phiếu đã ghi sổ bị đảo, phân bổ đã đảo; CANCELLED: bỏ lần thu.
-- `revision` tăng mỗi lần sửa (khoá lạc quan).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.receipts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                 VARCHAR(30) NOT NULL,
    customer_id          UUID NOT NULL REFERENCES crm_schema.customers (id),
    amount               NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    method               VARCHAR(16) NOT NULL CHECK (method IN ('CASH', 'BANK_TRANSFER')),
    receipt_date         DATE NOT NULL,
    note                 VARCHAR(2000),
    status               VARCHAR(16) NOT NULL DEFAULT 'PENDING_VOUCHER'
                           CHECK (status IN ('PENDING_VOUCHER', 'VOUCHER_DRAFT', 'POSTED', 'RETURNED', 'REVERSED', 'CANCELLED')),
    -- Khoá chống lặp của lần gửi Tài chính hiện tại (`crm-receipt:<id>`, gửi lại: `crm-receipt:<id>:<n>`).
    idempotency_key      VARCHAR(200) NOT NULL,
    voucher_attempt      INTEGER NOT NULL DEFAULT 1 CHECK (voucher_attempt >= 1),
    finance_voucher_id   UUID,
    finance_voucher_code VARCHAR(100),
    -- Tài chính từ chối tạo phiếu (dữ liệu sai) hoặc lý do trả lại.
    voucher_error        VARCHAR(2000),
    return_reason        VARCHAR(2000),
    posted_at            TIMESTAMPTZ,
    reversed_at          TIMESTAMPTZ,
    revision             INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by           UUID,

    CONSTRAINT uq_crm_receipts_code UNIQUE (code),
    CONSTRAINT uq_crm_receipts_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_crm_receipts_customer ON crm_schema.receipts (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_receipts_status ON crm_schema.receipts (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_receipts_voucher ON crm_schema.receipts (finance_voucher_id) WHERE finance_voucher_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- PHÂN BỔ LẦN THU
--
-- Lần thu chia vào một hay nhiều khoản nợ. Chưa ghi sổ thì phân bổ chỉ "giữ chỗ"
-- (không cho lần thu khác phân bổ vượt số còn nợ); ghi sổ thì sinh dòng CREDIT
-- (`credit_entry_id`). Sửa lần thu bị trả lại thì thay toàn bộ phân bổ.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.receipt_allocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id      UUID NOT NULL REFERENCES crm_schema.receipts (id) ON DELETE CASCADE,
    entry_id        UUID NOT NULL REFERENCES crm_schema.receivable_entries (id),
    amount          NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    credit_entry_id UUID REFERENCES crm_schema.receivable_entries (id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_receipt_allocations_entry UNIQUE (receipt_id, entry_id)
);

CREATE INDEX IF NOT EXISTS ix_crm_receipt_allocations_entry ON crm_schema.receipt_allocations (entry_id);

-- ---------------------------------------------------------------------------
-- ĐIỀU CHỈNH CÔNG NỢ
--
-- Giảm trừ (trả hàng, chiết khấu thanh toán, xoá nợ) hoặc tăng nợ, có lý do và
-- người duyệt khác người lập (AR-05). DRAFT chờ duyệt; APPROVED đã ghi dòng
-- ADJUSTMENT; CANCELLED bỏ. Phân hệ khác trong Bán hàng (bảo hành) tạo qua
-- `source_type`, `source_id`: gọi lặp trả lại điều chỉnh đã có.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.receivable_adjustments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code         VARCHAR(30) NOT NULL,
    customer_id  UUID NOT NULL REFERENCES crm_schema.customers (id),
    order_id     UUID REFERENCES crm_schema.sales_orders (id),
    entry_id     UUID REFERENCES crm_schema.receivable_entries (id),
    direction    VARCHAR(16) NOT NULL CHECK (direction IN ('DECREASE', 'INCREASE')),
    amount       NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    reason       VARCHAR(2000) NOT NULL,
    status       VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'CANCELLED')),
    source_type  VARCHAR(40),
    source_id    VARCHAR(200),
    approved_by  UUID,
    approved_at  TIMESTAMPTZ,
    cancel_reason VARCHAR(2000),
    revision     INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   UUID,

    CONSTRAINT uq_crm_receivable_adjustments_code UNIQUE (code),
    CONSTRAINT ck_crm_receivable_adjustments_approver CHECK (status <> 'APPROVED' OR approved_by IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_receivable_adjustments_source
    ON crm_schema.receivable_adjustments (source_type, source_id) WHERE source_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_receivable_adjustments_customer
    ON crm_schema.receivable_adjustments (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crm_receivable_adjustments_status
    ON crm_schema.receivable_adjustments (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- DUYỆT VƯỢT HẠN MỨC CỦA ĐƠN (D5)
--
-- Mỗi lần xác nhận đơn vượt hạn mức (cấu hình "duyệt") sinh một yêu cầu; đơn
-- sang Chờ duyệt hạn mức. DIRECT: người thấy toàn bộ dữ liệu duyệt trong Bán
-- hàng; PROCEDURE: phiên Quy trình `crm_order_credit` (`procedure_links.source_id`
-- là id yêu cầu). Mỗi đơn chỉ một yêu cầu đang chờ.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.order_credit_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES crm_schema.sales_orders (id),
    customer_id   UUID NOT NULL REFERENCES crm_schema.customers (id),
    order_amount  NUMERIC(18, 2) NOT NULL,
    balance       NUMERIC(18, 2) NOT NULL,
    credit_limit  NUMERIC(18, 2) NOT NULL,
    mode          VARCHAR(16) NOT NULL CHECK (mode IN ('DIRECT', 'PROCEDURE')),
    status        VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    message       VARCHAR(2000),
    decided_by    UUID,
    decided_at    TIMESTAMPTZ,
    decision_note VARCHAR(2000),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_order_credit_requests_pending
    ON crm_schema.order_credit_requests (order_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_crm_order_credit_requests_order
    ON crm_schema.order_credit_requests (order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- MỐC ĐÃ BÁO
--
-- Job cảnh báo quá hạn, vượt hạn mức ghi khoá ở đây để mỗi khoản quá hạn chỉ báo
-- một lần, mỗi đợt vượt hạn mức chỉ báo một lần (về dưới hạn mức thì xoá khoá để
-- lần vượt sau báo lại).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.receivable_alerts (
    alert_key  VARCHAR(200) PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- VIEW SỐ DƯ
-- ---------------------------------------------------------------------------

-- Khoản nợ và số còn nợ (kể cả khoản đã thu đủ, số còn nợ bằng 0).
CREATE OR REPLACE VIEW crm_schema.receivable_open_items AS
SELECT e.id,
       e.kind,
       e.customer_id,
       e.order_id,
       e.contract_id,
       e.payment_term_id,
       e.delivery_id,
       e.entry_date,
       e.due_date,
       e.amount,
       e.description,
       e.source_type,
       e.created_at,
       e.amount + COALESCE(s.settled, 0) AS open_amount
  FROM crm_schema.receivable_entries e
  LEFT JOIN LATERAL (
       SELECT sum(x.amount) AS settled
         FROM crm_schema.receivable_entries x
        WHERE x.ref_entry_id = e.id
  ) s ON TRUE
 WHERE e.ref_entry_id IS NULL AND e.amount > 0 AND e.kind IN ('DEBIT', 'ADJUSTMENT');

-- Dư nợ theo khách: tổng có dấu của sổ.
CREATE OR REPLACE VIEW crm_schema.receivable_customer_balances AS
SELECT customer_id,
       sum(amount) FILTER (WHERE kind = 'DEBIT') AS debited,
       -sum(amount) FILTER (WHERE kind = 'CREDIT') AS collected,
       sum(amount) FILTER (WHERE kind IN ('ADJUSTMENT', 'REVERSAL')) AS adjusted,
       sum(amount) AS balance
  FROM crm_schema.receivable_entries
 GROUP BY customer_id;

-- Số còn phải thu theo đơn (T5-11, Q8).
CREATE OR REPLACE VIEW crm_schema.receivable_order_balances AS
SELECT order_id,
       sum(amount) FILTER (WHERE kind = 'DEBIT') AS debited,
       -sum(amount) FILTER (WHERE kind = 'CREDIT') AS collected,
       sum(amount) FILTER (WHERE kind IN ('ADJUSTMENT', 'REVERSAL')) AS adjusted,
       sum(amount) AS outstanding
  FROM crm_schema.receivable_entries
 WHERE order_id IS NOT NULL
 GROUP BY order_id;

-- ---------------------------------------------------------------------------
-- CẤU HÌNH
-- ---------------------------------------------------------------------------

-- Ghi nợ khi chứng từ xuất giao hàng được ghi sổ (D3); hợp đồng có đợt thì theo đợt.
INSERT INTO crm_schema.settings (key, value)
VALUES ('receivable.recognition', '{"mode": "ON_DELIVERY"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Vượt hạn mức công nợ khi xác nhận đơn: đưa đi duyệt (D5); "BLOCK" thì chặn.
INSERT INTO crm_schema.settings (key, value)
VALUES ('credit.limit', '{"mode": "APPROVAL"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Người nhận thêm cảnh báo quá hạn, vượt hạn mức (kế toán công nợ), ngoài người phụ trách khách.
INSERT INTO crm_schema.settings (key, value)
VALUES ('receivable.alerts', '{"userIds": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;
