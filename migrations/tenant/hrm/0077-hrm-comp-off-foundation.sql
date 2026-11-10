-- Nền tảng cho phân loại giờ làm thêm / ca đêm và quỹ nghỉ bù (giai đoạn 1).
-- Cấu hình nằm trong config_json.overtimeComp của phiên bản chính sách OT sẵn có (policy_versions), không có bảng cấu hình mới.
-- Bảng mới đều rỗng khi tạo, không đổi hành vi hiện tại cho tới khi giai đoạn sau nối vào luồng đơn và bảng công.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Cấu hình chính sách đã dùng, ghi khi chốt công để kỳ đã chốt không đổi khi chính sách đổi sau này.
ALTER TABLE hrm_schema.timesheet_periods
  ADD COLUMN IF NOT EXISTS policy_snapshot jsonb;
COMMENT ON COLUMN hrm_schema.timesheet_periods.policy_snapshot IS 'Bản chụp chính sách làm thêm và nghỉ bù đã dùng khi chốt công; NULL = chưa chốt hoặc chốt trước khi có tính năng';

-- Ngày nghỉ sau ca đêm: dữ liệu có cấu trúc (không để trong ghi chú tự do). Dùng để phân loại ca đêm
-- (chế độ NIGHT_REST) và để trừ vào ngày công. Không dùng quỹ nghỉ bù.
CREATE TABLE IF NOT EXISTS hrm_schema.night_rest_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  rest_date date NOT NULL,
  fraction numeric(2,1) NOT NULL CHECK (fraction IN (0.5, 1)),
  ot_request_id uuid REFERENCES hrm_schema.ot_requests(id) ON DELETE SET NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrm_night_rest_days UNIQUE (tenant_id, employee_id, rest_date)
);
COMMENT ON TABLE hrm_schema.night_rest_days IS 'Ngày (hoặc nửa ngày) nghỉ sau ca đêm của nhân viên; mỗi nhân viên một dòng cho mỗi ngày';

-- Một dòng cho mỗi ca làm thêm của đơn (sau khi tách theo tháng): kết quả gợi ý của bộ quy tắc và giá trị chính thức
-- (HR sửa tay được, có lý do). Tổng làm thêm cộng ca đêm luôn bằng số giờ của ca.
CREATE TABLE IF NOT EXISTS hrm_schema.overtime_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ot_request_id uuid NOT NULL REFERENCES hrm_schema.ot_requests(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  period_month char(7) NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  hours numeric(6,2) NOT NULL CHECK (hours > 0),
  crosses_midnight boolean NOT NULL DEFAULT false,
  rule_set varchar(20) NOT NULL CHECK (rule_set IN ('NIGHT_REST', 'CLOCK_WINDOW')),
  policy_version_id uuid REFERENCES hrm_schema.policy_versions(id),
  rest_fraction_suggested numeric(2,1) NOT NULL DEFAULT 0 CHECK (rest_fraction_suggested IN (0, 0.5, 1)),
  ot_hours_suggested numeric(6,2) NOT NULL CHECK (ot_hours_suggested >= 0),
  night_hours_suggested numeric(6,2) NOT NULL CHECK (night_hours_suggested >= 0),
  ot_hours_final numeric(6,2) NOT NULL CHECK (ot_hours_final >= 0),
  night_hours_final numeric(6,2) NOT NULL CHECK (night_hours_final >= 0),
  source varchar(20) NOT NULL DEFAULT 'RULE' CHECK (source IN ('RULE', 'MANUAL', 'IMPORT_1OFFICE')),
  overridden_by uuid,
  overridden_at timestamptz,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_blocks_range CHECK (end_at > start_at),
  CONSTRAINT overtime_blocks_suggested_sum CHECK (abs(ot_hours_suggested + night_hours_suggested - hours) < 0.005),
  CONSTRAINT overtime_blocks_final_sum CHECK (abs(ot_hours_final + night_hours_final - hours) < 0.005),
  CONSTRAINT overtime_blocks_manual_reason CHECK (
    source <> 'MANUAL' OR (overridden_by IS NOT NULL AND length(btrim(coalesce(override_reason, ''))) > 0)
  ),
  CONSTRAINT uq_hrm_overtime_blocks UNIQUE (tenant_id, ot_request_id, start_at)
);
CREATE INDEX IF NOT EXISTS idx_hrm_overtime_blocks_period
  ON hrm_schema.overtime_blocks (tenant_id, employee_id, period_month);

-- Sổ quỹ nghỉ bù: chỉ thêm dòng. Số dư = tổng days của các lô chưa hết hạn.
--   ACCRUAL (+) cộng quỹ, mỗi dòng là một lô (lot_id = id của chính nó), có hạn dùng riêng.
--   RESERVE (−) giữ chỗ khi gửi đơn; RELEASE (+) hoàn giữ chỗ khi đơn bị từ chối, rút, hủy.
--   Khi đơn được duyệt ghi RELEASE (+) và USAGE (−) cùng giao dịch: giữ chỗ chuyển thành đã dùng.
--   ADJUST điều chỉnh tay (bắt buộc lý do và người thực hiện); EXPIRE (−) hết hạn lô.
-- idempotency_key duy nhất theo tenant: gọi lại cùng một thao tác không tạo giao dịch thứ hai.
CREATE TABLE IF NOT EXISTS hrm_schema.comp_off_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('ACCRUAL', 'RESERVE', 'USAGE', 'RELEASE', 'ADJUST', 'EXPIRE')),
  days numeric(6,1) NOT NULL CHECK (days <> 0),
  occurred_on date NOT NULL,
  lot_id uuid NOT NULL,
  expires_on date,
  period_month char(7) CHECK (period_month IS NULL OR period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  source_hours numeric(7,2),
  cap_hours numeric(7,2),
  excess_hours numeric(7,2),
  factor numeric(5,2),
  day_basis_hours numeric(5,2),
  policy_snapshot jsonb,
  request_id uuid,
  reason text,
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrm_comp_off_ledger_idempotency UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT comp_off_ledger_sign CHECK (
    (kind = 'ACCRUAL' AND days > 0)
    OR (kind IN ('RESERVE', 'USAGE', 'EXPIRE') AND days < 0)
    OR (kind = 'RELEASE' AND days > 0)
    OR kind = 'ADJUST'
  ),
  CONSTRAINT comp_off_ledger_accrual_lot CHECK (kind <> 'ACCRUAL' OR lot_id = id),
  CONSTRAINT comp_off_ledger_request CHECK (kind NOT IN ('RESERVE', 'USAGE', 'RELEASE') OR request_id IS NOT NULL),
  CONSTRAINT comp_off_ledger_adjust_reason CHECK (
    kind <> 'ADJUST' OR (created_by IS NOT NULL AND length(btrim(coalesce(reason, ''))) > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_hrm_comp_off_ledger_employee
  ON hrm_schema.comp_off_ledger (tenant_id, employee_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_hrm_comp_off_ledger_lot
  ON hrm_schema.comp_off_ledger (tenant_id, lot_id);

CREATE OR REPLACE FUNCTION hrm_schema.comp_off_ledger_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sổ quỹ nghỉ bù chỉ được thêm dòng; sai thì ghi giao dịch đảo hoặc điều chỉnh';
END;
$$;

DROP TRIGGER IF EXISTS trg_hrm_comp_off_ledger_append_only ON hrm_schema.comp_off_ledger;
CREATE TRIGGER trg_hrm_comp_off_ledger_append_only
  BEFORE UPDATE OR DELETE ON hrm_schema.comp_off_ledger
  FOR EACH ROW EXECUTE FUNCTION hrm_schema.comp_off_ledger_append_only();
