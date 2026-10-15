SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Quyết định nhân sự lập từ nút "Tạo quyết định" chỉ là bản ghi lịch sử công tác
-- (RECORDED): không duyệt, không áp dụng sang Core, quan hệ báo cáo hay lương.
-- Việc gán chức danh ở hồ sơ nhân sự vẫn đi theo luồng cũ (APPROVED → APPLIED).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'hrm_schema.personnel_decisions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%APPLY_PENDING%'
  LOOP
    EXECUTE format('ALTER TABLE hrm_schema.personnel_decisions DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE hrm_schema.personnel_decisions
    ADD CONSTRAINT personnel_decisions_status_check
    CHECK (status IN ('DRAFT','APPROVED','APPLY_PENDING','APPLIED','REJECTED','CANCELLED','RECORDED'));
END $$;
