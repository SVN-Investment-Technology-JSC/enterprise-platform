-- CRM · Kho giữ hàng theo từng dòng hợp đồng và dòng đơn bán (phase 3, D3-37).
-- Một hợp đồng, một đơn có thể giữ hàng ở nhiều kho: mỗi dòng có kho riêng; rỗng là theo kho mặc định của hợp đồng
-- hoặc đơn (`warehouse_code` ở bảng đầu, giữ nguyên nghĩa cũ). API giữ hàng của Kho đã nhận kho cho từng dòng.
-- Tương thích ngược: chỉ thêm cột cho phép rỗng; bản app cũ không ghi, dữ liệu cũ hiểu là theo kho mặc định. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.contract_lines ADD COLUMN IF NOT EXISTS warehouse_code VARCHAR(50);
ALTER TABLE crm_schema.sales_order_lines ADD COLUMN IF NOT EXISTS warehouse_code VARCHAR(50);
