-- Phân công sinh ra từ một quyết định nhân sự của HRM.
--
-- HRM không ghi thẳng vào Core; nó gọi endpoint nội bộ và truyền mã quyết định.
-- Cột này vừa là dấu vết "phân công này theo quyết định nào", vừa là khóa
-- idempotent: gọi lại cùng quyết định (thử lại sau lỗi mạng) không tạo phân công
-- thứ hai.
ALTER TABLE core_schema.organization_node_assignments
  ADD COLUMN IF NOT EXISTS source_decision_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_assignments_source_decision
  ON core_schema.organization_node_assignments (source_decision_id)
  WHERE source_decision_id IS NOT NULL AND deleted_at IS NULL;
