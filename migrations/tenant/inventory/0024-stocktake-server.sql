-- Kiểm kê kho chạy ở server (thay dữ liệu giả trong localStorage của trình duyệt).
-- 0010 đã tạo ba bảng; file này chỉ bổ sung cột còn thiếu cho vòng đời đợt
-- (người lập, gửi duyệt, ghi sổ, huỷ), phạm vi theo danh sách mã, giá vốn chụp
-- lúc snapshot và liên kết sang chứng từ điều chỉnh sinh ra khi ghi sổ.
-- Chạy lại được: mọi lệnh đều IF NOT EXISTS.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.stocktake_sessions
    ADD COLUMN IF NOT EXISTS stocktake_date DATE,
    ADD COLUMN IF NOT EXISTS scope_materials JSONB,
    ADD COLUMN IF NOT EXISTS created_by UUID,
    ADD COLUMN IF NOT EXISTS started_by UUID,
    ADD COLUMN IF NOT EXISTS submitted_by UUID,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reject_reason TEXT,
    ADD COLUMN IF NOT EXISTS posted_by UUID,
    ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
    -- Chứng từ điều chỉnh (ADJUSTMENT) sinh khi ghi sổ; trống nếu đợt không có chênh lệch.
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES inventory_schema.stock_documents(id);

ALTER TABLE inventory_schema.stocktake_lines
    -- Giá vốn bình quân chụp cùng lúc với số tồn sổ sách, để giá trị chênh lệch không đổi theo thời gian.
    ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS counted_by UUID,
    ADD COLUMN IF NOT EXISTS counted_at TIMESTAMPTZ;

-- Mỗi vật tư chỉ một dòng trong một đợt (số tồn tính gộp cấp kho).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stocktake_lines_session_material
    ON inventory_schema.stocktake_lines(session_id, material_id);

CREATE INDEX IF NOT EXISTS idx_stocktake_sessions_document
    ON inventory_schema.stocktake_sessions(document_id)
    WHERE document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stocktake_line_audits_line
    ON inventory_schema.stocktake_line_audits(line_id, timestamp);
