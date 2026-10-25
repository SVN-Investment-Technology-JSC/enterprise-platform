SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- MẠNG NỘI BỘ: MỞ RỘNG LOẠI PHẢN ỨNG TỪ 4 LÊN 8
--
-- Thêm 'haha', 'wow', 'sad', 'angry' vào ràng buộc CHECK của post_reactions và comment_reactions. Dữ liệu cũ vẫn
-- hợp lệ (tập mới là tập cũ cộng thêm). Tên ràng buộc cũ được tra theo bảng và cột để gỡ, rồi tạo lại với tên cố
-- định; chạy lại không đổi gì thêm. Bản app cũ chỉ ghi 4 loại cũ nên vẫn chạy với schema mới.
-- ===========================================================================
DO $$
DECLARE
    target RECORD;
    existing RECORD;
BEGIN
    FOR target IN
        SELECT * FROM (VALUES
            ('post_reactions', 'post_reactions_type_check'),
            ('comment_reactions', 'comment_reactions_type_check')
        ) AS t(table_name, constraint_name)
    LOOP
        FOR existing IN
            SELECT c.conname
              FROM pg_constraint c
              JOIN pg_class r ON r.oid = c.conrelid
              JOIN pg_namespace n ON n.oid = r.relnamespace
              JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = ANY (c.conkey)
             WHERE n.nspname = 'social_schema'
               AND r.relname = target.table_name
               AND c.contype = 'c'
               AND a.attname = 'type'
        LOOP
            EXECUTE format('ALTER TABLE social_schema.%I DROP CONSTRAINT %I', target.table_name, existing.conname);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE social_schema.%I ADD CONSTRAINT %I CHECK (type IN (''like'', ''love'', ''haha'', ''wow'', ''sad'', ''angry'', ''celebrate'', ''insightful''))',
            target.table_name, target.constraint_name
        );
    END LOOP;
END $$;
