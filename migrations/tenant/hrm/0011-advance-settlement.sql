ALTER TABLE hrm_schema.salary_advance_requests DROP CONSTRAINT IF EXISTS salary_advance_requests_status_check;
ALTER TABLE hrm_schema.salary_advance_requests ADD CONSTRAINT salary_advance_requests_status_check
  CHECK(status IN ('PENDING','APPROVED','DISBURSED','REPAID','REJECTED','CANCELLED'));
