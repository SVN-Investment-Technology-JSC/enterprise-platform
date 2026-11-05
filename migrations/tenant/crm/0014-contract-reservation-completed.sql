-- Bán hàng (crm) · phần giữ hàng của hợp đồng "Đã xuất đủ" (COMPLETED): Kho đặt
-- phần giữ sang Xuất đủ khi mọi dòng giữ đã xuất hết, nhưng không phát sự kiện
-- riêng, nên trước đây hợp đồng vẫn hiện "Đang giữ". Bán hàng cộng số đã xuất
-- theo `reservationId` trên dòng `inventory.stock.issued` vào
-- `reservation_issued` ({ "<material_id>": số đã xuất }); đủ số đã giữ của mọi
-- mặt hàng (dòng hàng tồn kho có số lượng) thì sang COMPLETED. Chứng từ đảo không
-- trừ lại (Kho cũng không trả lại phần giữ khi đảo).
-- Dữ liệu cũ: lấy số đã giao của dòng đơn dùng phần giữ của hợp đồng (ước lượng:
-- coi như xuất từ đúng phần giữ) rồi đặt COMPLETED cho hợp đồng đã giao đủ.
-- Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.contracts
    ADD COLUMN IF NOT EXISTS reservation_issued JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Ràng buộc cũ do 0007 khai trên cột (tên tự đặt); thay bằng ràng buộc có tên riêng.
ALTER TABLE crm_schema.contracts DROP CONSTRAINT IF EXISTS contracts_reservation_status_check;
ALTER TABLE crm_schema.contracts DROP CONSTRAINT IF EXISTS ck_crm_contracts_reservation_status;
ALTER TABLE crm_schema.contracts
    ADD CONSTRAINT ck_crm_contracts_reservation_status
    CHECK (reservation_status IN ('HELD', 'RELEASED', 'EXPIRED', 'COMPLETED'));

UPDATE crm_schema.contracts k
   SET reservation_issued = issued.value
  FROM (
        SELECT used.contract_id, jsonb_object_agg(used.material_id::text, used.quantity) AS value
          FROM (
                SELECT c.id AS contract_id, l.material_id, sum(LEAST(l.delivered_quantity, l.quantity)) AS quantity
                  FROM crm_schema.contracts c
                  JOIN crm_schema.sales_order_lines l
                    ON l.reservation_id = c.reservation_id AND l.reservation_source = 'CONTRACT'
                 WHERE c.reservation_status = 'HELD' AND c.reservation_issued = '{}'::jsonb
                 GROUP BY c.id, l.material_id
                HAVING sum(LEAST(l.delivered_quantity, l.quantity)) > 0
               ) used
         GROUP BY used.contract_id
       ) issued
 WHERE k.id = issued.contract_id;

UPDATE crm_schema.contracts k
   SET reservation_status = 'COMPLETED', updated_at = now()
 WHERE k.reservation_status = 'HELD'
   AND EXISTS (
        SELECT 1 FROM crm_schema.contract_lines cl
         WHERE cl.contract_id = k.id AND cl.material_kind <> 'SERVICE' AND cl.quantity IS NOT NULL
       )
   AND NOT EXISTS (
        SELECT 1
          FROM (
                SELECT cl.material_id, sum(cl.quantity) AS quantity
                  FROM crm_schema.contract_lines cl
                 WHERE cl.contract_id = k.id AND cl.material_kind <> 'SERVICE' AND cl.quantity IS NOT NULL
                 GROUP BY cl.material_id
               ) covered
         WHERE COALESCE((k.reservation_issued ->> covered.material_id::text)::numeric, 0) < covered.quantity
       );
