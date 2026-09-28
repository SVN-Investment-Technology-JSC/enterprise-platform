SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Incomplete drafts must not reserve leave, enter OT limits or start a workflow.
CREATE TABLE IF NOT EXISTS hrm_schema.request_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  request_kind text NOT NULL CHECK(request_kind IN ('leave','ot','business_trip','shift_change','correction','advance','profile_correction')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SUBMITTED','DELETED')),
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
  submitted_request_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id),
  CHECK((status='SUBMITTED') = (submitted_request_id IS NOT NULL)),
  UNIQUE(tenant_id,request_kind,submitted_request_id)
);
CREATE INDEX IF NOT EXISTS hrm_draft_owner_idx ON hrm_schema.request_drafts(tenant_id,employee_id,status,updated_at DESC);
