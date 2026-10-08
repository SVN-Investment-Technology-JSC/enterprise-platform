SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Chính sách phép năm tính theo ngày ký HĐLĐ chính thức đầu tiên.
-- Lịch cũ giữ accrual_basis = 'JOIN_DATE' và hành vi cũ; lịch mới dùng
-- 'CONTRACT_SIGN_DATE' với định mức năm, mốc bắt đầu sau N tháng, tuỳ chọn ứng
-- phép và nhiều mốc thâm niên (lấy mốc cao nhất đã đạt).
ALTER TABLE hrm_schema.leave_accrual_schedules
  ADD COLUMN IF NOT EXISTS accrual_basis varchar(30) NOT NULL DEFAULT 'JOIN_DATE',
  ADD COLUMN IF NOT EXISTS start_offset_months int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS advance_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS annual_days numeric(6,2);
ALTER TABLE hrm_schema.leave_accrual_schedules DROP CONSTRAINT IF EXISTS leave_accrual_schedules_accrual_basis_check;
ALTER TABLE hrm_schema.leave_accrual_schedules ADD CONSTRAINT leave_accrual_schedules_accrual_basis_check
  CHECK (accrual_basis IN ('JOIN_DATE','CONTRACT_SIGN_DATE'));
ALTER TABLE hrm_schema.leave_accrual_schedules DROP CONSTRAINT IF EXISTS leave_accrual_schedules_start_offset_check;
ALTER TABLE hrm_schema.leave_accrual_schedules ADD CONSTRAINT leave_accrual_schedules_start_offset_check
  CHECK (start_offset_months BETWEEN 0 AND 120);
ALTER TABLE hrm_schema.leave_accrual_schedules DROP CONSTRAINT IF EXISTS leave_accrual_schedules_contract_basis_check;
ALTER TABLE hrm_schema.leave_accrual_schedules ADD CONSTRAINT leave_accrual_schedules_contract_basis_check
  CHECK (accrual_basis <> 'CONTRACT_SIGN_DATE' OR (accrual_frequency = 'MONTHLY' AND annual_days IS NOT NULL AND annual_days BETWEEN 0 AND 366));

CREATE TABLE IF NOT EXISTS hrm_schema.leave_seniority_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  schedule_id uuid NOT NULL REFERENCES hrm_schema.leave_accrual_schedules(id) ON DELETE CASCADE,
  min_years int NOT NULL CHECK (min_years BETWEEN 1 AND 60),
  bonus_days numeric(5,2) NOT NULL CHECK (bonus_days >= 0 AND bonus_days <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrm_leave_seniority_tier UNIQUE (schedule_id, min_years)
);
CREATE INDEX IF NOT EXISTS idx_hrm_leave_seniority_tiers ON hrm_schema.leave_seniority_tiers(tenant_id, schedule_id);

-- Quyết toán phép khi nghỉ việc. excess_days > 0 là phép đã dùng vượt quỹ thực
-- hưởng; recovery_amount được đưa vào kỳ lương (SCHEDULED -> DEDUCTED).
-- CLOSED: không có phép dùng vượt, chỉ ghi nhận số ngày chưa dùng.
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
  CHECK (transaction_type IN ('ACCRUAL','SENIORITY_ACCRUAL','USAGE','ADJUSTMENT','CARRYOVER_EXPIRE','CARRYOVER_IN','CARRYOVER_OUT','YEAR_END_RESET','RECOVERY','REVERSAL'));
