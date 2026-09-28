SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE hrm_schema.employment_contracts
  ADD COLUMN IF NOT EXISTS parent_contract_id uuid,
  ADD COLUMN IF NOT EXISTS issued_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS issued_by uuid,
  ADD COLUMN IF NOT EXISTS terminated_on date,
  ADD COLUMN IF NOT EXISTS termination_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS hrm_contract_tenant_id_unique ON hrm_schema.employment_contracts(tenant_id,id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='hrm_schema.employment_contracts'::regclass AND conname='hrm_contract_parent_fk') THEN
    ALTER TABLE hrm_schema.employment_contracts ADD CONSTRAINT hrm_contract_parent_fk
      FOREIGN KEY(tenant_id,parent_contract_id) REFERENCES hrm_schema.employment_contracts(tenant_id,id);
  END IF;
END $$;
