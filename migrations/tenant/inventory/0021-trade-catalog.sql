-- Migration: 0021-trade-catalog.sql
-- Description: Trang quản lý hàng hóa kinh doanh cần hình thức kinh doanh, giá bán, ngày tạo và người tạo.
-- Các cột đều tùy chọn: dòng cũ để NULL (created_at của dòng cũ lấy thời điểm chạy migration, không phải ngày tạo thật),
-- bản app cũ vẫn ghi danh mục bình thường.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE inventory_schema.materials
    ADD COLUMN IF NOT EXISTS trade_mode VARCHAR(20)
        CHECK (trade_mode IN ('SALE_ONLY', 'GIFT_ONLY', 'INTERNAL_ONLY', 'MULTI')),
    ADD COLUMN IF NOT EXISTS sale_price NUMERIC(18,2) CHECK (sale_price IS NULL OR sale_price >= 0),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(255);
