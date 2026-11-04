-- Migration: 0022-trade-category-usage.sql
-- Description: Trang Hàng hóa cho phép khai báo "phân loại" và "sử dụng" của mặt hàng ở Cài đặt.
-- - trade_category: phân loại (nhóm riêng cho hàng hóa, nhóm riêng cho dịch vụ), chuỗi tự do lấy từ danh mục trong Cài đặt.
-- - trade_mode: trước chỉ nhận 4 mã cố định; nay là chuỗi tự do (Chỉ bán, Chỉ tặng, Đi kèm combo...) nên gỡ CHECK và nới độ dài.
-- Dòng cũ giữ nguyên (mã cũ như SALE_ONLY vẫn hiển thị đúng ở giao diện); cột mới tùy chọn nên bản app cũ vẫn ghi bình thường.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Gỡ mọi CHECK đang ràng buộc trade_mode, không phụ thuộc tên do Postgres tự đặt.
DO $$
DECLARE
    constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
          JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
         WHERE nsp.nspname = 'inventory_schema'
           AND rel.relname = 'materials'
           AND con.contype = 'c'
           AND att.attname = 'trade_mode'
    LOOP
        EXECUTE format('ALTER TABLE inventory_schema.materials DROP CONSTRAINT %I', constraint_row.conname);
    END LOOP;
END $$;

ALTER TABLE inventory_schema.materials
    ALTER COLUMN trade_mode TYPE VARCHAR(100),
    ADD COLUMN IF NOT EXISTS trade_category VARCHAR(100);
