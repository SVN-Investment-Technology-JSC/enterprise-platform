SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Keep only the newest legacy status for each request. The unified feed has one
-- durable item per request/category and retains notifications for 90 days.
CREATE TEMP TABLE hrm_notification_backfill ON COMMIT DROP AS
WITH latest AS (
  SELECT DISTINCT ON (n.tenant_id,n.employee_id,n.request_kind,n.request_id)
    n.id,n.tenant_id,n.employee_id,e.user_id,n.request_kind,n.request_id,
    n.status,n.created_at,n.read_at
  FROM hrm_schema.notifications n
  JOIN core_schema.employees e
    ON e.tenant_id=n.tenant_id AND e.id=n.employee_id
  WHERE e.user_id IS NOT NULL
    AND n.created_at > now() - interval '90 days'
  ORDER BY n.tenant_id,n.employee_id,n.request_kind,n.request_id,
    n.created_at DESC,n.id DESC
), eligible AS (
  SELECT latest.*
  FROM latest
  WHERE NOT EXISTS (
    SELECT 1 FROM notification_schema.notifications current
    WHERE current.user_id=latest.user_id
      AND current.source_type='hrm_request'
      AND current.source_id=latest.request_id::text
      AND current.category='request-status'
  )
), numbered AS (
  SELECT eligible.*,
    greatest(
      COALESCE(state.last_sequence,0),
      COALESCE((SELECT max(current.sequence)
        FROM notification_schema.notifications current
        WHERE current.user_id=eligible.user_id),0)
    ) + row_number() OVER (
      PARTITION BY eligible.user_id ORDER BY eligible.created_at,eligible.id
    ) AS sequence
  FROM eligible
  LEFT JOIN notification_schema.user_state state ON state.user_id=eligible.user_id
)
SELECT * FROM numbered;

INSERT INTO notification_schema.notifications (
  id,user_id,module,category,priority,title,body,deep_link,
  source_type,source_id,data,read_at,sequence,created_at,updated_at,expires_at
)
SELECT id,user_id,'hrm','request-status','actionable',
  'Trạng thái yêu cầu đã thay đổi',
  'Yêu cầu '||request_kind||' hiện ở trạng thái '||status||'.',
  '/hrm/requests/'||request_id,
  'hrm_request',request_id::text,
  jsonb_build_object(
    'legacyNotificationId',id,
    'employeeId',employee_id,
    'requestKind',request_kind,
    'status',status
  ),
  read_at,sequence,created_at,created_at,created_at + interval '90 days'
FROM hrm_notification_backfill
ON CONFLICT DO NOTHING;

INSERT INTO notification_schema.user_state(user_id,last_sequence,unread_count)
SELECT users.user_id,max(feed.sequence),
  count(*) FILTER (WHERE feed.read_at IS NULL AND feed.expires_at > now())::integer
FROM (SELECT DISTINCT user_id FROM hrm_notification_backfill) users
JOIN notification_schema.notifications feed ON feed.user_id=users.user_id
GROUP BY users.user_id
ON CONFLICT(user_id) DO UPDATE SET
  last_sequence=greatest(
    notification_schema.user_state.last_sequence,
    EXCLUDED.last_sequence
  ),
  unread_count=EXCLUDED.unread_count,
  updated_at=now();

-- The legacy table remains available for audit/rollback, but all new writes go
-- through the tenant outbox and are materialized by notification-worker.
CREATE OR REPLACE FUNCTION hrm_schema.record_request_event() RETURNS trigger AS $$
DECLARE
  event_id uuid;
  event_type text;
  requester_user_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT employee.user_id INTO requester_user_id
  FROM core_schema.employees employee
  WHERE employee.tenant_id=NEW.tenant_id AND employee.id=NEW.employee_id;

  event_id=gen_random_uuid();
  event_type=CASE
    WHEN TG_OP='INSERT' THEN 'hrm.request.created'
    ELSE 'hrm.request.status-changed'
  END;

  INSERT INTO integration_schema.outbox_events(
    id,aggregate_type,aggregate_id,event_type,event_version,payload,occurred_at
  ) VALUES (
    event_id,'hrm-request',NEW.id::text,event_type,1,
    jsonb_build_object(
      'id',event_id,
      'type',event_type,
      'version',1,
      'tenantId',NEW.tenant_id,
      'source','hrm',
      'correlationId',NEW.id,
      'occurredAt',now(),
      'payload',jsonb_build_object(
        'requestId',NEW.id,
        'requestKind',TG_ARGV[0],
        'employeeId',NEW.employee_id,
        'requesterUserId',requester_user_id,
        'status',NEW.status
      )
    ),
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
