-- Đảm bảo cột head_position_id đã sẵn sàng trước khi ánh xạ
ALTER TABLE core_schema.organization_nodes
  ADD COLUMN IF NOT EXISTS head_position_id uuid
  REFERENCES core_schema.organization_nodes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organization_nodes_head_position_idx
  ON core_schema.organization_nodes (head_position_id)
  WHERE deleted_at IS NULL;

-- Chuyển đổi các phân vai RACI cũ từ cấp đơn vị (organization_unit) sang chức danh Quản lý (position)
-- Căn cứ theo head_position_id của đơn vị trong core_schema.organization_nodes.

UPDATE procedure_schema.raci_assignments a
SET subject_type = 'position',
    subject_id = n.head_position_id
FROM core_schema.organization_nodes n
WHERE a.subject_type = 'organization_unit'
  AND a.subject_id = n.id
  AND n.head_position_id IS NOT NULL;

-- Với những đơn vị chưa cấu hình head_position_id, gán tạm vào chức danh đầu tiên trực thuộc đơn vị đó
UPDATE procedure_schema.raci_assignments a
SET subject_type = 'position',
    subject_id = sub.first_pos_id
FROM (
  SELECT parent_id AS unit_id, id AS first_pos_id,
         ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY sort_order, name) AS rn
  FROM core_schema.organization_nodes
  WHERE category = 'position' AND deleted_at IS NULL
) sub
WHERE a.subject_type = 'organization_unit'
  AND a.subject_id = sub.unit_id
  AND sub.rn = 1;
