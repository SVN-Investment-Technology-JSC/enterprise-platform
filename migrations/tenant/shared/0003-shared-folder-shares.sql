SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- HỆ DÙNG CHUNG · CHIA SẺ THƯ MỤC
--
-- Vào được phân hệ chưa có nghĩa là thấy cả kho: một thư mục chỉ hiện với
-- người được chia sẻ — đích danh, theo phòng ban, theo chức danh, hoặc mọi
-- người — và với người tạo ra nó (chủ sở hữu). Quyền chia sẻ ở một thư mục áp
-- xuống mọi thư mục con; quản trị kho và quản trị tenant thấy cả kho.
--
-- Quyền phân hệ (`shared.document.write`, `shared.document.delete`) vẫn là
-- trần: "Sửa" ở một thư mục chỉ cho ghi khi người đó có quyền ghi của phân hệ.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS shared_schema.folder_shares (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Xoá vĩnh viễn thư mục thì bỏ luôn dòng chia sẻ; thư mục vào Thùng rác
    -- thì dòng vẫn còn để khôi phục là có lại quyền như cũ.
    folder_id      UUID NOT NULL REFERENCES shared_schema.folders(id) ON DELETE CASCADE,
    -- 'unit' và 'position' trỏ vào node sơ đồ tổ chức của Tenant Core (không có
    -- khoá ngoại: hai schema đọc qua hợp đồng organization context).
    principal_type VARCHAR(16) NOT NULL
                     CHECK (principal_type IN ('everyone', 'unit', 'position', 'user')),
    principal_id   UUID,
    role           VARCHAR(16) NOT NULL CHECK (role IN ('viewer', 'editor', 'manager')),
    -- Còn hiệu lực tới hết ngày này; rỗng là không thời hạn.
    expires_on     DATE,
    created_by     UUID NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by     UUID NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_shared_folder_shares_principal
        CHECK ((principal_type = 'everyone') = (principal_id IS NULL))
);

-- Mỗi đối tượng một dòng trên một thư mục.
CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_folder_shares_principal
    ON shared_schema.folder_shares (
        folder_id,
        principal_type,
        COALESCE(principal_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

-- Tìm "thư mục nào đã chia sẻ cho phòng này / người này".
CREATE INDEX IF NOT EXISTS idx_shared_folder_shares_principal
    ON shared_schema.folder_shares (principal_type, principal_id);
