SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- VAI TRÒ TRONG DỰ ÁN (tenant tự định nghĩa)
--
-- Bốn vai hệ thống giữ nguyên khoá cũ (owner, manager, member, viewer) để
-- dữ liệu thành viên hiện có không phải chuyển đổi. Tenant thêm được vai mới
-- và chọn quyền cho từng vai; cột `role` của project_members trỏ vào `key`.
--
-- Không đặt khoá ngoại từ project_members.role sang bảng này: xoá vai đang có
-- người giữ bị chặn ở tầng application, kèm thông báo rõ ràng.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.project_role_definitions (
    key         VARCHAR(32) PRIMARY KEY,
    name        VARCHAR(80) NOT NULL,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_system   BOOLEAN NOT NULL DEFAULT false,
    sort_order  INTEGER NOT NULL DEFAULT 100,
    created_by  UUID,
    updated_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quyền mặc định giữ đúng hành vi trước khi có bảng này.
INSERT INTO workspace_schema.project_role_definitions (key, name, permissions, is_system, sort_order)
VALUES
  ('owner', 'Chủ nhiệm', ARRAY[
     'project.view_all','project.view_related','project.update_all','project.update_related',
     'work_item.cancel','work_item.delete','project.update_status','project.manage_members'
   ], true, 0),
  ('manager', 'Quản lý', ARRAY[
     'project.view_all','project.view_related','project.update_all','project.update_related',
     'work_item.cancel','project.update_status','project.manage_members'
   ], true, 1),
  ('member', 'Thành viên', ARRAY[
     'project.view_all','project.view_related','project.update_related','work_item.cancel'
   ], true, 2),
  ('viewer', 'Người xem', ARRAY['project.view_all','project.view_related'], true, 3)
ON CONFLICT (key) DO NOTHING;

-- Vai trò thành viên không còn bó trong bốn giá trị cố định.
ALTER TABLE workspace_schema.project_members
    DROP CONSTRAINT IF EXISTS project_members_role_check;

-- ===========================================================================
-- NGÀY CẬP NHẬT TRẠNG THÁI CUỐI CỦA CÔNG VIỆC
--
-- Lưu thẳng trên công việc (trigger giữ) thay vì tra lịch sử mỗi lần đọc cây.
-- ===========================================================================
ALTER TABLE workspace_schema.work_items
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

UPDATE workspace_schema.work_items w
   SET status_changed_at = COALESCE(
         (SELECT max(h.created_at)
            FROM workspace_schema.work_item_status_history h
           WHERE h.work_item_id = w.id),
         w.created_at)
 WHERE w.status_changed_at IS NULL;

ALTER TABLE workspace_schema.work_items
    ALTER COLUMN status_changed_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION workspace_schema.touch_work_item_status_changed_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_items_status_changed_at ON workspace_schema.work_items;
CREATE TRIGGER trg_work_items_status_changed_at
    BEFORE UPDATE OF status ON workspace_schema.work_items
    FOR EACH ROW
    EXECUTE FUNCTION workspace_schema.touch_work_item_status_changed_at();
