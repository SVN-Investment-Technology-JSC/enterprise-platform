SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- Tài chính gắn với Workspace (dự án, công việc).
--
-- 1. "Hạch toán nội bộ" của phiếu thu/chi là hạch toán cho MỘT dự án hoặc cho MỘT công việc của dự án. Thay cho danh mục
--    "đơn vị hạch toán" ở bản đầu (chưa phát hành, không có dữ liệu thật): bỏ cột và bảng cũ.
-- 2. "Đối tượng liên quan" là danh sách dự án chỉ để tham chiếu; không cộng vào tổng thu chi của dự án.
--
-- Không khoá ngoại sang Workspace (khác schema, khác module): chỉ lưu id và nhãn chụp lúc gắn (mã, tên), để phiếu vẫn
-- đọc được khi Workspace đổi tên hoặc tạm không trả lời. Nhãn chuẩn do Workspace xác nhận khi lưu phiếu.
-- ============================================================================

ALTER TABLE finance_schema.vouchers DROP COLUMN IF EXISTS cost_center_id;
DROP TABLE IF EXISTS finance_schema.cost_centers;

ALTER TABLE finance_schema.vouchers
    ADD COLUMN IF NOT EXISTS alloc_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS alloc_project_id UUID,
    ADD COLUMN IF NOT EXISTS alloc_project_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS alloc_project_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS alloc_work_item_id UUID,
    ADD COLUMN IF NOT EXISTS alloc_work_item_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS alloc_work_item_title VARCHAR(500);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_vouchers_alloc') THEN
        -- CASE thay vì chuỗi OR: với alloc_type NULL, một nhánh "alloc_type = 'X'" cho NULL và CHECK coi NULL là đạt.
        ALTER TABLE finance_schema.vouchers ADD CONSTRAINT ck_finance_vouchers_alloc CHECK (
            CASE
                -- Không hạch toán: không có dấu vết nào của hạch toán.
                WHEN alloc_type IS NULL THEN alloc_project_id IS NULL AND alloc_work_item_id IS NULL
                -- Hạch toán cho dự án: có dự án, không có công việc.
                WHEN alloc_type = 'PROJECT' THEN alloc_project_id IS NOT NULL AND alloc_work_item_id IS NULL
                -- Hạch toán cho công việc: có công việc và dự án chứa nó.
                WHEN alloc_type = 'WORK_ITEM' THEN alloc_project_id IS NOT NULL AND alloc_work_item_id IS NOT NULL
                ELSE FALSE
            END
        );
    END IF;
    -- Lệnh chuyển tiền là dịch chuyển giữa hai tài khoản của công ty, không hạch toán cho dự án.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_vouchers_alloc_kind') THEN
        ALTER TABLE finance_schema.vouchers ADD CONSTRAINT ck_finance_vouchers_alloc_kind CHECK (kind <> 'TRANSFER' OR alloc_type IS NULL);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_finance_vouchers_alloc_project
    ON finance_schema.vouchers (tenant_id, alloc_project_id, voucher_date DESC) WHERE alloc_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_alloc_work_item
    ON finance_schema.vouchers (tenant_id, alloc_work_item_id) WHERE alloc_work_item_id IS NOT NULL;

-- Đối tượng liên quan = dự án.
ALTER TABLE finance_schema.voucher_related
    ADD COLUMN IF NOT EXISTS project_id UUID,
    ADD COLUMN IF NOT EXISTS project_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS project_name VARCHAR(255);

ALTER TABLE finance_schema.voucher_related DROP CONSTRAINT IF EXISTS voucher_related_kind_check;
ALTER TABLE finance_schema.voucher_related ADD CONSTRAINT voucher_related_kind_check CHECK (kind IN ('VOUCHER', 'REFERENCE', 'PROJECT'));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_finance_voucher_related_project') THEN
        ALTER TABLE finance_schema.voucher_related ADD CONSTRAINT ck_finance_voucher_related_project CHECK (kind <> 'PROJECT' OR project_id IS NOT NULL);
    END IF;
END $$;

-- Một dự án chỉ liên quan tới một phiếu một lần.
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_voucher_related_project
    ON finance_schema.voucher_related (voucher_id, project_id) WHERE kind = 'PROJECT';
CREATE INDEX IF NOT EXISTS idx_finance_voucher_related_project
    ON finance_schema.voucher_related (tenant_id, project_id) WHERE project_id IS NOT NULL;
