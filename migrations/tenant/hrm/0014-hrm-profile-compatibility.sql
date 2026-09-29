SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.employee_profiles
  ADD COLUMN IF NOT EXISTS marital_status varchar(50),
  ADD COLUMN IF NOT EXISTS nationality varchar(100),
  ADD COLUMN IF NOT EXISTS ethnicity varchar(100),
  ADD COLUMN IF NOT EXISTS religion varchar(100),
  ADD COLUMN IF NOT EXISTS place_of_birth text,
  ADD COLUMN IF NOT EXISTS hometown text;

-- Run before payroll-support for tenants which used the original self-declaration
-- layout. Verified registrations are never inferred from a self-declared checkbox.
DO $$ BEGIN
  IF to_regclass('hrm_schema.employee_dependents') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='hrm_schema'
       AND table_name='employee_dependents' AND column_name='reference_code') THEN
    IF to_regclass('hrm_schema.employee_family_members') IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='hrm_schema'
         AND table_name='employee_dependents' AND column_name='date_of_birth') THEN
      RAISE EXCEPTION 'Unrecognized dependent layout: reconcile employee_dependents with employee_family_members before retrying HRM provisioning';
    END IF;
    ALTER TABLE hrm_schema.employee_dependents RENAME TO employee_family_members;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hrm_schema.employee_family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, employee_id uuid NOT NULL,
  full_name varchar(200) NOT NULL, relationship varchar(100) NOT NULL,
  date_of_birth date, phone varchar(50), identity_card_number varchar(100), tax_code varchar(50),
  is_dependent boolean NOT NULL DEFAULT false, dependent_from date, dependent_to date,
  note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, updated_by uuid, deleted_at timestamptz, deleted_by uuid
);
ALTER TABLE hrm_schema.employee_family_members ALTER COLUMN id SET DEFAULT gen_random_uuid();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='hrm_schema.employee_family_members'::regclass AND conname='hrm_family_employee_fk') THEN
    ALTER TABLE hrm_schema.employee_family_members ADD CONSTRAINT hrm_family_employee_fk
      FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS hrm_family_employee_idx ON hrm_schema.employee_family_members(tenant_id,employee_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS hrm_schema.employment_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,employee_id uuid NOT NULL,
  contract_code varchar(100) NOT NULL,contract_type varchar(100) NOT NULL,sign_date date,
  effective_from date NOT NULL,effective_to date,status varchar(30) NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','ACTIVE','EXPIRED','TERMINATED')),
  base_salary numeric(15,2) CHECK(base_salary>=0),note text,file_url text,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,updated_by uuid,deleted_at timestamptz,deleted_by uuid,
  CHECK(effective_to IS NULL OR effective_to>=effective_from),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS hrm_contract_code_unique ON hrm_schema.employment_contracts(tenant_id,contract_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS hrm_contract_employee_idx ON hrm_schema.employment_contracts(tenant_id,employee_id,effective_from);

-- PostgreSQL expands ep.* when creating a view. Append new fields to the stored
-- projection; retain the order/types of existing columns and all dependent views.
DO $$
DECLARE projection text; prior_definition text;
BEGIN
  SELECT string_agg(format('ep.%I', name), ', ' ORDER BY ordinal)
    INTO projection
    FROM unnest(ARRAY['marital_status','nationality','ethnicity','religion','place_of_birth','hometown']) WITH ORDINALITY AS fields(name,ordinal)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='hrm_schema'
      AND table_name='employee_directory' AND column_name=fields.name);
  IF projection IS NOT NULL THEN
    prior_definition := regexp_replace(pg_get_viewdef('hrm_schema.employee_directory'::regclass,true), ';\s*$', '');
    EXECUTE format('CREATE OR REPLACE VIEW hrm_schema.employee_directory AS SELECT existing.*, %s FROM (%s) existing
      JOIN hrm_schema.employee_profiles ep ON ep.tenant_id=existing.tenant_id AND ep.employee_id=existing.employee_id', projection, prior_definition);
  END IF;
END $$;
