-- Bán hàng (crm) · phần giữ của dòng đơn "Đã xuất đủ" (COMPLETED, T8-09): dòng
-- hàng kho của đơn dùng phần giữ của hợp đồng đã giao đủ số đặt thì phần giữ của
-- dòng sang COMPLETED, số đang giữ về 0 (cùng trạng thái với hợp đồng, 0014).
-- Ràng buộc cũ do 0008 khai trên cột nên Postgres tự đặt tên
-- `sales_order_lines_reservation_status_check`; thay bằng ràng buộc có tên riêng.
-- Dữ liệu cũ: dòng như trên còn "Đang giữ" sang COMPLETED.
-- Chạy lại được: bỏ cả hai tên nếu có rồi tạo lại; cập nhật chỉ chạm dòng còn HELD.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.sales_order_lines DROP CONSTRAINT IF EXISTS sales_order_lines_reservation_status_check;
ALTER TABLE crm_schema.sales_order_lines DROP CONSTRAINT IF EXISTS ck_crm_sales_order_lines_reservation_status;
ALTER TABLE crm_schema.sales_order_lines
    ADD CONSTRAINT ck_crm_sales_order_lines_reservation_status
    CHECK (reservation_status IN ('HELD', 'RELEASED', 'EXPIRED', 'COMPLETED'));

UPDATE crm_schema.sales_order_lines
   SET reservation_status = 'COMPLETED', reserved_quantity = 0, updated_at = now()
 WHERE reservation_source = 'CONTRACT' AND reservation_status = 'HELD'
   AND material_kind <> 'SERVICE' AND delivered_quantity >= quantity;
