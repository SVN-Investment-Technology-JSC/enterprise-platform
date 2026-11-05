-- Bán hàng (crm) · gợi ý chăm sóc lại khi cơ hội Thua (GĐ F, P2F-02, quyết định P2-D3): cờ theo luồng.
-- care_suggestion = true thì sau khi lưu Thua giao diện gợi ý tạo lịch chăm sóc lại (chỉ gợi ý, không tự tạo).
-- Backfill: luồng profile TENDER tắt, các luồng khác bật. Thêm cột nullable-an toàn (có DEFAULT), bản app cũ
-- không đọc cột này nên vẫn chạy được. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.pipelines
    ADD COLUMN IF NOT EXISTS care_suggestion BOOLEAN NOT NULL DEFAULT true;

UPDATE crm_schema.pipelines SET care_suggestion = false
 WHERE profile = 'TENDER' AND care_suggestion;
