-- Bổ sung envelope đầy đủ (occurredAt, tenantId, source, correlationId) cho sự kiện outbox của CORE.
-- Trước đây payload thiếu occurredAt nên RabbitMqPublisher gặp timestamp NaN và relay retry mãi.
-- Bảng core không có tenant_id: suy ra từ core_schema.employees (mỗi database tenant chỉ chứa một tenant).
CREATE OR REPLACE FUNCTION core_schema.resolve_outbox_tenant_id(p_employee_id uuid, p_user_id uuid)
RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT e.tenant_id FROM core_schema.employees e WHERE e.id = p_employee_id),
    (SELECT e.tenant_id FROM core_schema.employees e WHERE e.user_id = p_user_id LIMIT 1),
    (SELECT e.tenant_id FROM core_schema.employees e LIMIT 1)
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION core_schema.record_assignment_event() RETURNS trigger AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
  v_event_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'core.org.assignment.created';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IN ('ended', 'inactive') AND OLD.status = 'active' THEN
      v_event_type := 'core.org.assignment.ended';
    ELSE
      v_event_type := 'core.org.assignment.updated';
    END IF;
  END IF;

  INSERT INTO integration_schema.outbox_events
    (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
  VALUES (
    v_event_id,
    'org-assignment',
    NEW.id::text,
    v_event_type,
    1,
    jsonb_build_object(
      'id', v_event_id,
      'type', v_event_type,
      'version', 1,
      'occurredAt', now(),
      'tenantId', core_schema.resolve_outbox_tenant_id(NEW.employee_id, NEW.user_id),
      'source', 'core-organization',
      'correlationId', NEW.id,
      'payload', jsonb_build_object(
        'assignmentId', NEW.id,
        'nodeId',       NEW.node_id,
        'userId',       NEW.user_id,
        'employeeId',   NEW.employee_id,
        'status',       NEW.status,
        'startDate',    NEW.start_date,
        'endDate',      NEW.end_date,
        'isPrimary',    NEW.is_primary
      )
    ),
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION core_schema.record_position_node_deleted() RETURNS trigger AS $$
DECLARE
  v_event_id uuid := gen_random_uuid();
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.category = 'position' THEN
    INSERT INTO integration_schema.outbox_events
      (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
    VALUES (
      v_event_id,
      'org-node',
      NEW.id::text,
      'core.org.position.deleted',
      1,
      jsonb_build_object(
        'id', v_event_id,
        'type', 'core.org.position.deleted',
        'version', 1,
        'occurredAt', now(),
        'tenantId', core_schema.resolve_outbox_tenant_id(NULL, NULL),
        'source', 'core-organization',
        'correlationId', NEW.id,
        'payload', jsonb_build_object(
          'nodeId', NEW.id,
          'name', NEW.name,
          'code', NEW.code,
          'deletedAt', NEW.deleted_at
        )
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
