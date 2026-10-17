SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- CÔNG VIỆC NGOÀI DỰ ÁN (giao việc lẻ)
--
-- Một người giao việc cho bất kỳ ai trong tenant mà không cần dự án. Tách
-- hẳn khỏi `work_items`: bảng đó gắn chặt vào dự án (WBS, quyền theo thành
-- viên, tài chính, chat, báo cáo), cho `project_id` rỗng là thêm nhánh đặc
-- biệt vào mọi chỗ đó.
--
-- Trạng thái và mức ưu tiên dùng chung bộ giá trị với `work_items`. Khác biệt
-- duy nhất là quy trình duyệt: người thực hiện chỉ đưa việc tới `review`,
-- bước `done` do người giao (`created_by`) bấm — luật nằm ở tầng ứng dụng.
--
-- Không đưa vào trang Báo cáo; chỉ hiện ở trang "Công việc ngoài dự án" và
-- "Công việc của tôi".
--
-- Việc con: cùng bảng, nối bằng `parent_id`; `root_id` là việc gốc của cây để
-- kiểm quyền xem cả cây bằng một điều kiện. Chỉ việc gốc cần người giao duyệt;
-- việc con người thực hiện tự hoàn thành.
--
-- Theo quy trình: `execution_type = 'procedure'` — module Quy trình mở hồ sơ
-- khi nhận sự kiện; hồ sơ hoàn tất thì việc tự sang Chờ duyệt.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.standalone_tasks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id         UUID REFERENCES workspace_schema.standalone_tasks(id) ON DELETE CASCADE,
    -- Việc gốc của cây; việc gốc trỏ về chính nó.
    root_id           UUID NOT NULL,
    depth             SMALLINT NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 9),
    code              VARCHAR(32) NOT NULL UNIQUE,
    title             VARCHAR(200) NOT NULL,
    description       TEXT,
    status            VARCHAR(32) NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo','in_progress','blocked','review','done','cancelled')),
    priority          VARCHAR(16) NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high','urgent')),
    -- Người phụ trách chính. Bắt buộc: việc giao lẻ không có "chưa giao".
    assignee_user_id  UUID NOT NULL,
    planned_start     DATE,
    due_date          DATE,
    actual_start      DATE,
    actual_end        DATE,
    progress_percent  SMALLINT NOT NULL DEFAULT 0
                        CHECK (progress_percent BETWEEN 0 AND 100),
    -- Người giao: người duy nhất được sửa, duyệt hoàn thành, huỷ và xoá.
    created_by        UUID NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    execution_type    VARCHAR(16) NOT NULL DEFAULT 'manual'
                        CHECK (execution_type IN ('manual','procedure')),
    -- Chỉ có khi theo quy trình. `procedure_status` đi theo hồ sơ bên Quy trình:
    -- pending (đã nhờ mở) → started → completed | rejected | cancelled;
    -- `start_rejected` là Quy trình không mở được hồ sơ.
    procedure_definition_id UUID,
    procedure_status  VARCHAR(16)
                        CHECK (procedure_status IN ('pending','started','start_rejected','completed','rejected','cancelled')),
    procedure_instance_id   UUID,
    procedure_instance_code VARCHAR(80),
    procedure_error   TEXT,

    -- Huỷ hiệu lực: việc đã hoàn thành bị vô hiệu (status = 'cancelled' kèm
    -- các cột này). Không mở lại được, không xoá được — giữ vết.
    reversed_at       TIMESTAMPTZ,
    reversed_by       UUID,
    reversed_by_name  VARCHAR(180),
    reversal_reason   TEXT,
    -- Người huỷ có yêu cầu lập công việc điều chỉnh.
    adjustment_requested BOOLEAN NOT NULL DEFAULT false,
    -- Việc này là việc điều chỉnh của một việc đã huỷ hiệu lực.
    adjustment_of_id  UUID REFERENCES workspace_schema.standalone_tasks(id) ON DELETE SET NULL,

    CHECK (due_date IS NULL OR planned_start IS NULL OR due_date >= planned_start),
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK ((parent_id IS NULL) = (depth = 0)),
    CHECK (execution_type = 'manual' OR procedure_definition_id IS NOT NULL),
    CHECK (reversed_at IS NULL OR (status = 'cancelled' AND reversal_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_standalone_tasks_assignee
    ON workspace_schema.standalone_tasks (assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_standalone_tasks_creator
    ON workspace_schema.standalone_tasks (created_by, status);
CREATE INDEX IF NOT EXISTS idx_standalone_tasks_parent
    ON workspace_schema.standalone_tasks (parent_id);
CREATE INDEX IF NOT EXISTS idx_standalone_tasks_root
    ON workspace_schema.standalone_tasks (root_id);
-- Mỗi việc đã huỷ hiệu lực chỉ có một việc điều chỉnh còn hiệu lực.
CREATE UNIQUE INDEX IF NOT EXISTS standalone_tasks_one_open_adjustment
    ON workspace_schema.standalone_tasks (adjustment_of_id)
    WHERE adjustment_of_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_standalone_tasks_procedure_instance
    ON workspace_schema.standalone_tasks (procedure_instance_id)
    WHERE procedure_instance_id IS NOT NULL;

-- Người cùng thực hiện (`participant`) và người theo dõi (`follower`).
-- Một người chỉ giữ một vai trên một việc.
CREATE TABLE IF NOT EXISTS workspace_schema.standalone_task_members (
    task_id    UUID NOT NULL REFERENCES workspace_schema.standalone_tasks(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    role       VARCHAR(16) NOT NULL CHECK (role IN ('participant','follower')),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_standalone_task_members_user
    ON workspace_schema.standalone_task_members (user_id);

-- Nhật ký đổi trạng thái, kèm lý do khi trả lại hoặc huỷ.
CREATE TABLE IF NOT EXISTS workspace_schema.standalone_task_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES workspace_schema.standalone_tasks(id) ON DELETE CASCADE,
    from_status VARCHAR(32),
    to_status   VARCHAR(32) NOT NULL,
    note        TEXT,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standalone_task_history_task
    ON workspace_schema.standalone_task_history (task_id, created_at DESC);
