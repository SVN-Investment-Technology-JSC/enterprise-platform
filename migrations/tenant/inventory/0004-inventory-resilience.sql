-- 0004-inventory-resilience.sql
ALTER TABLE inventory_schema.stock_transactions ALTER COLUMN transaction_code TYPE varchar(100);
ALTER TABLE inventory_schema.stock_receipts ADD COLUMN IF NOT EXISTS source_origin text;
