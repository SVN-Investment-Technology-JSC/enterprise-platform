SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.leave_types
  ADD COLUMN IF NOT EXISTS deduct_balance boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS negative_limit numeric(6,2) NOT NULL DEFAULT 0;
ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS balance_reserved boolean NOT NULL DEFAULT false;
-- Existing pending requests already reserved their balance in the original implementation.
UPDATE hrm_schema.leave_requests SET balance_reserved=true WHERE status='PENDING';
ALTER TABLE hrm_schema.leave_transactions
  ADD COLUMN IF NOT EXISTS balance_year integer,
  ADD COLUMN IF NOT EXISTS operation_key varchar(180),
  ADD COLUMN IF NOT EXISTS actor_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS hrm_leave_operation_key ON hrm_schema.leave_transactions(tenant_id,operation_key) WHERE operation_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS hrm_schema.leave_request_days (
  request_id uuid NOT NULL REFERENCES hrm_schema.leave_requests(id),
  tenant_id uuid NOT NULL,
  work_date date NOT NULL,
  quantity numeric(6,2) NOT NULL CHECK(quantity>0),
  paid_minutes integer NOT NULL CHECK(paid_minutes>=0),
  PRIMARY KEY(request_id,work_date)
);
