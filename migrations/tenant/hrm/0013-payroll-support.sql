CREATE TABLE IF NOT EXISTS hrm_schema.employee_dependents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, employee_id uuid NOT NULL,
  reference_code varchar(100) NOT NULL, full_name varchar(200) NOT NULL, relationship varchar(100) NOT NULL,
  birth_date date NOT NULL, tax_code varchar(50), evidence_reference varchar(500) NOT NULL,
  effective_from date NOT NULL, effective_to date,
  verified_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(effective_to IS NULL OR effective_to>=effective_from),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS hrm_dependents_employee_idx ON hrm_schema.employee_dependents(tenant_id,employee_id,effective_from);
ALTER TABLE hrm_schema.payroll_employee_totals ADD COLUMN IF NOT EXISTS beneficiary_snapshot jsonb;
