-- 0021: Core tự gắn `employee_id` cho bổ nhiệm (trước đây HRM làm ở org-hrm-bridge, tác vụ E-01, tức HRM ghi vào
-- core_schema). `employee_id` suy ra được hoàn toàn từ dữ liệu của Core: bổ nhiệm có `user_id`, dòng liên kết
-- `core_schema.employees` có `user_id` (duy nhất trong tenant), nên Core giữ đồng bộ bằng trigger, không cần sự kiện.
--   1. Bổ nhiệm mới hoặc đổi người (`user_id`) mà chưa có `employee_id`: điền từ dòng liên kết còn hiệu lực.
--   2. Dòng liên kết được tạo hoặc gắn tài khoản sau khi đã có bổ nhiệm: điền cho các bổ nhiệm còn thiếu của tài khoản
--      đó (trigger `trg_core_assignment_event` ghi `core.org.assignment.updated` như khi HRM cập nhật trước đây).
--   3. Bù dữ liệu hiện có (giống 0007), chỉ điền chỗ còn trống. Không bao giờ ghi đè `employee_id` đã có.
-- Chạy lại được: CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS, UPDATE chỉ đụng dòng còn NULL.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION core_schema.fill_assignment_employee_id() RETURNS trigger AS $$
BEGIN
  IF NEW.employee_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT e.id INTO NEW.employee_id
      FROM core_schema.employees e
     WHERE e.user_id = NEW.user_id
       AND e.deleted_at IS NULL
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_core_assignment_fill_employee ON core_schema.organization_node_assignments;
CREATE TRIGGER trg_core_assignment_fill_employee
  BEFORE INSERT OR UPDATE OF user_id, employee_id
  ON core_schema.organization_node_assignments
  FOR EACH ROW EXECUTE FUNCTION core_schema.fill_assignment_employee_id();

CREATE OR REPLACE FUNCTION core_schema.link_employee_assignments() RETURNS trigger AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    UPDATE core_schema.organization_node_assignments a
       SET employee_id = NEW.id, updated_at = now()
     WHERE a.user_id = NEW.user_id
       AND a.employee_id IS NULL
       AND a.deleted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_core_employee_link_assignments ON core_schema.employees;
CREATE TRIGGER trg_core_employee_link_assignments
  AFTER INSERT OR UPDATE OF user_id, deleted_at
  ON core_schema.employees
  FOR EACH ROW EXECUTE FUNCTION core_schema.link_employee_assignments();

UPDATE core_schema.organization_node_assignments a
   SET employee_id = e.id, updated_at = now()
  FROM core_schema.employees e
 WHERE e.user_id = a.user_id
   AND e.deleted_at IS NULL
   AND a.employee_id IS NULL
   AND a.deleted_at IS NULL;
