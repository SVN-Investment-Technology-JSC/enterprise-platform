-- Business reversals retain the completed Procedure and its approval evidence.
CREATE TABLE IF NOT EXISTS hrm_schema.request_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  request_kind text NOT NULL CHECK(request_kind IN ('leave','ot','business_trip','correction','advance')),
  request_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  request_revision integer NOT NULL,
  before_snapshot jsonb NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason)) > 0),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,request_kind,request_id),
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);

CREATE OR REPLACE FUNCTION hrm_schema.guard_workflow_transition() RETURNS trigger AS $$
DECLARE link hrm_schema.procedure_links%ROWTYPE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('APPROVED','REJECTED','CANCELLED') THEN RETURN NEW; END IF;
  IF OLD.status='APPROVED' AND NEW.status='CANCELLED' AND EXISTS (
    SELECT 1 FROM hrm_schema.request_reversals r
    WHERE r.tenant_id=NEW.tenant_id AND r.request_kind=hrm_schema.canonical_request_kind(TG_ARGV[0])
      AND r.request_id=NEW.id AND r.request_revision=COALESCE((to_jsonb(OLD)->>'revision')::integer,1)
      AND r.id::text=current_setting('hrm.business_reversal',true)
  ) THEN RETURN NEW; END IF;
  SELECT * INTO link FROM hrm_schema.procedure_links WHERE tenant_id=NEW.tenant_id
    AND request_kind=hrm_schema.canonical_request_kind(TG_ARGV[0]) AND request_id=NEW.id ORDER BY revision DESC LIMIT 1;
  IF FOUND AND current_setting('hrm.workflow_callback',true) IS DISTINCT FROM link.id::text THEN
    RAISE EXCEPTION 'Đơn đang xử lý qua Procedure Engine; cần hoàn tất quy trình được liên kết' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
