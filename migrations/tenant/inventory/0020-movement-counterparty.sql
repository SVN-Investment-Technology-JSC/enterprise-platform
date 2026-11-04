-- Migration: 0020-movement-counterparty.sql
-- Description: Ghi nơi nhập đến từ đâu và nơi xuất đi đâu thành cột riêng của sổ cái.
-- Trước đây nhà cung cấp, số hóa đơn, phòng ban nhận... chỉ nằm lẫn trong cột note nên không lọc hay báo cáo được.
-- Dòng cũ giữ nguyên (các cột mới để NULL); mọi cột đều tùy chọn nên bản app cũ vẫn ghi sổ bình thường.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.inventory_transactions
    ADD COLUMN IF NOT EXISTS counterparty_type VARCHAR(20)
        CHECK (counterparty_type IN ('SUPPLIER', 'DEPARTMENT', 'CUSTOMER', 'PROJECT', 'ASSET', 'WAREHOUSE')),
    ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS counterparty_address TEXT,
    -- Chuyển kho: dòng xuất trỏ tới kho đích, dòng nhập trỏ tới kho nguồn.
    ADD COLUMN IF NOT EXISTS counterparty_warehouse_id UUID REFERENCES inventory_schema.warehouses(id),
    -- Số hóa đơn / chứng từ gốc của phiếu.
    ADD COLUMN IF NOT EXISTS document_number VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_counterparty
    ON inventory_schema.inventory_transactions (counterparty_type, counterparty_name);
