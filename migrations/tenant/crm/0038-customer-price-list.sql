-- CRM · Bảng giá chọn theo từng khách hàng, không còn theo nhóm khách (phase 3, D3-38).
-- - `customers.price_list_id`: bảng giá (không chuẩn) áp cho khách; rỗng, hết hiệu lực hoặc đã tắt thì engine giá dùng
--   bảng giá chuẩn đang hiệu lực. Xoá bảng giá thì khách về rỗng.
-- - Bỏ toàn bộ gán bảng giá cho nhóm khách (người dùng chốt chọn lại từ đầu cho từng khách); giữ bảng
--   `price_list_customer_groups` để bản app cũ còn chạy trong lúc deploy (đọc ra rỗng), bỏ hẳn ở lần sau.
-- Tương thích ngược: thêm cột cho phép rỗng; xoá dòng gán nhóm làm bản app cũ tính giá theo bảng chuẩn. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.customers
    ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES crm_schema.price_lists (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_crm_customers_price_list
    ON crm_schema.customers (price_list_id) WHERE price_list_id IS NOT NULL;

DELETE FROM crm_schema.price_list_customer_groups;
