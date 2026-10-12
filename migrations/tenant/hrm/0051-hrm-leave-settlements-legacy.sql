-- Sửa quyết toán phép (thay cho việc sửa 0033 đã áp dụng, vì migrator kiểm checksum).
-- Bảng cũ (disposition/overused_days/operation_key, không có cột year) khiến CREATE TABLE IF NOT EXISTS
-- ở 0033 bị bỏ qua và mọi truy vấn theo `year` lỗi. Đổi tên để giữ dữ liệu cũ rồi tạo lại đúng cấu trúc.
DO $$
BEGIN
  IF to_regclass('hrm_schema.leave_settlements') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'hrm_schema' AND table_name = 'leave_settlements' AND column_name = 'year'
     ) THEN
    ALTER TABLE hrm_schema.leave_settlements RENAME TO leave_settlements_legacy;
    ALTER INDEX IF EXISTS hrm_schema.leave_settlements_pkey RENAME TO leave_settlements_legacy_pkey;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hrm_schema.leave_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL REFERENCES hrm_schema.leave_types(id),
  year int NOT NULL,
  termination_date date NOT NULL,
  entitled_days numeric(6,2) NOT NULL DEFAULT 0,
  used_days numeric(6,2) NOT NULL DEFAULT 0,
  excess_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (excess_days >= 0),
  unused_days numeric(6,2) NOT NULL DEFAULT 0 CHECK (unused_days >= 0),
  daily_rate numeric(15,2) NOT NULL DEFAULT 0,
  recovery_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (recovery_amount >= 0),
  recovery_transaction_id uuid,
  payroll_period_id uuid REFERENCES hrm_schema.payroll_periods(id),
  payroll_run_id uuid REFERENCES hrm_schema.payroll_runs(id),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SCHEDULED','DEDUCTED','WAIVED','CLOSED','REVERSED')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_leave_settlement_active
  ON hrm_schema.leave_settlements(tenant_id, employee_id, leave_type_id, year)
  WHERE status <> 'REVERSED';
CREATE INDEX IF NOT EXISTS idx_hrm_leave_settlements_period
  ON hrm_schema.leave_settlements(tenant_id, payroll_period_id, status);

ALTER TABLE hrm_schema.leave_transactions DROP CONSTRAINT IF EXISTS leave_transactions_transaction_type_check;
ALTER TABLE hrm_schema.leave_transactions ADD CONSTRAINT leave_transactions_transaction_type_check
  CHECK (transaction_type IN ('ACCRUAL','SENIORITY_ACCRUAL','USAGE','ADJUSTMENT','CARRYOVER_EXPIRE','CARRYOVER_IN','CARRYOVER_OUT','YEAR_END_RESET','RECOVERY','REVERSAL','SETTLEMENT'));
