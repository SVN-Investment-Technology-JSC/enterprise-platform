-- Bán hàng (crm) · phần giữ của chính đơn "Đã xuất đủ" (COMPLETED, T8-12): dòng
-- hàng kho dùng phần giữ của chính đơn (`reservation_source = 'ORDER'`) đã giao
-- đủ số đặt thì phần giữ của dòng sang COMPLETED, số đang giữ về 0, như dòng dùng
-- phần giữ của hợp đồng (0015). Ràng buộc trạng thái đã có COMPLETED từ 0015.
-- Dữ liệu cũ: dòng như trên còn "Đang giữ" sang COMPLETED.
-- Chạy lại được: cập nhật chỉ chạm dòng còn HELD.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

UPDATE crm_schema.sales_order_lines
   SET reservation_status = 'COMPLETED', reserved_quantity = 0, updated_at = now()
 WHERE reservation_source = 'ORDER' AND reservation_status = 'HELD'
   AND material_kind <> 'SERVICE' AND delivered_quantity >= quantity;
