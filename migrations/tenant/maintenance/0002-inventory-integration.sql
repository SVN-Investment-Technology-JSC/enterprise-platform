SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Remove asset hierarchy from maintenance (moved to inventory_schema)
-- Drop FK constraints first
ALTER TABLE maintenance_schema.schedules DROP CONSTRAINT IF EXISTS schedules_asset_id_fkey;

-- Rename asset_id to asset_code (now soft reference)
ALTER TABLE maintenance_schema.schedules RENAME COLUMN asset_id TO asset_code;
ALTER TABLE maintenance_schema.schedules ALTER COLUMN asset_code TYPE VARCHAR(80);

-- Drop job plan reference
ALTER TABLE maintenance_schema.schedules DROP CONSTRAINT IF EXISTS schedules_job_plan_id_fkey;
ALTER TABLE maintenance_schema.schedules DROP COLUMN IF EXISTS job_plan_id;

-- Remove job_plans and assets tables
DROP TABLE IF EXISTS maintenance_schema.job_plans CASCADE;
DROP TABLE IF EXISTS maintenance_schema.assets CASCADE;

-- Add priority field to schedules
ALTER TABLE maintenance_schema.schedules
  ADD COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'Normal'
  CHECK (priority IN ('High','Normal','Low'));

-- Add priority field to occurrences
ALTER TABLE maintenance_schema.occurrences
  ADD COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'Normal'
  CHECK (priority IN ('High','Normal','Low'));

-- Rename assetId to assetCode in occurrences (and update column type if needed)
ALTER TABLE maintenance_schema.occurrences RENAME COLUMN asset_id TO asset_code;
ALTER TABLE maintenance_schema.occurrences ALTER COLUMN asset_code TYPE VARCHAR(80);

-- Add idempotency_key to occurrences if not exists
ALTER TABLE maintenance_schema.occurrences
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180) UNIQUE;
