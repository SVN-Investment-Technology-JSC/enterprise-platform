-- CRM · bố cục in của mẫu báo giá (phase 3). Thêm bố cục (JSON có kiểu, không phải HTML) vào mẫu báo giá có sẵn và
-- bản chụp bố cục trên phiên bản báo giá lúc gửi khách. Chỉ thêm cột cho phép rỗng: không ghi lại bảng, không khoá lâu,
-- chạy lại không lỗi. Mẫu cũ để rỗng (dùng bố cục mặc định); không backfill bản chụp cho báo giá đã gửi trước đây.
SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_schema.quote_templates
    ADD COLUMN IF NOT EXISTS layout            JSONB,
    ADD COLUMN IF NOT EXISTS layout_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS layout_updated_by UUID;

ALTER TABLE crm_schema.quote_versions
    ADD COLUMN IF NOT EXISTS layout_snapshot   JSONB;

COMMENT ON COLUMN crm_schema.quote_templates.layout IS 'Bố cục in của mẫu (QuoteLayout v1); rỗng: dùng bố cục mặc định.';
COMMENT ON COLUMN crm_schema.quote_versions.layout_snapshot IS 'Bố cục chụp khi phiên bản chuyển sang SENT.';
