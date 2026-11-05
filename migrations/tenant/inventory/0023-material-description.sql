-- Migration: 0023-material-description.sql
-- Description: Mô tả, ghi chú cho mặt hàng (hàng hóa và dịch vụ), tùy chọn.
-- Cột mới cho phép NULL nên bản app cũ vẫn ghi bình thường; dòng cũ giữ nguyên.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS description TEXT;
