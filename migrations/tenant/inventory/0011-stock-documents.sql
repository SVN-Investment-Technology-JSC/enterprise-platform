-- Chứng từ kho (INV-01, INV-02): một chứng từ nhiều dòng, có máy trạng thái
-- Nháp → Chờ duyệt → Đã duyệt → Đã ghi sổ, ghi sổ cả chứng từ trong một
-- transaction. Sổ kho `inventory_transactions` thêm `document_id` cho phép NULL:
-- bút toán cũ giữ NULL, không chuyển dữ liệu. Sổ kho từ nay chỉ ghi thêm: trigger
-- chặn UPDATE và DELETE (code hiện tại chưa từng sửa hay xoá dòng sổ nào).
-- Chạy lại được: mọi lệnh đều IF NOT EXISTS hoặc CREATE OR REPLACE.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS inventory_schema.stock_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(60) NOT NULL UNIQUE,
    doc_type VARCHAR(40) NOT NULL CHECK (doc_type IN (
        'RECEIPT_PURCHASE', 'RECEIPT_SALES_RETURN', 'RECEIPT_TRANSFER', 'RECEIPT_OTHER',
        'ISSUE_SALES', 'ISSUE_PROJECT', 'ISSUE_WARRANTY', 'ISSUE_TRANSFER', 'ISSUE_OTHER',
        'ADJUSTMENT', 'TRANSFER'
    )),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'POSTED', 'CANCELLED'
    )),
    warehouse_id UUID NOT NULL REFERENCES inventory_schema.warehouses(id),
    target_warehouse_id UUID REFERENCES inventory_schema.warehouses(id),
    source_type VARCHAR(50),
    source_id UUID,
    idempotency_key VARCHAR(200) UNIQUE,
    document_date DATE NOT NULL DEFAULT CURRENT_DATE,
    note TEXT,
    reject_reason TEXT,
    reverses_document_id UUID REFERENCES inventory_schema.stock_documents(id),
    created_by UUID NOT NULL,
    submitted_by UUID,
    submitted_at TIMESTAMPTZ,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejected_by UUID,
    rejected_at TIMESTAMPTZ,
    posted_by UUID,
    posted_at TIMESTAMPTZ,
    cancelled_by UUID,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Điều chuyển luôn có kho đích khác kho đi.
    CONSTRAINT stock_documents_transfer_target_check CHECK (
        doc_type <> 'TRANSFER'
        OR (target_warehouse_id IS NOT NULL AND target_warehouse_id <> warehouse_id)
    )
);

CREATE INDEX IF NOT EXISTS idx_stock_documents_status
    ON inventory_schema.stock_documents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_documents_warehouse
    ON inventory_schema.stock_documents(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_documents_source
    ON inventory_schema.stock_documents(source_type, source_id)
    WHERE source_id IS NOT NULL;
-- Mỗi chứng từ gốc chỉ có một chứng từ đảo: bấm "Đảo" hai lần không đảo hai lần.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_documents_reverses
    ON inventory_schema.stock_documents(reverses_document_id)
    WHERE reverses_document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_schema.stock_document_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES inventory_schema.stock_documents(id) ON DELETE CASCADE,
    line_no INTEGER NOT NULL CHECK (line_no > 0),
    material_id UUID NOT NULL REFERENCES inventory_schema.materials(id),
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    direction VARCHAR(3) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    cost_amount NUMERIC(18,2),
    reservation_id UUID REFERENCES inventory_schema.reservations(id),
    note TEXT,
    UNIQUE (document_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_stock_document_lines_material
    ON inventory_schema.stock_document_lines(material_id);

ALTER TABLE inventory_schema.inventory_transactions
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES inventory_schema.stock_documents(id);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_document
    ON inventory_schema.inventory_transactions(document_id)
    WHERE document_id IS NOT NULL;

-- Sổ kho chỉ ghi thêm. Mọi dòng sổ (cũ lẫn mới) đều là bút toán đã ghi sổ —
-- workflow_status luôn là APPROVED — nên trigger chặn trên cả bảng. Sai thì tạo
-- chứng từ đảo. Migration nào thật sự phải sửa sổ thì tắt trigger tường minh
-- trong chính file đó.
CREATE OR REPLACE FUNCTION inventory_schema.reject_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Sổ kho chỉ ghi thêm: không được % bút toán %.', TG_OP, OLD.transaction_code
        USING ERRCODE = 'P0001', HINT = 'Tạo chứng từ đảo thay vì sửa hoặc xoá bút toán.';
END;
$$;

DROP TRIGGER IF EXISTS inventory_transactions_append_only ON inventory_schema.inventory_transactions;
CREATE TRIGGER inventory_transactions_append_only
    BEFORE UPDATE OR DELETE ON inventory_schema.inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION inventory_schema.reject_ledger_mutation();

-- Chứng từ đã ghi sổ cũng không sửa được, kể cả dòng của nó: lớp chặn cuối nếu
-- code nào đó bỏ qua máy trạng thái.
CREATE OR REPLACE FUNCTION inventory_schema.reject_posted_document_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'POSTED' THEN
        RAISE EXCEPTION 'Chứng từ % đã ghi sổ không được sửa.', OLD.code USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_documents_posted_immutable ON inventory_schema.stock_documents;
CREATE TRIGGER stock_documents_posted_immutable
    BEFORE UPDATE OR DELETE ON inventory_schema.stock_documents
    FOR EACH ROW EXECUTE FUNCTION inventory_schema.reject_posted_document_mutation();

CREATE OR REPLACE FUNCTION inventory_schema.reject_posted_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status VARCHAR(20);
BEGIN
    SELECT status INTO parent_status
      FROM inventory_schema.stock_documents
     WHERE id = COALESCE(NEW.document_id, OLD.document_id);
    IF parent_status = 'POSTED' THEN
        RAISE EXCEPTION 'Chứng từ đã ghi sổ không được sửa.' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stock_document_lines_posted_immutable ON inventory_schema.stock_document_lines;
CREATE TRIGGER stock_document_lines_posted_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON inventory_schema.stock_document_lines
    FOR EACH ROW EXECUTE FUNCTION inventory_schema.reject_posted_line_mutation();
