SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- CÂY THƯ MỤC
--
-- Tối đa 5 cấp (depth 0..4). `depth` là giá trị dẫn xuất nhưng được lưu, để
-- chặn cây quá sâu bằng CHECK thay vì truy vấn đệ quy ở mỗi lần ghi.
--
-- `project_id` rỗng nghĩa là thư mục cấp đơn vị, chỉ `workspace.manage` được
-- tạo. Thư mục có dự án thì mượn hàng rào thành viên của dự án đó.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.document_folders (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    -- RESTRICT chứ không CASCADE: xoá nhầm một thư mục gốc mà kéo theo cả
    -- nhánh tài liệu bên dưới là mất mát không lấy lại được.
    parent_id  UUID REFERENCES workspace_schema.document_folders(id) ON DELETE RESTRICT,
    name       VARCHAR(180) NOT NULL,
    depth      SMALLINT NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 4),
    -- Ẩn thay cho xoá. Tầng ứng dụng chặn ẩn khi còn tài liệu `active`.
    is_active  BOOLEAN NOT NULL DEFAULT true,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, parent_id, name),
    CONSTRAINT chk_doc_folders_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_doc_folders_project
    ON workspace_schema.document_folders (project_id, parent_id);

-- ===========================================================================
-- HỒ SƠ TÀI LIỆU
--
-- Một dòng ở đây là MỘT TÀI LIỆU LOGIC, không phải một tệp. Nội dung tệp nằm
-- ở `document_versions`.
--
-- `current_version_id` trỏ sang bảng chưa tồn tại ở thời điểm này, nên ràng
-- buộc khoá ngoại được thêm ở CUỐI tệp migration.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.documents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id          UUID NOT NULL REFERENCES workspace_schema.document_folders(id) ON DELETE RESTRICT,
    -- Lưu dư có chủ đích: lọc và phân quyền chạy liên tục, không muốn phải
    -- join ngược qua cây thư mục mỗi lần.
    project_id         UUID REFERENCES workspace_schema.projects(id) ON DELETE CASCADE,
    name               VARCHAR(255) NOT NULL,
    description        TEXT,
    -- Rỗng trong khoảnh khắc vừa tạo dòng nhưng chưa upload xong.
    current_version_id UUID,
    -- Không xoá cứng. Lưu trữ là chuyển `archived`.
    status             VARCHAR(32) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','archived')),
    -- Khoá KHÔNG tự hết hạn ở phiên bản đầu; quản lý dự án gỡ khoá hộ.
    locked_by_user_id  UUID,
    locked_at          TIMESTAMPTZ,
    created_by         UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (folder_id, name),
    CONSTRAINT chk_documents_lock_pair
        CHECK ((locked_by_user_id IS NULL) = (locked_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_documents_project_status
    ON workspace_schema.documents (project_id, status);
CREATE INDEX IF NOT EXISTS idx_documents_folder
    ON workspace_schema.documents (folder_id);

-- ===========================================================================
-- PHIÊN BẢN TÀI LIỆU
--
-- Bảng BẤT BIẾN: đã tạo thì không sửa, không xoá. Muốn thay đổi thì tạo
-- phiên bản mới. Vì vậy không có cột `updated_at`.
--
-- `size_bytes` rỗng nghĩa là CHƯA TẢI LÊN XONG: client xin URL rồi tải thất
-- bại sẽ để lại đúng hình dạng đó. Đây là tín hiệu nhận biết duy nhất —
-- server không bao giờ được storage báo là upload đã xong.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.document_versions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID NOT NULL REFERENCES workspace_schema.documents(id) ON DELETE CASCADE,
    version_no   INTEGER NOT NULL CHECK (version_no >= 1),
    -- UNIQUE toàn bảng: không hai bản ghi cùng trỏ một object trong kho.
    storage_key  TEXT NOT NULL UNIQUE,
    file_name    VARCHAR(255) NOT NULL,
    content_type VARCHAR(160) NOT NULL,
    size_bytes   BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    checksum     VARCHAR(64),
    -- Bắt buộc từ phiên bản 2 trở đi; kiểm ở tầng ứng dụng.
    change_note  VARCHAR(500),
    uploaded_by  UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (document_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_document
    ON workspace_schema.document_versions (document_id, version_no DESC);

-- ===========================================================================
-- GẮN TÀI LIỆU VÀO THỰC THỂ KHÁC
--
-- Đa hình thay vì ba bảng riêng: một tài liệu gắn được vào nhiều loại thực
-- thể mà KHÔNG nhân bản tệp. Đánh đổi là mất ràng buộc toàn vẹn ở tầng CSDL,
-- bù lại bằng kiểm tra ở tầng ứng dụng.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.document_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES workspace_schema.documents(id) ON DELETE CASCADE,
    entity_type VARCHAR(32) NOT NULL
                  CHECK (entity_type IN ('project','work_item','calendar_event')),
    entity_id   UUID NOT NULL,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (document_id, entity_type, entity_id)
);

-- Dùng khi mở tab Tài liệu của một công việc.
CREATE INDEX IF NOT EXISTS idx_doc_links_entity
    ON workspace_schema.document_links (entity_type, entity_id);

-- ===========================================================================
-- NHẬT KÝ TRUY CẬP
--
-- Bảng chỉ ghi thêm, phục vụ yêu cầu kiểm toán "ai đã tải tài liệu nào, lúc
-- nào". Append-only nên không có `updated_at`.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS workspace_schema.document_access_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES workspace_schema.documents(id) ON DELETE CASCADE,
    version_id  UUID REFERENCES workspace_schema.document_versions(id) ON DELETE SET NULL,
    action      VARCHAR(32) NOT NULL
                  CHECK (action IN ('view','download','upload','lock','unlock')),
    ip_address  INET,
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_access_document
    ON workspace_schema.document_access_logs (document_id, created_at DESC);

-- ===========================================================================
-- KHOÁ NGOẠI VÒNG TRÒN
--
-- `documents.current_version_id` → `document_versions`, còn
-- `document_versions.document_id` → `documents`. Thêm ràng buộc ở cuối, sau
-- khi cả hai bảng đã tồn tại.
--
-- DEFERRABLE INITIALLY DEFERRED: tạo tài liệu kèm phiên bản đầu tiên phải
-- chạy gọn trong MỘT transaction, mà tại thời điểm INSERT dòng `documents`
-- thì phiên bản chưa tồn tại. Hoãn kiểm tới lúc COMMIT là cách duy nhất
-- không phải tách thành hai transaction.
-- ===========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_documents_current_version'
    ) THEN
        ALTER TABLE workspace_schema.documents
            ADD CONSTRAINT fk_documents_current_version
            FOREIGN KEY (current_version_id)
            REFERENCES workspace_schema.document_versions(id)
            ON DELETE SET NULL
            DEFERRABLE INITIALLY DEFERRED;
    END IF;
END
$$;
