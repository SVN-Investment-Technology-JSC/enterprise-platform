-- Theo quy trình văn bản đến chuẩn (Nghị định 30/2020/NĐ-CP):
-- - Tiếp nhận, phân loại sơ bộ: tình trạng bì, dấu niêm phong, số tờ, số bản, văn bản gửi đích danh cá nhân / tổ chức.
-- - Trình duyệt và phân phối: bước duyệt có thể là bước chỉ đạo (bút phê) — ghi ý kiến chỉ đạo, đơn vị / cá nhân chủ trì,
--   phối hợp và thời hạn; văn thư phân phối theo bút phê. Phòng ban được giao mang vai trò chủ trì hay phối hợp.
-- - Độ khẩn, độ mật đủ các mức theo quy định (thêm Thượng khẩn, Tối mật, Tuyệt mật nếu tenant chưa có).
-- Dữ liệu cũ: phòng ban đã giao coi là chủ trì; các cột mới để trống.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE correspondence_schema.letters
    ADD COLUMN IF NOT EXISTS envelope_status   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS sealed            BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS page_count        SMALLINT CHECK (page_count IS NULL OR page_count BETWEEN 0 AND 10000),
    ADD COLUMN IF NOT EXISTS copy_count        SMALLINT CHECK (copy_count IS NULL OR copy_count BETWEEN 0 AND 1000),
    ADD COLUMN IF NOT EXISTS addressed_to      VARCHAR(255),
    ADD COLUMN IF NOT EXISTS addressed_user_id UUID,
    -- Bút phê của bước chỉ đạo gần nhất: ý kiến, đơn vị chủ trì / phối hợp, thời hạn, người và lúc bút phê.
    ADD COLUMN IF NOT EXISTS directive         JSONB;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letters_envelope') THEN
        ALTER TABLE correspondence_schema.letters
            ADD CONSTRAINT chk_correspondence_letters_envelope
            CHECK (envelope_status IS NULL OR envelope_status IN ('intact', 'damaged', 'electronic'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_correspondence_letters_addressed
    ON correspondence_schema.letters (addressed_user_id) WHERE addressed_user_id IS NOT NULL;

ALTER TABLE correspondence_schema.assignments
    ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'lead';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_assignments_role') THEN
        ALTER TABLE correspondence_schema.assignments
            ADD CONSTRAINT chk_correspondence_assignments_role CHECK (role IN ('lead', 'support'));
    END IF;
END
$$;

-- Bước duyệt là bước chỉ đạo (bút phê), chép từ cấu hình của bước.
ALTER TABLE correspondence_schema.letter_steps
    ADD COLUMN IF NOT EXISTS directs BOOLEAN NOT NULL DEFAULT false;

INSERT INTO correspondence_schema.catalog_items (kind, code, name, sort_order, highlight, restricted)
VALUES
    ('urgency', 'top_urgent', 'Thượng khẩn', 25, true, false),
    ('confidentiality', 'secret', 'Tối mật', 30, false, true),
    ('confidentiality', 'top_secret', 'Tuyệt mật', 40, false, true)
ON CONFLICT (kind, code) DO NOTHING;
