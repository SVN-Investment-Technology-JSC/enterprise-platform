SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Assets (Equipment Hierarchy) table
CREATE TABLE inventory_schema.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(80) NOT NULL UNIQUE,
    name VARCHAR(180) NOT NULL,
    asset_type VARCHAR(30) NOT NULL CHECK (asset_type IN ('company','site','system','equipment','part')),
    parent_id UUID REFERENCES inventory_schema.assets(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','retired')),
    health VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (health IN ('unknown','good','warning','critical')),
    location TEXT,
    manufacturer VARCHAR(180),
    organization_unit_id UUID,
    organization_unit_name VARCHAR(180),
    task_template JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX idx_inv_assets_parent ON inventory_schema.assets(parent_id);
CREATE INDEX idx_inv_assets_code ON inventory_schema.assets(code);
CREATE INDEX idx_inv_assets_type ON inventory_schema.assets(asset_type);
