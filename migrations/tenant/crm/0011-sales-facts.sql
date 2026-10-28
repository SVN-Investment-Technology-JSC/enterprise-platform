-- Bán hàng (crm) · bảng tổng hợp doanh thu theo dòng giao (T7-01, RPT-01): mỗi
-- dòng đơn đã giao theo một chứng từ xuất (hoặc một đợt chỉ có dịch vụ) là một
-- dòng `sales_facts`, ghi cùng transaction khi áp `inventory.stock.issued`.
-- Chứng từ đảo ghi dòng âm, không sửa dòng cũ. Báo cáo doanh thu, sản lượng, lợi
-- nhuận chỉ đọc bảng này, không cộng lại đơn và dòng đơn.
-- Dữ liệu cũ: đợt giao đã xuất kho trước migration được chép một lần từ
-- `delivery_lines` (số đã giao, giá vốn thực tế còn lại sau đảo), đánh dấu
-- `source_type = 'backfill'`.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- DÒNG GIAO
--
-- Khoá `(document_id, order_line_id)`: mỗi chứng từ chỉ ghi một lần cho mỗi dòng
-- đơn dù sự kiện đến lặp. `document_id` là id chứng từ xuất của Kho, hoặc id đợt
-- giao với đợt chỉ có dịch vụ. Người phụ trách, khách, nhóm khách, khu vực, mặt
-- hàng, nhóm hàng là bản chụp lúc giao: đổi người phụ trách hay khu vực sau đó
-- không làm đổi số liệu đã chốt. Không khoá ngoại để bảng chỉ ghi thêm và nạp
-- nhanh; id trỏ về `sales_orders`, `sales_order_lines`, `customers` cùng schema.
--
-- Tiền làm tròn đến đồng: `revenue` là doanh thu sau chiết khấu chưa VAT,
-- `vat_amount` là VAT, `cost_amount` là giá vốn thực tế theo chứng từ xuất
-- (`costAmount` của Kho), không dùng giá vốn ước tính trên báo giá.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.sales_facts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type          VARCHAR(20) NOT NULL CHECK (source_type IN ('stock_issue', 'service_delivery', 'backfill')),
    document_id          UUID NOT NULL,
    document_code        VARCHAR(100),
    reverses_document_id UUID,
    delivery_id          UUID,
    order_id             UUID NOT NULL,
    order_line_id        UUID NOT NULL,
    contract_id          UUID,
    customer_id          UUID NOT NULL,
    customer_group_id    UUID,
    region               VARCHAR(100),
    province             VARCHAR(100),
    owner_user_id        UUID NOT NULL,
    material_id          UUID NOT NULL,
    material_code        VARCHAR(100) NOT NULL,
    material_name        VARCHAR(300) NOT NULL,
    material_kind        VARCHAR(16) NOT NULL DEFAULT 'STOCK',
    category             VARCHAR(300),
    -- Thời điểm ghi sổ chứng từ và ngày theo giờ Việt Nam (lọc kỳ báo cáo).
    delivered_at         TIMESTAMPTZ NOT NULL,
    delivered_date       DATE NOT NULL,
    quantity             NUMERIC(12, 3) NOT NULL,
    revenue              NUMERIC(18, 2) NOT NULL DEFAULT 0,
    vat_amount           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    cost_amount          NUMERIC(18, 2) NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_sales_facts_document_line UNIQUE (document_id, order_line_id)
);

-- Báo cáo theo kỳ (toàn bộ dữ liệu) và theo kỳ trong phạm vi người phụ trách (Q11).
CREATE INDEX IF NOT EXISTS ix_crm_sales_facts_date ON crm_schema.sales_facts (delivered_date);
CREATE INDEX IF NOT EXISTS ix_crm_sales_facts_owner_date ON crm_schema.sales_facts (owner_user_id, delivered_date);
-- Lọc theo khách, nhóm khách, khu vực, mặt hàng trong kỳ.
CREATE INDEX IF NOT EXISTS ix_crm_sales_facts_customer_date ON crm_schema.sales_facts (customer_id, delivered_date);
CREATE INDEX IF NOT EXISTS ix_crm_sales_facts_group_date
    ON crm_schema.sales_facts (customer_group_id, delivered_date) WHERE customer_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_crm_sales_facts_region_date ON crm_schema.sales_facts (region, delivered_date);
CREATE INDEX IF NOT EXISTS ix_crm_sales_facts_material_date ON crm_schema.sales_facts (material_id, delivered_date);
CREATE INDEX IF NOT EXISTS ix_crm_sales_facts_order ON crm_schema.sales_facts (order_id);

-- Chuyển đổi theo kỳ (T7-03): đếm cơ hội, báo giá, hợp đồng, đơn tạo trong kỳ.
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_created ON crm_schema.opportunities (created_at);
CREATE INDEX IF NOT EXISTS ix_crm_quotes_created ON crm_schema.quotes (created_at);
CREATE INDEX IF NOT EXISTS ix_crm_contracts_created ON crm_schema.contracts (created_at);
CREATE INDEX IF NOT EXISTS ix_crm_sales_orders_created ON crm_schema.sales_orders (created_at);
-- Cảnh báo báo giá chờ duyệt (T7-04).
CREATE INDEX IF NOT EXISTS ix_crm_quotes_pending ON crm_schema.quotes (updated_at) WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- DỮ LIỆU CŨ
--
-- Đợt giao đã xuất kho (hoặc đợt dịch vụ đã ghi nhận) trước migration: một dòng
-- mỗi dòng đợt còn số đã giao, theo chứng từ xuất đầu tiên của đợt (đợt dịch vụ:
-- id đợt). Doanh thu, VAT chia theo tỷ lệ số đã giao trên số lượng dòng đơn.
-- Chạy lại không ghi trùng nhờ khoá `(document_id, order_line_id)`.
-- ---------------------------------------------------------------------------
INSERT INTO crm_schema.sales_facts
    (source_type, document_id, document_code, delivery_id, order_id, order_line_id, contract_id, customer_id,
     customer_group_id, region, province, owner_user_id, material_id, material_code, material_name, material_kind,
     category, delivered_at, delivered_date, quantity, revenue, vat_amount, cost_amount)
SELECT 'backfill',
       COALESCE(d.issue_document_id, d.id),
       d.issue_document_code,
       d.id,
       o.id,
       l.id,
       o.contract_id,
       o.customer_id,
       c.group_id,
       c.region,
       c.province,
       o.owner_user_id,
       l.material_id,
       l.material_code,
       l.material_name,
       l.material_kind,
       l.category,
       COALESCE(d.issued_at, d.updated_at),
       (COALESCE(d.issued_at, d.updated_at) AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,
       dl.delivered_quantity,
       round(l.line_amount * LEAST(dl.delivered_quantity / l.quantity, 1), 0),
       round(l.vat_amount * LEAST(dl.delivered_quantity / l.quantity, 1), 0),
       dl.actual_cost
  FROM crm_schema.delivery_lines dl
  JOIN crm_schema.delivery_plans d ON d.id = dl.delivery_id
  JOIN crm_schema.sales_order_lines l ON l.id = dl.order_line_id
  JOIN crm_schema.sales_orders o ON o.id = l.order_id
  JOIN crm_schema.customers c ON c.id = o.customer_id
 WHERE d.status = 'ISSUED' AND dl.delivered_quantity > 0
ON CONFLICT (document_id, order_line_id) DO NOTHING;
