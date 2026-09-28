CREATE TABLE IF NOT EXISTS hrm_schema.automation_settings (
  tenant_id uuid PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh', from_month varchar(7) NOT NULL,
  carryover_enabled boolean NOT NULL DEFAULT false, run_hour integer NOT NULL DEFAULT 2 CHECK(run_hour BETWEEN 0 AND 23),
  configured_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_date date, last_accrual_month varchar(7), last_attempt_at timestamptz, last_error text
);
CREATE TABLE IF NOT EXISTS hrm_schema.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL CHECK(status IN ('SUCCEEDED','FAILED')), result jsonb NOT NULL DEFAULT '{}', error text
);
CREATE INDEX IF NOT EXISTS hrm_automation_runs_idx ON hrm_schema.automation_runs(tenant_id,started_at DESC);
CREATE TABLE IF NOT EXISTS hrm_schema.workflow_rules (
  tenant_id uuid NOT NULL, request_kind text NOT NULL CHECK(request_kind IN ('LEAVE','OT','SHIFT_CHANGE')),
  definition_id uuid NOT NULL, enabled boolean NOT NULL DEFAULT true, updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,request_kind)
);
CREATE TABLE IF NOT EXISTS hrm_schema.workflow_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, request_kind text NOT NULL,
  request_id uuid NOT NULL, definition_id uuid NOT NULL, instance_id uuid, instance_code text,
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','FAILED','APPLIED','IGNORED')),
  attempts integer NOT NULL DEFAULT 0, last_error text, attempted_at timestamptz, callback_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), applied_at timestamptz,
  UNIQUE(tenant_id,request_kind,request_id), UNIQUE(tenant_id,instance_id)
);
CREATE TABLE IF NOT EXISTS hrm_schema.workflow_callbacks (
  tenant_id uuid NOT NULL, event_id uuid NOT NULL, link_id uuid NOT NULL REFERENCES hrm_schema.workflow_links(id),
  processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,event_id)
);
CREATE TABLE IF NOT EXISTS hrm_schema.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, employee_id uuid NOT NULL,
  request_kind text NOT NULL, request_id uuid NOT NULL, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
  FOREIGN KEY(tenant_id,employee_id) REFERENCES core_schema.employees(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS hrm_notifications_employee_idx ON hrm_schema.notifications(tenant_id,employee_id,created_at DESC);

-- A configured Procedure is authoritative: normal HRM endpoints cannot bypass its steps.
CREATE OR REPLACE FUNCTION hrm_schema.guard_workflow_transition() RETURNS trigger AS $$
DECLARE link hrm_schema.workflow_links%ROWTYPE;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('APPROVED','REJECTED') THEN RETURN NEW; END IF;
  SELECT * INTO link FROM hrm_schema.workflow_links WHERE tenant_id=NEW.tenant_id AND request_kind=TG_ARGV[0] AND request_id=NEW.id;
  IF FOUND AND current_setting('hrm.workflow_callback',true) IS DISTINCT FROM link.id::text THEN
    RAISE EXCEPTION 'Đơn đang xử lý qua Procedure Engine; cần hoàn tất quy trình được liên kết' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION hrm_schema.record_request_event() RETURNS trigger AS $$
DECLARE data jsonb; definition uuid; event_id uuid; event_type text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  data=to_jsonb(NEW);
  INSERT INTO hrm_schema.notifications(tenant_id,employee_id,request_kind,request_id,status)
    VALUES(NEW.tenant_id,NEW.employee_id,TG_ARGV[0],NEW.id,NEW.status);
  IF TG_ARGV[0] IN ('LEAVE','OT','SHIFT_CHANGE') AND
    (NEW.status='PEER_CONFIRMED' OR (NEW.status='PENDING' AND (TG_ARGV[0]<>'SHIFT_CHANGE' OR data->>'swap_with_employee_id' IS NULL))) THEN
    SELECT definition_id INTO definition FROM hrm_schema.workflow_rules WHERE tenant_id=NEW.tenant_id AND request_kind=TG_ARGV[0] AND enabled;
    IF FOUND THEN
      INSERT INTO hrm_schema.workflow_links(tenant_id,request_kind,request_id,definition_id) VALUES(NEW.tenant_id,TG_ARGV[0],NEW.id,definition) ON CONFLICT(tenant_id,request_kind,request_id) DO NOTHING;
    END IF;
  END IF;
  event_id=gen_random_uuid(); event_type=CASE WHEN TG_OP='INSERT' THEN 'hrm.request.created' ELSE 'hrm.request.status-changed' END;
  INSERT INTO integration_schema.outbox_events(id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at)
    VALUES(event_id,'hrm-request',NEW.id::text,event_type,1,
      jsonb_build_object('id',event_id,'type',event_type,'version',1,'tenantId',NEW.tenant_id,'source','hrm','correlationId',NEW.id,'occurredAt',now(),
        'payload',jsonb_build_object('requestId',NEW.id,'requestKind',TG_ARGV[0],'employeeId',NEW.employee_id,'status',NEW.status)),now());
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('leave_requests','LEAVE'),('ot_requests','OT'),('shift_change_requests','SHIFT_CHANGE'),
    ('business_trip_requests','BUSINESS_TRIP'),('attendance_corrections','ATTENDANCE'),('profile_corrections','PROFILE'),('salary_advance_requests','ADVANCE')
  ) AS pairs(tab,kind) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS hrm_request_event ON hrm_schema.%I',item.tab);
    EXECUTE format('CREATE TRIGGER hrm_request_event AFTER INSERT OR UPDATE OF status ON hrm_schema.%I FOR EACH ROW EXECUTE FUNCTION hrm_schema.record_request_event(%L)',item.tab,item.kind);
    IF item.kind IN ('LEAVE','OT','SHIFT_CHANGE') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS hrm_workflow_guard ON hrm_schema.%I',item.tab);
      EXECUTE format('CREATE TRIGGER hrm_workflow_guard BEFORE UPDATE OF status ON hrm_schema.%I FOR EACH ROW EXECUTE FUNCTION hrm_schema.guard_workflow_transition(%L)',item.tab,item.kind);
    END IF;
  END LOOP;
END $$;
