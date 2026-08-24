ALTER TABLE core_schema.organization_trees
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE core_schema.organization_node_types
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE core_schema.organization_nodes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE core_schema.organization_node_assignments
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS organization_trees_one_primary_active_idx
  ON core_schema.organization_trees ((is_primary))
  WHERE is_primary = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_nodes_tree_parent_idx
  ON core_schema.organization_nodes (tree_id, parent_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_nodes_type_idx
  ON core_schema.organization_nodes (node_type_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_assignments_node_status_idx
  ON core_schema.organization_node_assignments (node_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS organization_assignments_user_status_idx
  ON core_schema.organization_node_assignments (user_id, status)
  WHERE deleted_at IS NULL;
