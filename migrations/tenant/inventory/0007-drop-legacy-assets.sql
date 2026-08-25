SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Xoá bảng `assets_legacy` — bản sao còn giữ từ lượt gộp 0006.
--
-- CỐ Ý ĐỂ RIÊNG một migration và CHƯA ĐƯỢC ĐĂNG KÝ trong apps/migrator: dữ liệu
-- đã nằm trong bảng gộp và mọi truy vấn đã đi qua VIEW `assets`, nhưng bảng cũ
-- là đường lui duy nhất nếu phát hiện sai sót sau khi chạy thật.
--
-- Chỉ đăng ký migration này sau khi bản gộp đã chạy ổn định qua một chu kỳ vận
-- hành. Trước khi xoá, đối chiếu lại:
--   SELECT count(*) FROM inventory_schema.assets_legacy;   -- bản cũ
--   SELECT count(*) FROM inventory_schema.materials WHERE kind = 'ASSET';
-- Hai số phải bằng nhau, và mọi mã bên cũ phải có mặt bên mới.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(l.code, ', ') INTO missing
    FROM inventory_schema.assets_legacy l
   WHERE NOT EXISTS (
     SELECT 1 FROM inventory_schema.materials m
      WHERE m.id = l.id AND m.kind = 'ASSET'
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Chưa xoá được bảng cũ: các thiết bị sau chưa có trong bảng gộp: %', missing;
  END IF;
END $$;

DROP TABLE IF EXISTS inventory_schema.assets_legacy;
