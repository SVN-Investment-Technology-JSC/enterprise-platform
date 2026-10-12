SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Nguồn kích hoạt giao dịch phép: MANUAL (người dùng bấm) hoặc AUTOMATION (job tự động).
-- Job tự động đặt `hrm.trigger_source` = 'AUTOMATION' trong transaction của nó; các giao dịch
-- còn lại mặc định là MANUAL. Dòng cũ để NULL vì không thể biết nguồn.
ALTER TABLE hrm_schema.leave_transactions
  ADD COLUMN IF NOT EXISTS trigger_source varchar(20);
ALTER TABLE hrm_schema.leave_transactions
  ALTER COLUMN trigger_source SET DEFAULT COALESCE(NULLIF(current_setting('hrm.trigger_source', true), ''), 'MANUAL');
