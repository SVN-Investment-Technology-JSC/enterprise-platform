SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- ĐƠN TỪ CỦA DỰ ÁN
--
-- Đơn do module khác (hiện là HRM) gửi kèm một dự án — ví dụ đơn công tác cho
-- dự án EVN. Workspace không đọc hay ghi bảng của HRM: nó nhận sự kiện
-- `hrm.project_request.*`, tự kiểm người gửi có tham gia dự án, tự sinh mã
-- DTxxx theo từng dự án và báo lại qua sự kiện `workspace.project_request.*`.
--
-- Đơn từ không phải công việc: không tính tiến độ, không vào cây WBS.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.project_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    -- DT001, DT002… tăng dần theo từng dự án; đơn mới luôn nhận mã mới.
    code                    VARCHAR(20) NOT NULL,
    -- Nguồn của đơn: module gửi, loại đơn, id đơn bên module đó.
    source_module           VARCHAR(40) NOT NULL,
    source_kind             VARCHAR(40) NOT NULL,
    source_id               UUID NOT NULL,
    request_type_label      VARCHAR(120) NOT NULL,
    requester_user_id       UUID NOT NULL,
    requester_name          VARCHAR(255),
    from_date               DATE,
    to_date                 DATE,
    status                  VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    -- Phiên bản trạng thái bên nguồn: sự kiện đến trễ hay lặp lại không được
    -- ghi đè trạng thái mới hơn.
    source_version          INTEGER NOT NULL DEFAULT 0,
    procedure_instance_id   UUID,
    procedure_instance_code VARCHAR(100),
    -- Đường mở đơn ở module gốc; lấy từ sự kiện, không tự ghép.
    launch_url              VARCHAR(500),
    submitted_at            TIMESTAMPTZ NOT NULL,
    status_changed_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_project_requests_status
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    UNIQUE (project_id, code),
    -- Một đơn bên nguồn chỉ đăng ký một lần: nhận lại sự kiện không sinh mã thứ hai.
    UNIQUE (source_module, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_project_requests_project
    ON workspace_schema.project_requests (project_id, submitted_at DESC);
