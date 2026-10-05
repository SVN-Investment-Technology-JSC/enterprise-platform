-- Hàm trigger ghi nhận sự kiện bổ nhiệm / thay đổi phân công
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
      'source', 'core-organization',
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

DROP TRIGGER IF EXISTS trg_core_assignment_event ON core_schema.organization_node_assignments;
CREATE TRIGGER trg_core_assignment_event
  AFTER INSERT OR UPDATE OF status, is_primary, end_date, employee_id
  ON core_schema.organization_node_assignments
  FOR EACH ROW EXECUTE FUNCTION core_schema.record_assignment_event();

-- Hàm trigger khi node chức danh (category = position) bị xóa
CREATE OR REPLACE FUNCTION core_schema.record_position_node_deleted() RETURNS trigger AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.category = 'position' THEN
    INSERT INTO integration_schema.outbox_events
      (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
    VALUES (
      gen_random_uuid(),
      'org-node',
      NEW.id::text,
      'core.org.position.deleted',
      1,
      jsonb_build_object(
        'nodeId', NEW.id,
        'name', NEW.name,
        'code', NEW.code,
        'deletedAt', NEW.deleted_at
      ),
      now()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_core_node_deleted ON core_schema.organization_nodes;
CREATE TRIGGER trg_core_node_deleted
  AFTER UPDATE OF deleted_at ON core_schema.organization_nodes
  FOR EACH ROW EXECUTE FUNCTION core_schema.record_position_node_deleted();
