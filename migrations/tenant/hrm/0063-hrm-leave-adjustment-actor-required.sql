SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Điều chỉnh và đảo điều chỉnh phép năm bắt buộc ghi lại tài khoản thực hiện (actor_id).
-- NOT VALID: bản ghi cũ chưa có người thực hiện được giữ nguyên, mọi bản ghi mới bị ràng buộc.
ALTER TABLE hrm_schema.leave_transactions
  DROP CONSTRAINT IF EXISTS ck_hrm_leave_tx_adjust_actor;
ALTER TABLE hrm_schema.leave_transactions
  ADD CONSTRAINT ck_hrm_leave_tx_adjust_actor
  CHECK (transaction_type NOT IN ('ADJUSTMENT','REVERSAL') OR actor_id IS NOT NULL) NOT VALID;
