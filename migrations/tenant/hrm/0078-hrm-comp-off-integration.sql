-- Nối quỹ nghỉ bù vào đơn làm thêm và đơn nghỉ (giai đoạn 2). Chỉ thêm cột có mặc định, không đổi hành vi hiện tại.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Đơn làm thêm: ngày làm việc kế tiếp có được nghỉ sau ca xuyên đêm không (nhân viên khai, HR sửa được ở bước phân loại).
ALTER TABLE hrm_schema.ot_requests
  ADD COLUMN IF NOT EXISTS next_day_rest varchar(4) NOT NULL DEFAULT 'NONE';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ot_requests_next_day_rest_check') THEN
    ALTER TABLE hrm_schema.ot_requests
      ADD CONSTRAINT ot_requests_next_day_rest_check CHECK (next_day_rest IN ('NONE', 'HALF', 'FULL'));
  END IF;
END $$;
COMMENT ON COLUMN hrm_schema.ot_requests.next_day_rest IS 'Nghỉ sau ca xuyên đêm: NONE không nghỉ, HALF nửa ngày, FULL cả ngày; chỉ dùng khi chế độ phân loại là NIGHT_REST';

-- Loại nghỉ "Nghỉ bù": trừ vào quỹ nghỉ bù (comp_off_ledger) thay cho quỹ phép năm. Mỗi tenant tối đa một loại.
ALTER TABLE hrm_schema.leave_types
  ADD COLUMN IF NOT EXISTS comp_off boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_leave_types_one_comp_off
  ON hrm_schema.leave_types (tenant_id)
  WHERE comp_off AND deleted_at IS NULL;
COMMENT ON COLUMN hrm_schema.leave_types.comp_off IS 'Loại nghỉ dùng quỹ nghỉ bù; số dư lấy từ sổ comp_off_ledger, không dùng leave_balances';
