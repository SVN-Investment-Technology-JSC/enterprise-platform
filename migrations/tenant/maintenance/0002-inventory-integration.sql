SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Remove asset hierarchy from maintenance (moved to inventory_schema)
-- Only proceed if schedules table exists and has asset_id column
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'maintenance_schema'
    AND table_name = 'schedules'
    AND column_name = 'asset_id'
  ) THEN
    -- Drop FK constraints first
    ALTER TABLE maintenance_schema.schedules DROP CONSTRAINT IF EXISTS schedules_asset_id_fkey;

    -- Rename asset_id to asset_code (now soft reference)
    ALTER TABLE maintenance_schema.schedules RENAME COLUMN asset_id TO asset_code;
    ALTER TABLE maintenance_schema.schedules ALTER COLUMN asset_code TYPE VARCHAR(80);
  END IF;
END $$;

-- Continue only if columns exist
DO $$ BEGIN
  -- Drop job plan reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'maintenance_schema'
    AND table_name = 'schedules'
    AND column_name = 'job_plan_id'
  ) THEN
    ALTER TABLE maintenance_schema.schedules DROP CONSTRAINT IF EXISTS schedules_job_plan_id_fkey;
    ALTER TABLE maintenance_schema.schedules DROP COLUMN IF EXISTS job_plan_id;
  END IF;

  -- Add priority field to schedules if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'maintenance_schema'
    AND table_name = 'schedules'
    AND column_name = 'priority'
  ) THEN
    ALTER TABLE maintenance_schema.schedules
      ADD COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'Normal'
      CHECK (priority IN ('High','Normal','Low'));
  END IF;

  -- Add priority field to occurrences if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'maintenance_schema'
    AND table_name = 'occurrences'
    AND column_name = 'priority'
  ) THEN
    ALTER TABLE maintenance_schema.occurrences
      ADD COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'Normal'
      CHECK (priority IN ('High','Normal','Low'));
  END IF;

END $$;

-- Remove job_plans and assets tables
DROP TABLE IF EXISTS maintenance_schema.job_plans CASCADE;
DROP TABLE IF EXISTS maintenance_schema.assets CASCADE;
