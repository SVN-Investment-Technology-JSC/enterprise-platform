-- Lịch sử điều chỉnh quỹ nghỉ bù giống quỹ phép năm: ghi nguồn của mỗi dòng (bấm tay hoặc import Excel), mã lô import
-- để gom các dòng cùng một lần import, và liên kết dòng đảo với dòng gốc. Chỉ thêm cột và chỉ mục; sổ vẫn chỉ thêm dòng.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.comp_off_ledger
  ADD COLUMN IF NOT EXISTS source varchar(12) CHECK (source IS NULL OR source IN ('MANUAL', 'IMPORT')),
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS reverses_id uuid;

CREATE INDEX IF NOT EXISTS idx_hrm_comp_off_ledger_batch
  ON hrm_schema.comp_off_ledger (tenant_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hrm_comp_off_ledger_reverses
  ON hrm_schema.comp_off_ledger (tenant_id, reverses_id) WHERE reverses_id IS NOT NULL;
