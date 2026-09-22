-- Thêm cột head_position_id vào organization_nodes để đơn vị chọn chức danh quản lý chính
ALTER TABLE core_schema.organization_nodes
  ADD COLUMN IF NOT EXISTS head_position_id uuid
  REFERENCES core_schema.organization_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organization_nodes_head_position_idx
  ON core_schema.organization_nodes (head_position_id)
  WHERE deleted_at IS NULL;
