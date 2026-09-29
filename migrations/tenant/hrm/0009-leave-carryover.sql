SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS hrm_schema.leave_carryovers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,employee_id uuid NOT NULL,leave_type_id uuid NOT NULL REFERENCES hrm_schema.leave_types(id),
 source_year integer NOT NULL,target_year integer NOT NULL,amount numeric(6,2) NOT NULL,
 reserved numeric(6,2) NOT NULL DEFAULT 0,used numeric(6,2) NOT NULL DEFAULT 0,expired numeric(6,2) NOT NULL DEFAULT 0,expires_on date NOT NULL,
 UNIQUE(tenant_id,employee_id,leave_type_id,target_year),
 CHECK(amount>=0 AND reserved>=0 AND used>=0 AND expired>=0 AND reserved+used+expired<=amount)
);
CREATE TABLE IF NOT EXISTS hrm_schema.leave_carryover_usage (
 request_id uuid NOT NULL REFERENCES hrm_schema.leave_requests(id),carryover_id uuid NOT NULL REFERENCES hrm_schema.leave_carryovers(id),
 amount numeric(6,2) NOT NULL,state varchar(20) NOT NULL CHECK(state IN ('RESERVED','USED','REVERSED')),
 PRIMARY KEY(request_id,carryover_id)
);
