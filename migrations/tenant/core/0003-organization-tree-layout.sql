ALTER TABLE core_schema.organization_trees
  ADD COLUMN IF NOT EXISTS layout jsonb NOT NULL
  DEFAULT '{"version":1,"positions":{}}'::jsonb;
