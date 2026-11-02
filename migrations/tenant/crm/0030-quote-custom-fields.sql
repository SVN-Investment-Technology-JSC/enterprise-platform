-- Bán hàng (crm) · trường tuỳ biến của báo giá (GĐI, P2I-02 cho P2I-06): định nghĩa trường ở Cài đặt và giá trị
-- trên phiên bản báo giá. Giá trị là JSONB `{ "<id trường>": giá trị }` trên `quote_versions.custom_fields`: mỗi phiên
-- bản chụp giá trị của mình, sinh phiên bản mới thì chép theo, không cần bảng nối. Kiểm bắt buộc và kiểu ở tầng ứng dụng.
-- `entity_type` mặc định 'quote'; ràng buộc CHECK chỉ cho 'quote' đợt này, nới bằng migration mới khi mở rộng.
-- Dữ liệu cũ: giá trị rỗng `{}`. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS crm_schema.custom_field_definitions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(32) NOT NULL DEFAULT 'quote' CHECK (entity_type IN ('quote')),
    name        VARCHAR(200) NOT NULL,
    field_type  VARCHAR(8) NOT NULL CHECK (field_type IN ('SELECT', 'TEXT', 'NUMBER', 'DATE')),
    -- Danh sách lựa chọn khi `field_type = 'SELECT'`: mảng chuỗi.
    options     JSONB NOT NULL DEFAULT '[]'::jsonb,
    required    BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_custom_field_definitions_name
    ON crm_schema.custom_field_definitions (entity_type, lower(name));

ALTER TABLE crm_schema.quote_versions
    ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
