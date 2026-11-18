-- CRM · Bảng giá mặc định đồng bộ Kho, bảng giá theo tỷ lệ, chọn bảng giá thủ công khi báo giá và lập đơn
-- (docs/crm_price_list_logic/plan.md).
-- - `price_lists.list_type`: DEFAULT (một bảng, lấy từ Kho), DERIVED (theo tỷ lệ của bảng mặc định), MANUAL (bảng cũ,
--   nhập tay). Bảng đã có (chuẩn và riêng) thành MANUAL, giữ nguyên dòng giá.
-- - `price_list_items.price` cho phép rỗng: "Chưa nhập giá ở Kho". `price_mode`: SYNCED (bảng mặc định), RATIO, MANUAL.
-- - `quote_versions.price_list_id`, `sales_orders.price_list_id`: bảng giá người dùng chọn. Gán sẵn cho dữ liệu cũ đúng
--   như engine cũ chọn (bảng riêng của khách đang bật và còn hiệu lực, không thì bảng chuẩn hiệu lực tại ngày tính giá)
--   để giá không đổi.
-- Tương thích ngược: chỉ thêm cột có mặc định hoặc cho phép rỗng; giữ `is_standard`, `customers.price_list_id` cho bản
-- app cũ. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.price_lists
    ADD COLUMN IF NOT EXISTS list_type VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN IF NOT EXISTS ratio_percent NUMERIC(7, 2);

ALTER TABLE crm_schema.price_lists DROP CONSTRAINT IF EXISTS ck_crm_price_lists_type;
ALTER TABLE crm_schema.price_lists
    ADD CONSTRAINT ck_crm_price_lists_type CHECK (
        list_type IN ('DEFAULT', 'DERIVED', 'MANUAL')
        AND CASE list_type
                WHEN 'DERIVED' THEN ratio_percent IS NOT NULL AND ratio_percent > 0 AND ratio_percent <= 1000
                ELSE ratio_percent IS NULL
            END
    );

-- Chỉ một bảng giá mặc định.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_price_lists_default
    ON crm_schema.price_lists ((TRUE)) WHERE list_type = 'DEFAULT';

ALTER TABLE crm_schema.price_list_items ALTER COLUMN price DROP NOT NULL;
ALTER TABLE crm_schema.price_list_items
    ADD COLUMN IF NOT EXISTS price_mode VARCHAR(8) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN IF NOT EXISTS source_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE crm_schema.price_list_items DROP CONSTRAINT IF EXISTS ck_crm_price_list_items_mode;
ALTER TABLE crm_schema.price_list_items
    ADD CONSTRAINT ck_crm_price_list_items_mode CHECK (price_mode IN ('SYNCED', 'RATIO', 'MANUAL'));

-- Không ON DELETE: bảng giá đã dùng thì không xoá được, chỉ chuyển "Ngừng áp dụng".
ALTER TABLE crm_schema.quote_versions
    ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES crm_schema.price_lists (id);
CREATE INDEX IF NOT EXISTS ix_crm_quote_versions_price_list
    ON crm_schema.quote_versions (price_list_id) WHERE price_list_id IS NOT NULL;

ALTER TABLE crm_schema.sales_orders
    ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES crm_schema.price_lists (id);
CREATE INDEX IF NOT EXISTS ix_crm_sales_orders_price_list
    ON crm_schema.sales_orders (price_list_id) WHERE price_list_id IS NOT NULL;

-- Gán sẵn cho phiên bản báo giá cũ: bảng riêng của khách nếu đang bật và còn hiệu lực tại ngày tính giá, không thì bảng
-- chuẩn đang bật hiệu lực tại ngày đó (bảng bắt đầu muộn nhất). Chỉ gán khi đang rỗng. Ngày tính giá rỗng thì lấy như
-- engine cũ: bản nháp là hôm nay (giờ Việt Nam), bản đã chốt là `priced_on`, không có thì ngày tạo phiên bản.
WITH targets AS (
    SELECT v.id, c.price_list_id AS customer_list,
           -- Ngày tính giá rỗng: bản nháp được tính lại theo hôm nay, bản đã chốt theo ngày tính gần nhất.
           COALESCE(v.price_date,
                    CASE WHEN v.status = 'DRAFT' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END,
                    v.priced_on,
                    (v.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date) AS d
      FROM crm_schema.quote_versions v
      JOIN crm_schema.quotes q ON q.id = v.quote_id
      JOIN crm_schema.customers c ON c.id = q.customer_id
     WHERE v.price_list_id IS NULL
), picks AS (
    SELECT t.id,
           COALESCE(
             (SELECT l.id FROM crm_schema.price_lists l
               WHERE l.id = t.customer_list AND NOT l.is_standard AND l.status = 'ACTIVE'
                 AND l.valid_from <= t.d AND (l.valid_to IS NULL OR l.valid_to >= t.d)),
             (SELECT l.id FROM crm_schema.price_lists l
               WHERE l.is_standard AND l.status = 'ACTIVE'
                 AND l.valid_from <= t.d AND (l.valid_to IS NULL OR l.valid_to >= t.d)
               ORDER BY l.valid_from DESC, l.code LIMIT 1)) AS list_id
      FROM targets t
)
UPDATE crm_schema.quote_versions v
   SET price_list_id = p.list_id
  FROM picks p
 WHERE v.id = p.id AND p.list_id IS NOT NULL;

-- Đơn từ báo giá: theo phiên bản báo giá (khách đã nhận, không thì phiên bản mới nhất). Đơn khác: như báo giá; ngày tính
-- giá rỗng thì đơn nháp lấy hôm nay (engine cũ tính lại theo hôm nay), đơn khác lấy ngày lập đơn.
UPDATE crm_schema.sales_orders o
   SET price_list_id = (SELECT v.price_list_id FROM crm_schema.quote_versions v
                         WHERE v.quote_id = o.quote_id
                         ORDER BY (v.status = 'ACCEPTED') DESC, v.version_no DESC LIMIT 1)
 WHERE o.source = 'QUOTE' AND o.quote_id IS NOT NULL AND o.price_list_id IS NULL;

UPDATE crm_schema.sales_orders o
   SET price_list_id = COALESCE(
         (SELECT l.id FROM crm_schema.price_lists l
           WHERE l.id = c.price_list_id AND NOT l.is_standard AND l.status = 'ACTIVE'
             AND l.valid_from <= COALESCE(o.price_date, CASE WHEN o.status = 'DRAFT' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END, o.order_date)
             AND (l.valid_to IS NULL OR l.valid_to >= COALESCE(o.price_date, CASE WHEN o.status = 'DRAFT' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END, o.order_date))),
         (SELECT l.id FROM crm_schema.price_lists l
           WHERE l.is_standard AND l.status = 'ACTIVE'
             AND l.valid_from <= COALESCE(o.price_date, CASE WHEN o.status = 'DRAFT' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END, o.order_date)
             AND (l.valid_to IS NULL OR l.valid_to >= COALESCE(o.price_date, CASE WHEN o.status = 'DRAFT' THEN (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date END, o.order_date))
           ORDER BY l.valid_from DESC, l.code LIMIT 1))
  FROM crm_schema.customers c
 WHERE c.id = o.customer_id AND o.source <> 'QUOTE' AND o.price_list_id IS NULL;
