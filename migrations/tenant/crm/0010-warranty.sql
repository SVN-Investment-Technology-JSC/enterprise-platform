-- Bán hàng (crm) · bảo hành, đổi trả: yêu cầu bảo hành (khách, đơn, nguyên nhân,
-- trạng thái theo mục 5.5 kế hoạch), dòng yêu cầu (serial, hạn bảo hành lúc tiếp
-- nhận, kết quả kiểm định, hướng xử lý, hàng thay thế kế thừa hạn còn lại) và
-- chứng từ sinh ra ở Kho, ở sổ công nợ (khoá chống lặp theo dòng). Mặt hàng,
-- serial, chứng từ kho thuộc Kho: chỉ lưu id và mã, không khoá ngoại sang schema
-- khác. Bảng mới, chưa có dữ liệu cũ; cấu hình kho cách ly, kho lỗi mặc định.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Số thứ tự cho mã yêu cầu `BH<yy><5 chữ số>`.
CREATE SEQUENCE IF NOT EXISTS crm_schema.warranty_case_code_seq;

-- ---------------------------------------------------------------------------
-- YÊU CẦU BẢO HÀNH
--
-- `owner_user_id` là người phụ trách đơn (hoặc khách) để nhân viên kinh doanh
-- thấy yêu cầu của khách mình; `assignee_user_id` là người xử lý (kỹ thuật,
-- CSKH). Phạm vi dữ liệu lọc trên cả hai cột. `chargeable`: có dòng hết hạn bảo
-- hành, xử lý có phí. `quarantine_warehouse_code` chụp lúc gửi nhập trả để gọi
-- lại Kho cùng nội dung.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.warranty_cases (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                      VARCHAR(30) NOT NULL,
    customer_id               UUID NOT NULL REFERENCES crm_schema.customers (id),
    order_id                  UUID REFERENCES crm_schema.sales_orders (id),
    contract_id               UUID REFERENCES crm_schema.contracts (id),
    cause                     VARCHAR(32) NOT NULL
                                CHECK (cause IN ('TECHNICAL_FAULT', 'WRONG_ITEM', 'SHORTAGE', 'CHANGE_OF_MIND', 'POLICY_RETURN')),
    status                    VARCHAR(16) NOT NULL DEFAULT 'RECEIVED'
                                CHECK (status IN ('RECEIVED', 'AWAITING_GOODS', 'INSPECTING', 'RESOLVING', 'RESOLVED',
                                                  'REJECTED', 'CLOSED')),
    description               VARCHAR(4000),
    chargeable                BOOLEAN NOT NULL DEFAULT FALSE,
    owner_user_id             UUID NOT NULL,
    assignee_user_id          UUID,
    quarantine_warehouse_code VARCHAR(50),
    reject_reason             VARCHAR(2000),
    revision                  INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    goods_requested_at        TIMESTAMPTZ,
    received_at               TIMESTAMPTZ,
    resolved_at               TIMESTAMPTZ,
    closed_at                 TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                UUID,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                UUID,

    CONSTRAINT uq_crm_warranty_cases_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS ix_crm_warranty_cases_customer ON crm_schema.warranty_cases (customer_id);
CREATE INDEX IF NOT EXISTS ix_crm_warranty_cases_order ON crm_schema.warranty_cases (order_id);
CREATE INDEX IF NOT EXISTS ix_crm_warranty_cases_owner_status ON crm_schema.warranty_cases (owner_user_id, status);
CREATE INDEX IF NOT EXISTS ix_crm_warranty_cases_assignee ON crm_schema.warranty_cases (assignee_user_id);
CREATE INDEX IF NOT EXISTS ix_crm_warranty_cases_updated ON crm_schema.warranty_cases (updated_at, id);

-- ---------------------------------------------------------------------------
-- DÒNG YÊU CẦU
--
-- Một serial (số lượng 1), hoặc một số lượng của dòng đơn không theo serial.
-- Hạn bảo hành chụp lúc tiếp nhận: ngày giao thực tế, số tháng, nguồn (hợp
-- đồng, mặt hàng, kế thừa), ngày cuối. Hàng nhận về không theo serial vào một
-- lô riêng ở Kho (`received_lot_id`) để đổi chất lượng theo lô. Hàng thay thế:
-- serial thủ kho xuất và hạn kế thừa (Q9).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.warranty_case_lines (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id                     UUID NOT NULL REFERENCES crm_schema.warranty_cases (id) ON DELETE CASCADE,
    line_no                     INTEGER NOT NULL CHECK (line_no >= 1),
    serial                      VARCHAR(100),
    material_id                 UUID NOT NULL,
    material_code               VARCHAR(100) NOT NULL,
    material_name               VARCHAR(300) NOT NULL,
    unit                        VARCHAR(50) NOT NULL,
    quantity                    NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    order_id                    UUID REFERENCES crm_schema.sales_orders (id),
    order_line_id               UUID REFERENCES crm_schema.sales_order_lines (id),
    delivery_warehouse_code     VARCHAR(50),
    delivered_on                DATE,
    warranty_months             INTEGER,
    warranty_source             VARCHAR(16) NOT NULL DEFAULT 'NONE'
                                  CHECK (warranty_source IN ('CONTRACT', 'MATERIAL', 'INHERITED', 'NONE')),
    warranty_until              DATE,
    chargeable                  BOOLEAN NOT NULL DEFAULT FALSE,
    received_at                 TIMESTAMPTZ,
    received_lot_id             UUID,
    received_lot_no             VARCHAR(100),
    inspection_result           VARCHAR(16) CHECK (inspection_result IN ('PASSED', 'DEFECTIVE')),
    inspection_note             VARCHAR(2000),
    inspected_at                TIMESTAMPTZ,
    inspected_by                UUID,
    disposition                 VARCHAR(16) CHECK (disposition IN ('RESTOCK', 'MOVE_TO_DEFECT', 'SCRAP')),
    remedy                      VARCHAR(16) CHECK (remedy IN ('NONE', 'REPLACE', 'REFUND', 'CREDIT')),
    resolution_note             VARCHAR(2000),
    resolved_at                 TIMESTAMPTZ,
    resolved_by                 UUID,
    replacement_warehouse_code  VARCHAR(50),
    replacement_serials         TEXT[] NOT NULL DEFAULT '{}',
    replacement_warranty_until  DATE,
    credit_amount               NUMERIC(18, 2),

    CONSTRAINT uq_crm_warranty_case_lines_no UNIQUE (case_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_crm_warranty_case_lines_case ON crm_schema.warranty_case_lines (case_id);
-- Tra cứu theo serial và theo serial thay thế (Q9).
CREATE INDEX IF NOT EXISTS ix_crm_warranty_case_lines_serial
    ON crm_schema.warranty_case_lines (upper(serial)) WHERE serial IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_warranty_case_lines_replacement
    ON crm_schema.warranty_case_lines USING gin (replacement_serials);

-- ---------------------------------------------------------------------------
-- CHỨNG TỪ CỦA YÊU CẦU
--
-- Mỗi chứng từ một khoá chống lặp `crm-warranty:<id yêu cầu>:...` gửi kèm sang
-- Kho (hoặc sổ công nợ), nên gửi lại bao nhiêu lần vẫn một chứng từ. Trạng thái:
-- PENDING chưa gửi được, REQUESTED nháp chờ thủ kho, PENDING_APPROVAL chờ
-- duyệt, PENDING_RECEIVABLE chờ sổ công nợ, POSTED đã ghi sổ, REVERSED đã đảo.
-- Đóng yêu cầu khi mọi chứng từ đã ghi sổ.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.warranty_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id         UUID NOT NULL REFERENCES crm_schema.warranty_cases (id) ON DELETE CASCADE,
    line_id         UUID REFERENCES crm_schema.warranty_case_lines (id) ON DELETE CASCADE,
    kind            VARCHAR(20) NOT NULL
                      CHECK (kind IN ('RETURN_RECEIPT', 'QUALITY', 'TRANSFER', 'SCRAP', 'REPLACEMENT', 'CREDIT', 'REFUND')),
    seq             INTEGER NOT NULL DEFAULT 1 CHECK (seq >= 1),
    idempotency_key VARCHAR(200) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'REQUESTED', 'PENDING_APPROVAL', 'PENDING_RECEIVABLE', 'POSTED',
                                        'REVERSED')),
    document_id     UUID,
    document_code   VARCHAR(100),
    amount          NUMERIC(18, 2),
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error      VARCHAR(2000),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    posted_at       TIMESTAMPTZ,

    CONSTRAINT uq_crm_warranty_documents_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_crm_warranty_documents_case ON crm_schema.warranty_documents (case_id);
CREATE INDEX IF NOT EXISTS ix_crm_warranty_documents_document
    ON crm_schema.warranty_documents (document_id) WHERE document_id IS NOT NULL;

-- Kho cách ly nhận hàng bảo hành, kho lỗi nhận hàng kiểm định Lỗi (mã kho của Kho).
INSERT INTO crm_schema.settings (key, value)
VALUES ('warranty.quarantineWarehouseCode', '{"code": "QA-KHO-CL"}'::jsonb),
       ('warranty.defectWarehouseCode', '{"code": "QA-KHO-LOI"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
