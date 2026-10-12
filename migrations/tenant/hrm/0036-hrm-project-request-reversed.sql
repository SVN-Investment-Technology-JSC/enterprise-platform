SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Đơn gắn dự án bị huỷ hiệu lực: Workspace hiện "Đã huỷ hiệu lực" (REVERSED)
-- kèm lý do, thay vì "Đã huỷ" như đơn rút khi đang chờ. Trigger trên bảng đơn
-- giữ nguyên; chỉ thay hàm phát sự kiện.
CREATE OR REPLACE FUNCTION hrm_schema.emit_project_request_update(
    p_tenant_id uuid,
    p_request_kind text,
    p_request_id uuid,
    p_status text,
    p_instance_id uuid
) RETURNS void AS $$
DECLARE
    v_event_id uuid := gen_random_uuid();
    v_version integer;
    v_instance_code text;
    v_now timestamptz := clock_timestamp();
    v_status text := CASE WHEN p_status IN ('APPROVED', 'REJECTED', 'CANCELLED')
                          THEN p_status ELSE 'PENDING' END;
    v_reversal_id text := NULLIF(current_setting('hrm.business_reversal', true), '');
    v_reason text;
BEGIN
    -- Huỷ hiệu lực (reverseApprovedRequest đặt hrm.business_reversal trong cùng
    -- transaction): báo REVERSED kèm lý do, khác với rút/huỷ đơn đang chờ.
    IF v_status = 'CANCELLED' AND v_reversal_id IS NOT NULL THEN
        SELECT reason INTO v_reason
          FROM hrm_schema.request_reversals
         WHERE id::text = v_reversal_id AND tenant_id = p_tenant_id
           AND request_kind = p_request_kind AND request_id = p_request_id;
        IF FOUND THEN
            v_status := 'REVERSED';
        END IF;
    END IF;

    UPDATE hrm_schema.request_project_links
       SET status_version = status_version + 1, updated_at = now()
     WHERE tenant_id = p_tenant_id AND request_kind = p_request_kind
       AND request_id = p_request_id AND status = 'REGISTERED';
    IF NOT FOUND THEN
        RETURN;
    END IF;
    SELECT max(status_version) INTO v_version
      FROM hrm_schema.request_project_links
     WHERE tenant_id = p_tenant_id AND request_kind = p_request_kind
       AND request_id = p_request_id AND status = 'REGISTERED';

    IF p_instance_id IS NOT NULL THEN
        SELECT NULLIF(instance_code, '') INTO v_instance_code
          FROM hrm_schema.procedure_links
         WHERE tenant_id = p_tenant_id AND instance_id = p_instance_id
         LIMIT 1;
    END IF;

    INSERT INTO integration_schema.outbox_events
        (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at)
    VALUES (
        v_event_id,
        'hrm-request',
        p_request_id::text,
        'hrm.project_request.updated',
        1,
        jsonb_build_object(
            'id', v_event_id,
            'type', 'hrm.project_request.updated',
            'version', 1,
            'tenantId', p_tenant_id,
            'source', 'hrm',
            'correlationId', p_request_id,
            'occurredAt', to_jsonb(v_now),
            'payload', jsonb_build_object(
                'requestKind', p_request_kind,
                'requestId', p_request_id,
                'status', v_status,
                'version', v_version,
                'procedureInstanceId', p_instance_id,
                'procedureInstanceCode', v_instance_code,
                'changedAt', to_jsonb(v_now),
                'reason', v_reason
            )
        ),
        v_now
    );
END;
$$ LANGUAGE plpgsql;
