SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION hrm_schema.canonical_request_kind(kind text) RETURNS text AS $$
  SELECT CASE kind WHEN 'LEAVE' THEN 'leave' WHEN 'OT' THEN 'ot' WHEN 'BUSINESS_TRIP' THEN 'business_trip'
    WHEN 'SHIFT_CHANGE' THEN 'shift_change' WHEN 'ATTENDANCE' THEN 'correction' WHEN 'ADVANCE' THEN 'advance'
    WHEN 'PROFILE' THEN 'profile_correction' ELSE kind END;
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE hrm_schema.request_procedure_bindings
  ALTER COLUMN procedure_definition_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'PROCEDURE' CHECK(mode IN ('DIRECT','PROCEDURE')),
  ADD COLUMN IF NOT EXISTS configuration_status text NOT NULL DEFAULT 'ACTIVE' CHECK(configuration_status IN ('ACTIVE','CONFLICT')),
  ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE hrm_schema.profile_corrections ADD COLUMN IF NOT EXISTS procedure_instance_id uuid;

INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,procedure_definition_id,mode,updated_by)
SELECT r.tenant_id,hrm_schema.canonical_request_kind(r.request_kind),r.definition_id,'PROCEDURE',r.updated_by
FROM hrm_schema.workflow_rules r WHERE r.enabled AND NOT EXISTS (
  SELECT 1 FROM hrm_schema.request_procedure_bindings b WHERE b.tenant_id=r.tenant_id
    AND b.request_kind=hrm_schema.canonical_request_kind(r.request_kind) AND b.sub_type_code IS NULL
    AND b.is_active AND b.mode='PROCEDURE' AND b.procedure_definition_id=r.definition_id);

-- Existing tenants without a workflow retain direct approval, explicitly recorded.
-- New tenants configure their modes before submission; absence is never a fallback.
INSERT INTO hrm_schema.request_procedure_bindings(tenant_id,request_kind,mode)
SELECT t.tenant_id,k.kind,'DIRECT' FROM (SELECT DISTINCT tenant_id FROM hrm_schema.employee_profiles) t
CROSS JOIN unnest(ARRAY['leave','ot','business_trip','shift_change','correction','advance','profile_correction']) k(kind)
WHERE NOT EXISTS (SELECT 1 FROM hrm_schema.request_procedure_bindings b
  WHERE b.tenant_id=t.tenant_id AND b.request_kind=k.kind AND b.sub_type_code IS NULL AND b.is_active);

UPDATE hrm_schema.request_procedure_bindings b SET configuration_status='CONFLICT'
WHERE b.is_active AND EXISTS (SELECT 1 FROM hrm_schema.request_procedure_bindings other
  WHERE other.tenant_id=b.tenant_id AND other.request_kind=b.request_kind AND other.is_active
    AND other.sub_type_code IS NOT DISTINCT FROM b.sub_type_code
    AND (other.mode IS DISTINCT FROM b.mode OR other.procedure_definition_id IS DISTINCT FROM b.procedure_definition_id));

CREATE TABLE IF NOT EXISTS hrm_schema.procedure_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,
  request_kind text NOT NULL CHECK(request_kind IN ('leave','ot','business_trip','shift_change','correction','advance','profile_correction')),
  request_id uuid NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),employee_id uuid NOT NULL,
  initiated_by uuid NOT NULL,title text NOT NULL,attributes jsonb NOT NULL DEFAULT '{}',
  binding_id uuid,definition_id uuid,definition_version_id uuid,
  instance_id uuid,instance_code text,
  source_type text NOT NULL DEFAULT 'hrm_request',source_id uuid NOT NULL,
  start_idempotency_key text NOT NULL,
  sync_status text NOT NULL DEFAULT 'START_PENDING' CHECK(sync_status IN ('START_PENDING','RUNNING','APPLY_PENDING','APPLIED','FAILED','CONFLICT')),
  attempts integer NOT NULL DEFAULT 0,last_error text,attempted_at timestamptz,
  lease_until timestamptz,lease_token uuid,result_event jsonb,
  legacy_link_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz,
  UNIQUE(tenant_id,request_kind,request_id,revision),UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,start_idempotency_key),FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS hrm_procedure_pending_idx ON hrm_schema.procedure_links(tenant_id,sync_status,attempted_at);

CREATE TABLE IF NOT EXISTS hrm_schema.procedure_correlations (
  tenant_id uuid NOT NULL,link_id uuid NOT NULL,instance_id uuid NOT NULL,source_type text NOT NULL,source_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,link_id,instance_id,source_type,source_id),
  FOREIGN KEY(tenant_id,link_id) REFERENCES hrm_schema.procedure_links(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS hrm_procedure_correlation_idx ON hrm_schema.procedure_correlations(tenant_id,instance_id,source_type,source_id);
CREATE TABLE IF NOT EXISTS hrm_schema.procedure_result_inbox (
  tenant_id uuid NOT NULL,event_id uuid NOT NULL,instance_id uuid NOT NULL,source_type text NOT NULL,source_id uuid NOT NULL,
  event jsonb NOT NULL,link_id uuid,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPLIED','FAILED','REJECTED')),
  received_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,last_error text,
  PRIMARY KEY(tenant_id,event_id),FOREIGN KEY(tenant_id,link_id) REFERENCES hrm_schema.procedure_links(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS hrm_procedure_inbox_pending_idx ON hrm_schema.procedure_result_inbox(tenant_id,status,received_at);

-- Both histories are retained as correlations. No external instance is modified.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES ('leave_requests','leave'),('ot_requests','ot'),('business_trip_requests','business_trip'),
    ('shift_change_requests','shift_change'),('attendance_corrections','correction'),('salary_advance_requests','advance'),('profile_corrections','profile_correction')) p(tab,kind)
  LOOP
    EXECUTE format($sql$
      INSERT INTO hrm_schema.procedure_links(tenant_id,request_kind,request_id,employee_id,initiated_by,title,
        definition_id,source_type,source_id,start_idempotency_key,sync_status,legacy_link_id,applied_at,last_error)
      SELECT r.tenant_id,%L,r.id,r.employee_id,COALESCE(e.user_id,'00000000-0000-4000-8000-000000000001'::uuid),
        'HRM '||%L||' '||r.id,w.definition_id,'hrm_request',w.id,w.id::text,
        CASE WHEN w.status='APPLIED' THEN 'APPLIED' WHEN w.instance_id IS NOT NULL THEN 'RUNNING'
          WHEN w.status IN ('IGNORED','FAILED') THEN 'FAILED' ELSE 'START_PENDING' END,w.id,w.applied_at,w.last_error
      FROM hrm_schema.%I r JOIN hrm_schema.workflow_links w ON w.tenant_id=r.tenant_id AND w.request_id=r.id
        AND hrm_schema.canonical_request_kind(w.request_kind)=%L
      JOIN core_schema.employees e ON e.tenant_id=r.tenant_id AND e.id=r.employee_id
      ON CONFLICT(tenant_id,request_kind,request_id,revision) DO NOTHING;
      INSERT INTO hrm_schema.procedure_links(tenant_id,request_kind,request_id,employee_id,initiated_by,title,
        source_type,source_id,start_idempotency_key,sync_status,applied_at)
      SELECT r.tenant_id,%L,r.id,r.employee_id,COALESCE(e.user_id,'00000000-0000-4000-8000-000000000001'::uuid),
        'HRM '||%L||' '||r.id,'manual',r.id,'hrm_'||%L||'_'||r.id,
        CASE WHEN r.status IN ('APPROVED','DISBURSED','REJECTED','CANCELLED') THEN 'APPLIED' ELSE 'RUNNING' END,
        CASE WHEN r.status IN ('APPROVED','DISBURSED','REJECTED','CANCELLED') THEN now() END
      FROM hrm_schema.%I r JOIN core_schema.employees e ON e.tenant_id=r.tenant_id AND e.id=r.employee_id
      WHERE r.procedure_instance_id IS NOT NULL ON CONFLICT(tenant_id,request_kind,request_id,revision) DO NOTHING;
      INSERT INTO hrm_schema.procedure_correlations(tenant_id,link_id,instance_id,source_type,source_id)
      SELECT r.tenant_id,l.id,r.procedure_instance_id,'manual',r.id FROM hrm_schema.%I r
      JOIN hrm_schema.procedure_links l ON l.tenant_id=r.tenant_id AND l.request_kind=%L AND l.request_id=r.id AND l.revision=1
      WHERE r.procedure_instance_id IS NOT NULL ON CONFLICT DO NOTHING;
    $sql$,item.kind,item.kind,item.tab,item.kind,item.kind,item.kind,item.kind,item.tab,item.tab,item.kind);
  END LOOP;
END $$;
INSERT INTO hrm_schema.procedure_correlations(tenant_id,link_id,instance_id,source_type,source_id)
SELECT w.tenant_id,l.id,w.instance_id,'hrm_request',w.id FROM hrm_schema.workflow_links w
JOIN hrm_schema.procedure_links l ON l.tenant_id=w.tenant_id AND l.legacy_link_id=w.id
WHERE w.instance_id IS NOT NULL ON CONFLICT DO NOTHING;

UPDATE hrm_schema.procedure_links l SET sync_status='CONFLICT',instance_id=NULL,
  last_error='Một đơn có nhiều instance hoặc một instance liên kết nhiều đơn; cần đối soát Procedure'
WHERE EXISTS (SELECT 1 FROM hrm_schema.procedure_correlations c WHERE c.tenant_id=l.tenant_id AND c.link_id=l.id
  AND (EXISTS (SELECT 1 FROM hrm_schema.procedure_correlations other WHERE other.tenant_id=c.tenant_id AND other.link_id=c.link_id AND other.instance_id<>c.instance_id)
    OR EXISTS (SELECT 1 FROM hrm_schema.procedure_correlations other WHERE other.tenant_id=c.tenant_id AND other.instance_id=c.instance_id AND other.link_id<>c.link_id)));
UPDATE hrm_schema.procedure_links l SET instance_id=(SELECT c.instance_id FROM hrm_schema.procedure_correlations c WHERE c.tenant_id=l.tenant_id AND c.link_id=l.id LIMIT 1)
WHERE l.instance_id IS NULL AND l.sync_status<>'CONFLICT'
  AND EXISTS (SELECT 1 FROM hrm_schema.procedure_correlations c WHERE c.tenant_id=l.tenant_id AND c.link_id=l.id);
CREATE UNIQUE INDEX IF NOT EXISTS hrm_procedure_instance_unique ON hrm_schema.procedure_links(tenant_id,instance_id) WHERE instance_id IS NOT NULL;

DO $$ BEGIN
  IF to_regclass('procedure_schema.instances') IS NOT NULL THEN
    UPDATE hrm_schema.procedure_links l SET definition_id=i.definition_id,definition_version_id=i.version_id,instance_code=i.code
      FROM procedure_schema.instances i WHERE l.instance_id=i.id AND l.definition_version_id IS NULL;
  END IF;
END $$;

INSERT INTO hrm_schema.procedure_result_inbox(tenant_id,event_id,instance_id,source_type,source_id,event,link_id)
SELECT l.tenant_id,(w.callback_event->>'id')::uuid,w.instance_id,'hrm_request',w.id,w.callback_event,l.id
FROM hrm_schema.workflow_links w JOIN hrm_schema.procedure_links l ON l.tenant_id=w.tenant_id AND l.legacy_link_id=w.id
WHERE w.callback_event IS NOT NULL AND w.instance_id IS NOT NULL AND l.sync_status<>'APPLIED'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION hrm_schema.guard_workflow_transition() RETURNS trigger AS $$
DECLARE link hrm_schema.procedure_links%ROWTYPE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('APPROVED','REJECTED','CANCELLED') THEN RETURN NEW; END IF;
  SELECT * INTO link FROM hrm_schema.procedure_links WHERE tenant_id=NEW.tenant_id
    AND request_kind=hrm_schema.canonical_request_kind(TG_ARGV[0]) AND request_id=NEW.id ORDER BY revision DESC LIMIT 1;
  IF FOUND AND current_setting('hrm.workflow_callback',true) IS DISTINCT FROM link.id::text THEN
    RAISE EXCEPTION 'Đơn đang xử lý qua Procedure Engine; cần hoàn tất quy trình được liên kết' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Preserve notifications/outbox while retiring only the second instance creator.
CREATE OR REPLACE FUNCTION hrm_schema.record_request_event() RETURNS trigger AS $$
DECLARE event_id uuid; event_type text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  INSERT INTO hrm_schema.notifications(tenant_id,employee_id,request_kind,request_id,status)
    VALUES(NEW.tenant_id,NEW.employee_id,TG_ARGV[0],NEW.id,NEW.status);
  event_id=gen_random_uuid();event_type=CASE WHEN TG_OP='INSERT' THEN 'hrm.request.created' ELSE 'hrm.request.status-changed' END;
  INSERT INTO integration_schema.outbox_events(id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
    VALUES(event_id,'hrm-request',NEW.id::text,event_type,1,
      jsonb_build_object('id',event_id,'type',event_type,'version',1,'tenantId',NEW.tenant_id,'source','hrm','correlationId',NEW.id,'occurredAt',now(),
        'payload',jsonb_build_object('requestId',NEW.id,'requestKind',TG_ARGV[0],'employeeId',NEW.employee_id,'status',NEW.status)),now());
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES ('leave_requests','leave'),('ot_requests','ot'),('business_trip_requests','business_trip'),
    ('shift_change_requests','shift_change'),('attendance_corrections','correction'),('salary_advance_requests','advance'),('profile_corrections','profile_correction')) p(tab,kind)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hrm_workflow_guard ON hrm_schema.%I',item.tab);
    EXECUTE format('CREATE TRIGGER hrm_workflow_guard BEFORE UPDATE OF status ON hrm_schema.%I FOR EACH ROW EXECUTE FUNCTION hrm_schema.guard_workflow_transition(%L)',item.tab,item.kind);
  END LOOP;
END $$;
