-- Giá vốn bình quân gia quyền tức thời (INV-09, INV-10, D4, T1-20).
--
-- 1. `material_inventory.avg_cost` NUMERIC(18,4): đơn giá bình quân của TỪNG DÒNG
--    TỒN (kho, vật tư), không phải một giá chung cho vật tư trên mọi kho. Lý do:
--    tồn, khoá dòng khi ghi sổ (`FOR UPDATE` theo kho, vật tư) và đối soát đều
--    theo dòng này; giá chung cho mọi kho phải khoá mọi dòng tồn của vật tư ở mỗi
--    lần nhập, và điều chuyển giữa hai kho sẽ không mang giá theo được. Điều chuyển
--    xuất ở giá bình quân kho đi và nhập vào kho đến đúng giá đó. Giá bình quân của
--    cả vật tư (API nội bộ, báo giá) là bình quân theo số lượng của các dòng tồn.
--    Dòng cũ nhận 0; chạy `node tools/inventory/init-avg-cost.mjs` để tính lại từ
--    sổ kho (T1-22).
-- 2. `stock_document_lines.cost_amount` đã có từ 0011: lệnh dưới không đổi gì,
--    giữ lại để file này tự đủ. Ghi sổ điền `unit_cost` và `cost_amount` của dòng
--    theo giá vốn thực tế (dòng xuất lấy giá bình quân lúc ghi sổ).
-- 3. `stock_document_lines.source_line_id`: dòng nhập trả hàng bán trỏ về dòng
--    xuất gốc để lấy giá vốn lúc xuất (TC-INV-20). Cho phép NULL.
-- 4. `stock_documents.request_hash`: dấu nội dung yêu cầu của API nội bộ
--    (`issue-requests`, `return-receipts`) để cùng khoá chống lặp khác nội dung
--    thì trả 409. Chứng từ lập trên màn Kho giữ NULL.
-- 5. Cài đặt `costing.method` (mặc định MOVING_AVERAGE) nằm trong union khoá đóng
--    ở contract và có giá trị mặc định trong code như các khoá khác của
--    `settings`, nên không chèn dòng nào.
-- Chạy lại được: mọi lệnh đều IF NOT EXISTS hoặc DROP rồi ADD lại ràng buộc.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.material_inventory
    ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(18,4) NOT NULL DEFAULT 0;

ALTER TABLE inventory_schema.material_inventory
    DROP CONSTRAINT IF EXISTS material_inventory_avg_cost_check;
ALTER TABLE inventory_schema.material_inventory
    ADD CONSTRAINT material_inventory_avg_cost_check CHECK (avg_cost >= 0);

ALTER TABLE inventory_schema.stock_document_lines
    ADD COLUMN IF NOT EXISTS cost_amount NUMERIC(18,2);

ALTER TABLE inventory_schema.stock_document_lines
    ADD COLUMN IF NOT EXISTS source_line_id UUID REFERENCES inventory_schema.stock_document_lines(id);

CREATE INDEX IF NOT EXISTS idx_stock_document_lines_source_line
    ON inventory_schema.stock_document_lines(source_line_id)
    WHERE source_line_id IS NOT NULL;

ALTER TABLE inventory_schema.stock_documents
    ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);
