SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- TÊN THƯ MỤC DUY NHẤT — KỂ CẢ Ở CẤP GỐC VÀ KHO DÙNG CHUNG
--
-- `0002` khai báo `UNIQUE (project_id, parent_id, name)`. Postgres mặc định
-- coi các NULL là KHÁC nhau, nên ràng buộc đó không có tác dụng ở cấp gốc
-- (`parent_id` NULL) và ở kho dùng chung (`project_id` NULL): hai thư mục
-- "Hợp đồng" cùng cấp gốc vẫn tạo được. `NULLS NOT DISTINCT` (Postgres 15+)
-- coi các NULL là bằng nhau.
--
-- Không sửa `0002`: tệp đã chạy bị khoá bằng checksum.
-- ===========================================================================

-- Tenant đã lỡ có thư mục trùng tên thì tạo index sẽ hỏng. Giữ nguyên bản cũ
-- nhất, đổi tên các bản sau thành "Tên (2)", "Tên (3)"… — không xoá gì.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY project_id, parent_id, name
           ORDER BY created_at, id
         ) AS n
    FROM workspace_schema.document_folders
)
UPDATE workspace_schema.document_folders f
   SET name = left(f.name, 170) || ' (' || ranked.n || ')',
       updated_at = now()
  FROM ranked
 WHERE ranked.id = f.id
   AND ranked.n > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_document_folders_scope_name
    ON workspace_schema.document_folders (project_id, parent_id, name) NULLS NOT DISTINCT;
