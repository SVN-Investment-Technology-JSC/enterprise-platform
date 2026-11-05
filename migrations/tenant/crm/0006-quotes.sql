-- Bán hàng (crm) · báo giá: báo giá theo phiên bản (sửa bản đã duyệt sinh phiên
-- bản mới, bản cũ chỉ đọc), dòng báo giá chụp giá, chiết khấu, giá vốn ước tính
-- lúc tính; liên kết sang phiên duyệt của Quy trình (`crm_quote`,
-- `crm_order_credit`); cách duyệt theo loại; ngưỡng duyệt theo vai trò. Mặt hàng
-- thuộc Kho, định nghĩa quy trình thuộc Quy trình: chỉ lưu id và bản chụp, không
-- có khoá ngoại sang schema khác. Bảng mới, chưa có dữ liệu cũ.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Số thứ tự cho mã báo giá `BG<yy><5 chữ số>`.
CREATE SEQUENCE IF NOT EXISTS crm_schema.quote_code_seq;

-- ---------------------------------------------------------------------------
-- BÁO GIÁ
--
-- Một báo giá gắn một khách (và có thể một cơ hội). `status`, `valid_until`
-- chép từ phiên bản hiện tại (`current_version`) để lọc danh sách, chạy job hết
-- hạn mà không phải nối bảng phiên bản. `converted_at` có khi báo giá đã chuyển
-- thành hợp đồng, đơn (GĐ4); khi đó Quy trình không được thu hồi phiên duyệt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.quotes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(30) NOT NULL,
    opportunity_id  UUID REFERENCES crm_schema.opportunities (id),
    customer_id     UUID NOT NULL REFERENCES crm_schema.customers (id),
    owner_user_id   UUID NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'PENDING', 'REJECTED', 'APPROVED', 'SENT', 'ACCEPTED',
                                        'DECLINED', 'EXPIRED', 'SUPERSEDED')),
    current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
    valid_until     DATE,
    -- Phiên bản khách chấp nhận.
    accepted_version INTEGER,
    converted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      UUID,

    CONSTRAINT uq_crm_quotes_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS ix_crm_quotes_owner_status ON crm_schema.quotes (owner_user_id, status);
CREATE INDEX IF NOT EXISTS ix_crm_quotes_valid_until ON crm_schema.quotes (valid_until)
    WHERE status IN ('APPROVED', 'SENT');
CREATE INDEX IF NOT EXISTS ix_crm_quotes_opportunity ON crm_schema.quotes (opportunity_id);
CREATE INDEX IF NOT EXISTS ix_crm_quotes_customer ON crm_schema.quotes (customer_id);
CREATE INDEX IF NOT EXISTS ix_crm_quotes_updated ON crm_schema.quotes (updated_at, id);

-- ---------------------------------------------------------------------------
-- PHIÊN BẢN
--
-- Trạng thái theo mục 5.2 kế hoạch. Chỉ phiên bản hiện tại ở Nháp mới sửa được;
-- sửa bản Đã duyệt, Đã gửi khách, Từ chối duyệt thì bản đó sang SUPERSEDED và
-- sinh bản mới ở Nháp. `revision` tăng mỗi lần lưu để hai người sửa cùng lúc
-- không ghi đè nhau. Tiền `numeric(18,2)` làm tròn đến đồng (Q3); tỷ lệ
-- `numeric(7,4)`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.quote_versions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id          UUID NOT NULL REFERENCES crm_schema.quotes (id) ON DELETE CASCADE,
    version_no        INTEGER NOT NULL CHECK (version_no >= 1),
    status            VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
                        CHECK (status IN ('DRAFT', 'PENDING', 'REJECTED', 'APPROVED', 'SENT', 'ACCEPTED',
                                          'DECLINED', 'EXPIRED', 'SUPERSEDED')),
    revision          INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    valid_until       DATE,
    -- Ngày tính giá người dùng chọn; rỗng là ngày tính (hôm nay theo giờ Việt Nam).
    price_date        DATE,
    -- Ngày đã dùng ở lần tính gần nhất.
    priced_on         DATE,
    note              VARCHAR(4000),
    -- Phí vận chuyển là một dòng dịch vụ có thuế suất riêng (Q3); `shipping_cost`
    -- là chi phí bên bán chịu, trừ vào lợi nhuận.
    shipping_amount   NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (shipping_amount >= 0),
    shipping_vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 10 CHECK (shipping_vat_rate >= 0 AND shipping_vat_rate <= 100),
    shipping_cost     NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
    gross_amount      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    discount_amount   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    net_amount        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_amount        NUMERIC(18, 2) NOT NULL DEFAULT 0,
    total_amount      NUMERIC(18, 2) NOT NULL DEFAULT 0,
    est_cost          NUMERIC(18, 2) NOT NULL DEFAULT 0,
    profit            NUMERIC(18, 2) NOT NULL DEFAULT 0,
    -- Rỗng khi doanh thu bằng 0.
    margin_percent    NUMERIC(9, 2),
    discount_percent  NUMERIC(7, 4) NOT NULL DEFAULT 0,
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    -- Danh sách `{ code, message }` lúc gửi duyệt.
    approval_reasons  JSONB NOT NULL DEFAULT '[]'::jsonb,
    submitted_at      TIMESTAMPTZ,
    submitted_by      UUID,
    approved_at       TIMESTAMPTZ,
    -- Rỗng khi Quy trình duyệt mà không biết người duyệt, hoặc duyệt thẳng.
    approved_by       UUID,
    rejected_at       TIMESTAMPTZ,
    rejected_by       UUID,
    decision_reason   VARCHAR(2000),
    sent_at           TIMESTAMPTZ,
    responded_at      TIMESTAMPTZ,
    superseded_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        UUID,

    CONSTRAINT uq_crm_quote_versions_no UNIQUE (quote_id, version_no)
);

CREATE INDEX IF NOT EXISTS ix_crm_quote_versions_status ON crm_schema.quote_versions (status, valid_until);

-- ---------------------------------------------------------------------------
-- DÒNG BÁO GIÁ
--
-- Mã, tên, đơn vị, loại mặt hàng là bản chụp từ danh mục Kho. Giá vốn ước tính
-- là giá bình quân của Kho lúc tính (D4), không phải giá vốn thực tế.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.quote_lines (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id                UUID NOT NULL REFERENCES crm_schema.quote_versions (id) ON DELETE CASCADE,
    line_no                   INTEGER NOT NULL CHECK (line_no >= 1),
    material_id               UUID NOT NULL,
    material_code             VARCHAR(100) NOT NULL,
    material_name             VARCHAR(300) NOT NULL,
    unit                      VARCHAR(50) NOT NULL,
    -- STOCK hoặc SERVICE theo danh mục Kho; SERVICE không có tồn.
    material_kind             VARCHAR(16) NOT NULL DEFAULT 'STOCK',
    category                  VARCHAR(300),
    quantity                  NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    list_price                NUMERIC(18, 2) NOT NULL CHECK (list_price >= 0),
    price_source              VARCHAR(16) NOT NULL CHECK (price_source IN ('CONTRACT', 'GROUP_LIST', 'STANDARD_LIST', 'MANUAL')),
    price_reference_id        UUID,
    price_reference_code      VARCHAR(100),
    policy_percent            NUMERIC(7, 4) NOT NULL DEFAULT 0,
    discount_percent          NUMERIC(7, 4) NOT NULL DEFAULT 0,
    capped_at                 NUMERIC(7, 4),
    overridden                BOOLEAN NOT NULL DEFAULT FALSE,
    override_unit_price       NUMERIC(18, 2),
    override_discount_percent NUMERIC(7, 4),
    unit_price                NUMERIC(18, 2) NOT NULL,
    gross_amount              NUMERIC(18, 2) NOT NULL,
    discount_amount           NUMERIC(18, 2) NOT NULL,
    vat_rate                  NUMERIC(5, 2) NOT NULL,
    line_amount               NUMERIC(18, 2) NOT NULL,
    vat_amount                NUMERIC(18, 2) NOT NULL,
    line_total                NUMERIC(18, 2) NOT NULL,
    -- Rỗng khi Kho chưa có giá vốn cho mặt hàng.
    est_unit_cost             NUMERIC(18, 4),
    est_cost                  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    -- Rỗng khi thành tiền bằng 0.
    margin                    NUMERIC(9, 2),
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_quote_lines_no UNIQUE (version_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_crm_quote_lines_version ON crm_schema.quote_lines (version_id);

-- Chính sách chiết khấu đã áp cho dòng (PRC-04), chụp lại mã, tên, phần trăm.
CREATE TABLE IF NOT EXISTS crm_schema.quote_line_policies (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    line_id    UUID NOT NULL REFERENCES crm_schema.quote_lines (id) ON DELETE CASCADE,
    policy_id  UUID NOT NULL,
    code       VARCHAR(50) NOT NULL,
    name       VARCHAR(200) NOT NULL,
    stacking   VARCHAR(8) NOT NULL CHECK (stacking IN ('STACK', 'MAX')),
    exclusive  BOOLEAN NOT NULL DEFAULT FALSE,
    percent    NUMERIC(7, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_crm_quote_line_policies_line ON crm_schema.quote_line_policies (line_id);

-- ---------------------------------------------------------------------------
-- LIÊN KẾT SANG QUY TRÌNH
--
-- Một lần gửi duyệt qua Quy trình là một dòng, ghi cùng transaction với việc
-- chuyển sang Chờ duyệt; worker tạo phiên (`POST /v1/internal/instances`) và
-- thử lại theo lease. `id` là `sourceId` của phiên, `start_idempotency_key`
-- (`crm:<id>`) là khoá chống lặp bên Quy trình. Mỗi đối tượng (phiên bản báo
-- giá, đơn) chỉ có một liên kết.
--
-- `status`: START_PENDING chờ tạo phiên; RUNNING đã có phiên; FAILED tạo lỗi
-- (thử lại khi hết lease); APPLIED đã áp kết quả; CLOSED bỏ (đối tượng đã đổi).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.procedure_links (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type           VARCHAR(40) NOT NULL CHECK (source_type IN ('crm_quote', 'crm_order_credit')),
    source_id             UUID NOT NULL,
    definition_id         UUID NOT NULL,
    title                 VARCHAR(500) NOT NULL,
    initiated_by          UUID NOT NULL,
    instance_id           UUID,
    instance_code         VARCHAR(100),
    start_idempotency_key VARCHAR(200) NOT NULL,
    status                VARCHAR(16) NOT NULL DEFAULT 'START_PENDING'
                            CHECK (status IN ('START_PENDING', 'RUNNING', 'FAILED', 'APPLIED', 'CLOSED')),
    -- completed, rejected, cancelled theo `procedure.instance.completed`.
    result                VARCHAR(16),
    result_reason         VARCHAR(2000),
    result_event_id       UUID,
    lease_token           UUID,
    lease_until           TIMESTAMPTZ,
    attempts              INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error            VARCHAR(2000),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_procedure_links_key UNIQUE (start_idempotency_key),
    CONSTRAINT uq_crm_procedure_links_source UNIQUE (source_type, source_id)
);

-- Worker tìm liên kết chờ tạo phiên.
CREATE INDEX IF NOT EXISTS ix_crm_procedure_links_due
    ON crm_schema.procedure_links (status, lease_until)
    WHERE status IN ('START_PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS ix_crm_procedure_links_instance ON crm_schema.procedure_links (instance_id);

-- ---------------------------------------------------------------------------
-- CÁCH DUYỆT
--
-- Mỗi loại một dòng (mẫu `approval_bindings` của Tài chính). Chưa có dòng là
-- duyệt trực tiếp: người có `crm.quote.approve` duyệt trong Bán hàng.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.approval_bindings (
    kind                      VARCHAR(20) PRIMARY KEY CHECK (kind IN ('QUOTE', 'ORDER_CREDIT')),
    mode                      VARCHAR(20) NOT NULL DEFAULT 'DIRECT' CHECK (mode IN ('DIRECT', 'PROCEDURE')),
    procedure_definition_id   UUID,
    procedure_definition_name VARCHAR(300),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                UUID,

    CONSTRAINT ck_crm_approval_bindings_definition CHECK (mode = 'DIRECT' OR procedure_definition_id IS NOT NULL)
);

-- Ngưỡng duyệt báo giá (PRC-05): hạn mức chiết khấu theo vai trò người lập
-- (nhân viên, trưởng nhóm, quản lý; rỗng là không giới hạn) và biên lợi nhuận
-- tối thiểu, đơn vị phần trăm.
INSERT INTO crm_schema.settings (key, value)
VALUES ('quote.approval', '{"roleLimits": {"staff": 5, "teamLead": 15, "manager": null}, "minMarginPercent": 10}'::jsonb)
ON CONFLICT (key) DO NOTHING;
