DO $drop_check$
BEGIN
  IF to_regclass('amm_schema.amm_assets') IS NOT NULL THEN
    ALTER TABLE amm_schema.amm_assets DROP CONSTRAINT IF EXISTS amm_assets_type_check;
  END IF;
END
$drop_check$;
