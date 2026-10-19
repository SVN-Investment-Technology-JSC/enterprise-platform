SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ===========================================================================
-- PHÂN LOẠI TÀI LIỆU: NỘI BỘ / KHÁCH HÀNG
--
-- `audience` chia tài liệu thành nội bộ (mặc định) và dành cho khách hàng. Tài
-- liệu khách hàng (đề xuất, hợp đồng…) hiện trên trang Khách hàng của dự án và
-- tìm nhanh ra được. Mặc định `internal` nên mọi tài liệu cũ đọc ra đều là nội
-- bộ, không cần backfill.
-- ===========================================================================
ALTER TABLE workspace_schema.documents
    ADD COLUMN IF NOT EXISTS audience VARCHAR(16) NOT NULL DEFAULT 'internal'
        CHECK (audience IN ('internal','customer'));

-- Lọc tài liệu khách hàng của một dự án chạy mỗi lần mở trang Khách hàng; chỉ
-- số ít tài liệu là `customer` nên partial index giữ chỉ mục nhỏ và đúng chỗ.
CREATE INDEX IF NOT EXISTS idx_documents_customer_audience
    ON workspace_schema.documents (project_id)
    WHERE audience = 'customer';
