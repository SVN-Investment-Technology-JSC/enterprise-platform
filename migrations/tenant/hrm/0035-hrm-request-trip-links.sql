SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- ĐƠN TỰ GẮN THEO ĐƠN CÔNG TÁC
--
-- Đơn có ngày (nghỉ phép, OT, đổi ca, giải trình công) rơi vào thời gian của
-- một đơn công tác đang chờ duyệt hoặc đã duyệt thì tự hiện ở dự án của đơn
-- công tác đó — kể cả khi người tạo không chọn dự án. Trùng nhiều đợt công tác
-- thì gắn vào mọi dự án liên quan, nên một đơn có thể có nhiều dòng ở đây.
--
-- DIRECT: người dùng tự chọn dự án. BUSINESS_TRIP: gắn theo đơn công tác
-- `via_request_id`. Chỉ liên kết DIRECT đổi tên và chờ mã DT trước khi mở hồ
-- sơ quy trình; liên kết theo công tác không chặn gì.
-- ===========================================================================
ALTER TABLE hrm_schema.request_project_links
    ADD COLUMN IF NOT EXISTS link_type varchar(20) NOT NULL DEFAULT 'DIRECT',
    ADD COLUMN IF NOT EXISTS via_request_id uuid;

ALTER TABLE hrm_schema.request_project_links
    DROP CONSTRAINT IF EXISTS chk_request_project_links_link_type;
ALTER TABLE hrm_schema.request_project_links
    ADD CONSTRAINT chk_request_project_links_link_type
        CHECK (link_type IN ('DIRECT', 'BUSINESS_TRIP'));

-- Một đơn, nhiều dự án: khoá duy nhất theo từng dự án.
ALTER TABLE hrm_schema.request_project_links
    DROP CONSTRAINT IF EXISTS request_project_links_tenant_id_request_kind_request_id_key;
ALTER TABLE hrm_schema.request_project_links
    DROP CONSTRAINT IF EXISTS uq_request_project_links_project;
ALTER TABLE hrm_schema.request_project_links
    ADD CONSTRAINT uq_request_project_links_project
        UNIQUE (tenant_id, request_kind, request_id, project_id);

CREATE INDEX IF NOT EXISTS idx_request_project_links_request
    ON hrm_schema.request_project_links (tenant_id, request_kind, request_id);

-- Phát trạng thái cho mọi dự án đã nhận đơn. Workspace cập nhật theo nguồn
-- (mọi dự án cùng lúc), nên một sự kiện là đủ; phiên bản lấy số lớn nhất để
-- luôn tăng dù các dòng được đăng ký vào những lúc khác nhau. Trạng thái trung
-- gian riêng của HRM (vd. PEER_CONFIRMED của đổi ca) quy về PENDING.
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
BEGIN
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
                'changedAt', to_jsonb(v_now)
            )
        ),
        v_now
    );
END;
$$ LANGUAGE plpgsql;
