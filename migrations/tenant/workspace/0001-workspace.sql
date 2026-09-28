SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS workspace_schema;

-- ===========================================================================
-- DỰ ÁN
--
-- Gốc phân quyền của cả module: mọi truy vấn đều phải đi qua project_members
-- để biết người dùng có được chạm vào dữ liệu này không.
--
-- Không có cột tenant_id: mỗi tenant là một database riêng, nên danh tính
-- tenant nằm ở kết nối chứ không nằm trong dữ liệu.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.projects (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                   VARCHAR(100) NOT NULL UNIQUE,
    name                   VARCHAR(180) NOT NULL,
    description            TEXT,
    status                 VARCHAR(32) NOT NULL DEFAULT 'planning'
                             CHECK (status IN ('planning','active','on_hold','completed','cancelled')),
    owner_user_id          UUID NOT NULL,
    -- Trỏ sang core_schema.organization_nodes nhưng KHÔNG đặt khoá ngoại:
    -- giữ ranh giới module, đúng như Inventory và Maintenance đang làm.
    org_unit_id            UUID,
    -- Mã khách hàng bên CRM. Chỉ là con trỏ hiển thị, không sao chép hồ sơ.
    customer_ref           VARCHAR(160),
    start_date             DATE,
    end_date               DATE,
    -- Giá trị dẫn xuất, tính lại từ các công việc lá. Không cho nhập tay.
    progress_percent       SMALLINT NOT NULL DEFAULT 0
                             CHECK (progress_percent BETWEEN 0 AND 100),

    -- --- Tài chính (mục 20 của đặc tả) -------------------------------------
    -- Đơn vị VND. numeric(18,2) vì giá trị hợp đồng cỡ hàng chục tỷ.
    -- Chi phí thực tế và chi phí dự kiến KHÔNG lưu ở đây: chúng được tính
    -- bằng SUM trên work_items, tránh có hai nguồn sự thật phải đồng bộ.
    contract_value         NUMERIC(18,2) CHECK (contract_value >= 0),
    budget                 NUMERIC(18,2) CHECK (budget >= 0),
    committed_cost         NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (committed_cost >= 0),
    forecast_cost_override NUMERIC(18,2) CHECK (forecast_cost_override >= 0),

    metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by             UUID NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_projects_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_projects_status ON workspace_schema.projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON workspace_schema.projects (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_org_unit ON workspace_schema.projects (org_unit_id);

-- ===========================================================================
-- THÀNH VIÊN DỰ ÁN
--
-- Nguồn phân quyền chi tiết thật sự. Quyền nền tảng chỉ quyết định được làm
-- LOẠI thao tác gì; bảng này quyết định được làm trên DỮ LIỆU nào.
--
-- Quy tắc "mỗi dự án đúng một owner" không biểu diễn được bằng ràng buộc SQL
-- vì nó là bất biến trên nhiều dòng; tầng application giữ.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.project_members (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    role       VARCHAR(32) NOT NULL CHECK (role IN ('owner','manager','member','viewer')),
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, user_id)
);

-- Nuôi truy vấn "những dự án tôi tham gia", chạy ở mọi màn hình.
CREATE INDEX IF NOT EXISTS idx_project_members_user ON workspace_schema.project_members (user_id);

-- ===========================================================================
-- CÔNG VIỆC
--
-- Cây phân cấp bằng parent_id tự tham chiếu, tối đa 10 cấp (depth 0..9).
-- Cột depth là giá trị dẫn xuất nhưng được lưu, để chặn cây quá sâu bằng
-- ràng buộc CHECK thay vì phải truy vấn đệ quy ở mỗi lần ghi.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.work_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    parent_id         UUID REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    code              VARCHAR(100) NOT NULL,
    title             VARCHAR(200) NOT NULL,
    description       TEXT,

    item_type         VARCHAR(32) NOT NULL DEFAULT 'task'
                        CHECK (item_type IN ('phase','task','milestone')),
    -- Việc chạy theo quy trình được mở thành hồ sơ bên module Quy trình.
    -- Lời gọi tạo hồ sơ do TRÌNH DUYỆT thực hiện bằng phiên của chính người
    -- dùng; server của Workspace không bao giờ ghi sang module khác.
    execution_type    VARCHAR(16) NOT NULL DEFAULT 'manual'
                        CHECK (execution_type IN ('manual','procedure')),
    status            VARCHAR(32) NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo','in_progress','blocked','review','done','cancelled')),
    priority          VARCHAR(16) NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high','urgent')),

    assignee_user_id  UUID,
    planned_start     DATE,
    planned_end       DATE,
    actual_start      DATE,
    actual_end        DATE,

    -- Số liệu lập kế hoạch, đồng thời là trọng số khi cuộn tiến độ lên cấp
    -- cha. Không phải chấm công: chấm công thuộc module khác.
    estimate_hours    NUMERIC(7,2) CHECK (estimate_hours > 0),
    estimated_cost    NUMERIC(18,2) CHECK (estimated_cost >= 0),
    actual_cost       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (actual_cost >= 0),

    progress_percent  SMALLINT NOT NULL DEFAULT 0
                        CHECK (progress_percent BETWEEN 0 AND 100),
    sort_order        INTEGER NOT NULL DEFAULT 0,
    depth             SMALLINT NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 9),

    created_by        UUID NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, code),
    CONSTRAINT chk_work_items_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
    CONSTRAINT chk_work_items_planned_dates
        CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
    CONSTRAINT chk_work_items_actual_dates
        CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start)
);

CREATE INDEX IF NOT EXISTS idx_work_items_project_status
    ON workspace_schema.work_items (project_id, status);
-- Index quyết định hiệu năng của màn "Công việc của tôi" và báo cáo tải việc.
CREATE INDEX IF NOT EXISTS idx_work_items_assignee
    ON workspace_schema.work_items (assignee_user_id, status, planned_end);
CREATE INDEX IF NOT EXISTS idx_work_items_parent
    ON workspace_schema.work_items (parent_id, sort_order);

-- ===========================================================================
-- PHỤ THUỘC GIỮA CÔNG VIỆC
--
-- project_id lưu dư có chủ đích: khoá ngoại đơn lẻ không kiểm được rằng hai
-- đầu thuộc cùng một dự án, còn lọc theo dự án thì chạy liên tục.
-- Đồ thị phải là DAG; kiểm chu trình ở tầng application trước khi ghi.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.work_item_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    predecessor_id  UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    successor_id    UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    -- Chỉ FS chặn cứng việc hoàn thành; ba loại còn lại chỉ cảnh báo về lịch.
    dependency_type VARCHAR(4) NOT NULL DEFAULT 'FS'
                      CHECK (dependency_type IN ('FS','SS','FF','SF')),
    lag_days        SMALLINT NOT NULL DEFAULT 0,
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (predecessor_id, successor_id),
    CONSTRAINT chk_dependency_not_self CHECK (predecessor_id <> successor_id)
);

CREATE INDEX IF NOT EXISTS idx_dependencies_successor
    ON workspace_schema.work_item_dependencies (successor_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_project
    ON workspace_schema.work_item_dependencies (project_id);

-- ===========================================================================
-- NHẬT KÝ CHUYỂN TRẠNG THÁI
--
-- Bảng chỉ ghi thêm: không sửa, không xoá. Nuôi tab Hoạt động và cho phép
-- truy vết ai đổi trạng thái lúc nào.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.work_item_status_history (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    project_id   UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    -- Rỗng ở lần ghi đầu tiên, khi công việc vừa được tạo.
    from_status  VARCHAR(32),
    to_status    VARCHAR(32) NOT NULL,
    note         TEXT,
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_item
    ON workspace_schema.work_item_status_history (work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_status_history_project
    ON workspace_schema.work_item_status_history (project_id, created_at DESC);
