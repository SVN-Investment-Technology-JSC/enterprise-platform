-- Quan hệ "Báo cáo cho" giữa các CHỨC DANH, để suy ra quản lý trực tiếp.
--
-- Đặt trên chức danh chứ không trên người: người đổi, chức danh thì ở lại, nên
-- quy trình trỏ "quản lý trực tiếp của người khởi tạo" không phải cấu hình lại
-- mỗi lần có biến động nhân sự. Admin gán tay; màn Quản lý chức danh gợi ý sẵn
-- từ cây đơn vị (chức danh trưởng của đơn vị / đơn vị cha).
ALTER TABLE core_schema.organization_nodes
  ADD COLUMN IF NOT EXISTS reports_to_position_id uuid
  REFERENCES core_schema.organization_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organization_nodes_reports_to_idx
  ON core_schema.organization_nodes (reports_to_position_id)
  WHERE deleted_at IS NULL;

-- Ô ghi đè cho từng phân công (người + chức danh): một người kiêm nhiều chức
-- danh có thể báo cáo cho những người khác nhau ở mỗi chức danh. Cũng trỏ vào
-- CHỨC DANH, không trỏ vào người.
ALTER TABLE core_schema.organization_node_assignments
  ADD COLUMN IF NOT EXISTS reports_to_position_override_id uuid
  REFERENCES core_schema.organization_nodes(id) ON DELETE SET NULL;
