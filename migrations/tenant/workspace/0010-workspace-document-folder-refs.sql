SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- THAM CHIẾU TÀI LIỆU VÀO THƯ MỤC
--
-- Mỗi tài liệu vẫn có đúng MỘT thư mục gốc (`documents.folder_id`): nơi quyết
-- định tên duy nhất và hàng rào quyền. Bảng này cho tài liệu hiện thêm ở các
-- thư mục khác mà KHÔNG nhân bản tệp — mở thư mục nào có tham chiếu thì thấy
-- đúng tài liệu đó, cùng phiên bản, cùng khoá.
--
-- Người xem vẫn phải thấy được tài liệu gốc; tầng ứng dụng lọc lại theo quyền
-- của dự án chứa tài liệu, không theo dự án của thư mục tham chiếu.
--
-- Gỡ thư mục (`is_active = false`) thì tầng ứng dụng xoá các tham chiếu trong
-- nó; CASCADE ở đây chỉ phòng trường hợp dòng thư mục bị xoá cứng.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.document_folder_refs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES workspace_schema.documents(id) ON DELETE CASCADE,
    folder_id   UUID NOT NULL REFERENCES workspace_schema.document_folders(id) ON DELETE CASCADE,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, folder_id)
);

-- Mở một thư mục: tìm mọi tài liệu tham chiếu tới nó.
CREATE INDEX IF NOT EXISTS idx_doc_folder_refs_folder
    ON workspace_schema.document_folder_refs (folder_id);
