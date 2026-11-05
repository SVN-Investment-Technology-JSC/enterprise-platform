-- Khách hàng Workspace thành bản sao của khách Bán hàng (crm) khi tenant bật phân hệ crm (quyết định D1,
-- docs/crm/plan_crm.md mục 10.1).
--  · crm_customer_id: id khách ở Bán hàng mà dòng này sao lại; NULL là khách tạo trong Workspace, chưa gắn
--    (tenant không bật crm thì mọi dòng vẫn NULL, hành vi như cũ). Mỗi khách Bán hàng có tối đa một bản sao.
--  · crm_version: phiên bản của khách Bán hàng lúc sao; sự kiện có phiên bản không lớn hơn thì bỏ qua để sự
--    kiện đến trễ không ghi đè dữ liệu mới.
--  · code, name nới cho bằng Bán hàng (VARCHAR(50), VARCHAR(300)) để bản sao không bị cắt. Nới VARCHAR không
--    ghi lại bảng; bản app cũ vẫn chạy (nó chỉ kiểm độ dài ngắn hơn).
-- Dữ liệu cũ giữ nguyên; script `tools/crm/migrate-workspace-customers.mjs` gắn khách cũ qua API.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.customers
    ADD COLUMN IF NOT EXISTS crm_customer_id UUID,
    ADD COLUMN IF NOT EXISTS crm_version INTEGER;

ALTER TABLE workspace_schema.customers
    ALTER COLUMN code TYPE VARCHAR(50),
    ALTER COLUMN name TYPE VARCHAR(300);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_customers_crm_customer
    ON workspace_schema.customers (crm_customer_id)
    WHERE crm_customer_id IS NOT NULL;
