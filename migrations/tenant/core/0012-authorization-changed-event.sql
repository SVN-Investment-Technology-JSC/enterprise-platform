-- Vai trò, quyền, người dùng của công ty đổi thì ngoài tăng số hiệu (rào cache quyền) còn ghi sự kiện
-- `core.authorization.changed` vào outbox, cùng transaction với thay đổi. realtime-api báo mọi phiên của công ty để
-- trình duyệt đang mở (hàng phím Trợ lý, ô chuyển phân hệ) tự hỏi lại quyền, không phải tải lại trang.
-- Sự kiện chỉ mang số hiệu mới, không mang quyền của ai. Relay bù tenantId cho sự kiện ghi từ trigger.
-- Chạy lại được: CREATE OR REPLACE giữ nguyên các trigger rbac_revision_* (0005) đang gọi hàm này.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION core_schema.bump_authorization_revision() RETURNS trigger AS $$
DECLARE
  v_revision core_schema.authorization_state.revision%TYPE;
  v_event_id uuid := gen_random_uuid();
BEGIN
  UPDATE core_schema.authorization_state SET revision = revision + 1 WHERE id = true
  RETURNING revision INTO v_revision;
  IF v_revision IS NOT NULL AND to_regclass('integration_schema.outbox_events') IS NOT NULL THEN
    INSERT INTO integration_schema.outbox_events
      (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
    VALUES (
      v_event_id,
      'core-authorization',
      'authorization',
      'core.authorization.changed',
      1,
      jsonb_build_object(
        'id', v_event_id,
        'type', 'core.authorization.changed',
        'version', 1,
        'source', 'tenant-core',
        'correlationId', v_event_id::text,
        'occurredAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'payload', jsonb_build_object('revision', v_revision)
      ),
      now()
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
