SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Tần suất bảo trì nay do admin định nghĩa trong cấu hình module
-- (`maintenance_schema.module_settings`, khoá `catalog.frequency`), nên danh sách
-- hợp lệ không còn cố định và CHECK cứng năm giá trị sẽ chặn mọi tần suất tự thêm.
--
-- Bỏ ràng buộc chứ không thay bằng FK sang bảng danh mục: lịch đang chạy phải
-- tiếp tục chạy kể cả khi admin xoá một tần suất khỏi danh mục. Tính hợp lệ được
-- kiểm ở tầng ứng dụng lúc tạo/sửa lịch, còn ngày đến hạn kế tiếp lấy theo
-- interval đã lưu trong danh mục.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
   WHERE nsp.nspname = 'maintenance_schema'
     AND rel.relname = 'schedules'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) ILIKE '%frequency%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE maintenance_schema.schedules DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;
