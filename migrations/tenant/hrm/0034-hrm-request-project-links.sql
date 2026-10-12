SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- ĐƠN TỪ GẮN DỰ ÁN (Workspace)
--
-- "Dự án liên kết" là một trường dùng chung, không gắn cứng vào loại đơn nào:
-- đơn nào có trường này thì có một dòng ở đây. Hiện chỉ đơn công tác dùng;
-- khi form đơn thành dynamic, loại đơn mới có trường dự án tự liên kết.
--
-- HRM không đọc hay ghi bảng của Workspace. Gửi duyệt thì phát
-- `hrm.project_request.submitted`; Workspace tự kiểm người gửi có tham gia dự
-- án, sinh mã DTxxx và báo lại (`workspace.project_request.registered` hoặc
-- `.rejected`). Mỗi lần trạng thái đơn đổi, trigger dưới đây phát
-- `hrm.project_request.updated`.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS hrm_schema.request_project_links (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL,
    request_kind         varchar(40) NOT NULL,
    request_id           uuid NOT NULL,
    project_id           uuid NOT NULL,
    -- Bản sao để hiển thị; Workspace gửi lại giá trị chuẩn khi đăng ký xong.
    project_code         varchar(100),
    project_name         varchar(255),
    requester_user_id    uuid NOT NULL,
    requester_name       varchar(255),
    request_type_label   varchar(120) NOT NULL,
    status               varchar(20) NOT NULL DEFAULT 'REGISTERING',
    project_request_id   uuid,
    project_request_code varchar(20),
    rejection_reason     text,
    -- Tăng mỗi lần phát trạng thái: Workspace bỏ qua sự kiện cũ hơn bản đã có.
    status_version       integer NOT NULL DEFAULT 0,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_request_project_links_status
        CHECK (status IN ('REGISTERING', 'REGISTERED', 'REJECTED')),
    UNIQUE (tenant_id, request_kind, request_id)
);

CREATE INDEX IF NOT EXISTS idx_request_project_links_project
    ON hrm_schema.request_project_links (tenant_id, project_id);

-- ---------------------------------------------------------------------------
-- Phát trạng thái hiện tại của một đơn đã đăng ký sang Workspace.
-- Dùng chung cho trigger và cho lúc vừa nhận mã DT (đơn có thể đã đổi trạng
-- thái trong lúc chờ đăng ký).
-- ---------------------------------------------------------------------------
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
BEGIN
    UPDATE hrm_schema.request_project_links
       SET status_version = status_version + 1, updated_at = now()
     WHERE tenant_id = p_tenant_id AND request_kind = p_request_kind
       AND request_id = p_request_id AND status = 'REGISTERED'
    RETURNING status_version INTO v_version;
    -- Chưa đăng ký (đang chờ hoặc bị từ chối) thì Workspace chưa có đơn để cập nhật.
    IF v_version IS NULL THEN
        RETURN;
    END IF;

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
                'status', p_status,
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

-- Trigger trên bảng đơn: bắt mọi chỗ đổi trạng thái (duyệt, từ chối, huỷ, rút,
-- đảo duyệt, kết quả quy trình) và lúc gắn hồ sơ quy trình, kể cả chỗ viết sau này.
CREATE OR REPLACE FUNCTION hrm_schema.record_project_request_update() RETURNS trigger AS $$
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.procedure_instance_id IS NOT DISTINCT FROM OLD.procedure_instance_id THEN
        RETURN NEW;
    END IF;
    PERFORM hrm_schema.emit_project_request_update(
        NEW.tenant_id, TG_ARGV[0], NEW.id, NEW.status::text, NEW.procedure_instance_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_table record;
BEGIN
    FOR v_table IN
        SELECT * FROM (VALUES
            ('leave_requests', 'leave'),
            ('ot_requests', 'ot'),
            ('business_trip_requests', 'business_trip'),
            ('shift_change_requests', 'shift_change'),
            ('attendance_corrections', 'correction'),
            ('salary_advance_requests', 'advance'),
            ('profile_corrections', 'profile_correction')
        ) AS t(table_name, request_kind)
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_project_request_update ON hrm_schema.%I', v_table.table_name);
        EXECUTE format(
            'CREATE TRIGGER trg_project_request_update AFTER UPDATE OF status, procedure_instance_id
               ON hrm_schema.%I FOR EACH ROW EXECUTE FUNCTION hrm_schema.record_project_request_update(%L)',
            v_table.table_name, v_table.request_kind);
    END LOOP;
END $$;
