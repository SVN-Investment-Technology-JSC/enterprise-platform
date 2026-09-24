-- Thêm cột category trực tiếp vào organization_nodes
ALTER TABLE core_schema.organization_nodes
  ADD COLUMN IF NOT EXISTS category varchar(32) NOT NULL DEFAULT 'unit'
  CHECK (category IN ('unit', 'position'));

-- Đồng bộ category từ organization_node_types cho các node hiện hữu
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'core_schema' AND table_name = 'organization_node_types'
  ) THEN
    UPDATE core_schema.organization_nodes n
    SET category = t.category
    FROM core_schema.organization_node_types t
    WHERE n.node_type_id = t.id AND (n.category IS NULL OR n.category = 'unit');
  END IF;
END $$;

-- Cho phép node_type_id null để không bắt buộc phải có loại node
ALTER TABLE core_schema.organization_nodes
  ALTER COLUMN node_type_id DROP NOT NULL;

-- Tạo index cho category
CREATE INDEX IF NOT EXISTS organization_nodes_category_idx
  ON core_schema.organization_nodes (category)
  WHERE deleted_at IS NULL;
