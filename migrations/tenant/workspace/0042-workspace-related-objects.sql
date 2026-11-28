-- Đối tượng liên quan: con trỏ do người dùng gắn từ dự án hoặc công việc sang hồ sơ của module khác (báo giá, hợp đồng...).
-- Bảng riêng, KHÔNG dùng chung external_references: bảng đó là con trỏ hệ thống tới hồ sơ Quy trình của công việc, và code
-- quy trình dựa vào nó để quyết định (không mở quy trình hai lần...). Tách bảng nên không đụng logic cũ, bản app cũ bỏ qua.
--  · Chỉ lưu con trỏ và nhãn hiển thị (mã + tên ngắn, không số tiền); module gốc sở hữu nội dung.
--  · Gỡ liên kết là xoá cứng dòng này, không tác động hồ sơ gốc.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS workspace_schema.related_objects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(16) NOT NULL CHECK (entity_type IN ('project', 'work_item')),
    entity_id   UUID NOT NULL,
    project_id  UUID NOT NULL REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    kind        VARCHAR(64) NOT NULL,
    module_key  VARCHAR(64) NOT NULL,
    -- Tên loại và module lúc gắn, để vẫn hiện đúng tên khi module đó bị tắt.
    kind_label  VARCHAR(100),
    module_label VARCHAR(100),
    object_id   VARCHAR(160) NOT NULL,
    object_code VARCHAR(100),
    label       VARCHAR(255) NOT NULL,
    status      VARCHAR(64),
    launch_url  VARCHAR(255) NOT NULL,
    created_by  UUID NOT NULL,
    created_by_name VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entity_type, entity_id, kind, object_id)
);

CREATE INDEX IF NOT EXISTS idx_related_objects_project ON workspace_schema.related_objects (project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_related_objects_entity ON workspace_schema.related_objects (entity_type, entity_id);

-- Xoá công việc thì liên kết của nó đi theo (entity_id trỏ động nên không có khoá ngoại).
CREATE OR REPLACE FUNCTION workspace_schema.related_objects_cleanup_work_item() RETURNS trigger AS $$
BEGIN
    DELETE FROM workspace_schema.related_objects WHERE entity_type = 'work_item' AND entity_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_related_objects_cleanup_work_item ON workspace_schema.work_items;
CREATE TRIGGER trg_related_objects_cleanup_work_item
    AFTER DELETE ON workspace_schema.work_items
    FOR EACH ROW EXECUTE FUNCTION workspace_schema.related_objects_cleanup_work_item();
