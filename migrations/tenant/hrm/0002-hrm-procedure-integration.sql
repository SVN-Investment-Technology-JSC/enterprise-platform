-- Migration: Add Procedure Engine integration columns to HRM requests
-- File: migrations/tenant/hrm/0002-hrm-procedure-integration.sql

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. request_procedure_bindings
CREATE TABLE IF NOT EXISTS hrm_schema.request_procedure_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  request_kind VARCHAR(50) NOT NULL,
  sub_type_code VARCHAR(50),
  procedure_definition_id UUID NOT NULL,
  condition_rules JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_hrm_req_proc_binding UNIQUE (tenant_id, request_kind, sub_type_code)
);
CREATE INDEX IF NOT EXISTS idx_hrm_req_proc_binding ON hrm_schema.request_procedure_bindings(tenant_id, request_kind);

-- 2. leave_requests
ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS procedure_instance_id UUID;
ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS current_step_name VARCHAR(100);
ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS current_assignee_id VARCHAR(100);
ALTER TABLE hrm_schema.leave_requests ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50) DEFAULT 'DRAFT';

-- 3. ot_requests
ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS procedure_instance_id UUID;
ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS current_step_name VARCHAR(100);
ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS current_assignee_id VARCHAR(100);
ALTER TABLE hrm_schema.ot_requests ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50) DEFAULT 'DRAFT';

-- 4. business_trip_requests
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS procedure_instance_id UUID;
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS current_step_name VARCHAR(100);
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS current_assignee_id VARCHAR(100);
ALTER TABLE hrm_schema.business_trip_requests ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50) DEFAULT 'DRAFT';

-- 5. shift_change_requests
ALTER TABLE hrm_schema.shift_change_requests ADD COLUMN IF NOT EXISTS procedure_instance_id UUID;
ALTER TABLE hrm_schema.shift_change_requests ADD COLUMN IF NOT EXISTS current_step_name VARCHAR(100);
ALTER TABLE hrm_schema.shift_change_requests ADD COLUMN IF NOT EXISTS current_assignee_id VARCHAR(100);
ALTER TABLE hrm_schema.shift_change_requests ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50) DEFAULT 'DRAFT';

-- 6. attendance_corrections
ALTER TABLE hrm_schema.attendance_corrections ADD COLUMN IF NOT EXISTS procedure_instance_id UUID;
ALTER TABLE hrm_schema.attendance_corrections ADD COLUMN IF NOT EXISTS current_step_name VARCHAR(100);
ALTER TABLE hrm_schema.attendance_corrections ADD COLUMN IF NOT EXISTS current_assignee_id VARCHAR(100);
ALTER TABLE hrm_schema.attendance_corrections ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50) DEFAULT 'DRAFT';

-- 7. salary_advance_requests
ALTER TABLE hrm_schema.salary_advance_requests ADD COLUMN IF NOT EXISTS procedure_instance_id UUID;
ALTER TABLE hrm_schema.salary_advance_requests ADD COLUMN IF NOT EXISTS current_step_name VARCHAR(100);
ALTER TABLE hrm_schema.salary_advance_requests ADD COLUMN IF NOT EXISTS current_assignee_id VARCHAR(100);
ALTER TABLE hrm_schema.salary_advance_requests ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(50) DEFAULT 'DRAFT';
