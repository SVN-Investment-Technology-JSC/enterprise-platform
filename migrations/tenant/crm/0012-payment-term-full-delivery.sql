-- Bán hàng (crm) · điều kiện đợt thanh toán "Khi giao đủ hàng" (FULL_DELIVERY):
-- đợt đến hạn ở lần giao làm mọi dòng của mọi đơn chưa huỷ thuộc hợp đồng giao
-- đủ số lượng; giao một phần không ghi nợ. Khác `DELIVERY` (mỗi lần giao kích
-- hoạt đợt "khi giao hàng" kế tiếp).
-- Ràng buộc cũ do 0007 khai trên cột nên Postgres tự đặt tên
-- `contract_payment_terms_condition_check`; thay bằng ràng buộc có tên riêng.
-- Chạy lại được: bỏ cả hai tên nếu có rồi tạo lại.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.contract_payment_terms
    DROP CONSTRAINT IF EXISTS contract_payment_terms_condition_check;
ALTER TABLE crm_schema.contract_payment_terms
    DROP CONSTRAINT IF EXISTS ck_crm_contract_payment_terms_condition;
ALTER TABLE crm_schema.contract_payment_terms
    ADD CONSTRAINT ck_crm_contract_payment_terms_condition
    CHECK (condition IN ('DATE', 'SIGN', 'DELIVERY', 'FULL_DELIVERY', 'ACCEPTANCE'));
