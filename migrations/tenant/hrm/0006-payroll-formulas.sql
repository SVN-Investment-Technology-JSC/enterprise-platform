SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS hrm_schema.payroll_employee_inputs (
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  effective_from date NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,employee_id,effective_from),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
ALTER TABLE hrm_schema.payroll_items DROP CONSTRAINT IF EXISTS payroll_items_item_type_check;
ALTER TABLE hrm_schema.payroll_items ADD CONSTRAINT payroll_items_item_type_check CHECK(item_type IN ('EARNING','ALLOWANCE','OVERTIME','STATUTORY_DEDUCTION','TAX_DEDUCTION','ADVANCE_DEDUCTION','OTHER_DEDUCTION','NET_PAY'));
ALTER TABLE hrm_schema.payroll_employee_totals ADD COLUMN IF NOT EXISTS payment_reference varchar(180), ADD COLUMN IF NOT EXISTS paid_at timestamptz;
