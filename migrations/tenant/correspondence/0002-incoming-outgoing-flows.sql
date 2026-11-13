-- Văn thư theo hai luồng: công văn đến (văn thư tiếp nhận, chọn phòng ban → phòng ban phân công người xử lý →
-- lãnh đạo xem xét theo quy trình → văn thư hoàn tất → lưu trữ) và công văn đi (phòng ban soạn thảo → văn thư
-- kiểm tra → trình duyệt theo quy trình → văn thư đánh số, ban hành → lưu trữ, theo dõi gửi). Bước "chỉ đạo giao
-- phòng ban" bỏ hẳn: văn thư chọn phòng ban ngay khi tiếp nhận; quy trình chỉ còn các bước duyệt.
--
-- Dữ liệu cũ: quy trình bỏ bước chỉ đạo, luật "người đã chỉ đạo" thay bằng luật của bước chỉ đạo cũ, luật "trưởng
-- phòng được giao" đổi tên; công văn đang chờ trình hoặc chờ chỉ đạo quay về bước tiếp nhận để văn thư giao lại.
-- Cột và giá trị cũ vẫn giữ để bản ứng dụng trước vẫn đọc được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- --------------------------------------------------------------------------------------------- công văn
ALTER TABLE correspondence_schema.letters
    ADD COLUMN IF NOT EXISTS direction         VARCHAR(10)  NOT NULL DEFAULT 'incoming',
    ADD COLUMN IF NOT EXISTS author_user_id    UUID,
    ADD COLUMN IF NOT EXISTS author_unit_id    UUID,
    ADD COLUMN IF NOT EXISTS author_unit_name  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS related_letter_id UUID REFERENCES correspondence_schema.letters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS completion_note   TEXT,
    ADD COLUMN IF NOT EXISTS delivery_method   VARCHAR(120),
    ADD COLUMN IF NOT EXISTS delivery_status   VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_note     TEXT,
    ADD COLUMN IF NOT EXISTS delivered_on      DATE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letters_direction') THEN
        ALTER TABLE correspondence_schema.letters
            ADD CONSTRAINT chk_correspondence_letters_direction CHECK (direction IN ('incoming', 'outgoing'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letters_delivery') THEN
        ALTER TABLE correspondence_schema.letters
            ADD CONSTRAINT chk_correspondence_letters_delivery
            CHECK (delivery_status IS NULL OR delivery_status IN ('pending', 'sent', 'received', 'returned'));
    END IF;
END
$$;

-- Giai đoạn mới; giữ 'registered', 'directing' để bản cũ còn ghi được khi phải lùi image.
ALTER TABLE correspondence_schema.letters DROP CONSTRAINT IF EXISTS letters_stage_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_letters_stage') THEN
        ALTER TABLE correspondence_schema.letters
            ADD CONSTRAINT chk_correspondence_letters_stage
            CHECK (stage IN ('received', 'registered', 'directing', 'processing', 'reviewing', 'closing',
                             'drafting', 'checking', 'publishing', 'archived', 'cancelled'));
    END IF;
END
$$;

-- Số sổ đếm riêng cho từng luồng: công văn đi mang số dự thảo cho tới khi được đánh số ban hành.
ALTER TABLE correspondence_schema.letters DROP CONSTRAINT IF EXISTS uq_correspondence_letters_seq;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_direction_seq
    ON correspondence_schema.letters (direction, year, seq);
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_direction
    ON correspondence_schema.letters (direction, stage);

ALTER TABLE correspondence_schema.counters DROP CONSTRAINT IF EXISTS counters_kind_check;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_counters_kind') THEN
        ALTER TABLE correspondence_schema.counters
            ADD CONSTRAINT chk_correspondence_counters_kind CHECK (kind IN ('incoming', 'outgoing', 'archive', 'draft'));
    END IF;
END
$$;

-- --------------------------------------------------------------------------------------------- phòng ban
-- Người xử lý do phòng ban phân công.
ALTER TABLE correspondence_schema.assignments
    ADD COLUMN IF NOT EXISTS handler_user_id     UUID,
    ADD COLUMN IF NOT EXISTS handler_assigned_at TIMESTAMPTZ;

-- --------------------------------------------------------------------------------------------- bước duyệt
-- Không đạt thì về đâu (bước trước, người xử lý, văn thư), chép từ cấu hình của bước lúc trình.
ALTER TABLE correspondence_schema.letter_steps
    ADD COLUMN IF NOT EXISTS reject_to VARCHAR(20);

-- --------------------------------------------------------------------------------------------- tệp
ALTER TABLE correspondence_schema.attachments
    ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1;

-- --------------------------------------------------------------------------------------------- trao đổi
CREATE TABLE IF NOT EXISTS correspondence_schema.comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    letter_id  UUID         NOT NULL REFERENCES correspondence_schema.letters(id) ON DELETE CASCADE,
    -- Bước của công văn lúc viết, để biết trao đổi thuộc bước nào.
    stage      VARCHAR(20)  NOT NULL,
    step_name  VARCHAR(160),
    body       TEXT         NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    -- Người được nhắc tên (@): nhận thông báo và xem được công văn.
    mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
    author_id  UUID         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correspondence_comments_letter
    ON correspondence_schema.comments (letter_id, created_at);
CREATE INDEX IF NOT EXISTS idx_correspondence_comments_mentions
    ON correspondence_schema.comments USING gin (mentioned_user_ids);

-- --------------------------------------------------------------------------------------------- quy trình
ALTER TABLE correspondence_schema.workflows
    ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'incoming';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_correspondence_workflows_direction') THEN
        ALTER TABLE correspondence_schema.workflows
            ADD CONSTRAINT chk_correspondence_workflows_direction CHECK (direction IN ('incoming', 'outgoing'));
    END IF;
END
$$;

-- Mỗi luồng một quy trình mặc định.
DROP INDEX IF EXISTS correspondence_schema.uq_correspondence_workflows_default;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_workflows_default_direction
    ON correspondence_schema.workflows (direction) WHERE is_default;

-- Bỏ bước chỉ đạo khỏi quy trình: luật "người đã chỉ đạo" lấy luật của bước chỉ đạo cũ (thường là lãnh đạo),
-- luật "trưởng các phòng được giao" đổi tên thành "trưởng phòng ban xử lý".
WITH old AS (
    SELECT w.id,
           (SELECT s -> 'approver' FROM jsonb_array_elements(w.steps) s WHERE s ->> 'kind' = 'direct' LIMIT 1) AS director_rule
      FROM correspondence_schema.workflows w
     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(w.steps) s
                    WHERE s ->> 'kind' = 'direct' OR s -> 'approver' ->> 'type' IN ('director', 'assigned_unit_heads'))
)
UPDATE correspondence_schema.workflows w
   SET steps = COALESCE((
           SELECT jsonb_agg(
                    CASE s -> 'approver' ->> 'type'
                      WHEN 'director' THEN jsonb_set(s, '{approver}', COALESCE(old.director_rule, '{"type": "choose", "pool": "leaders"}'::jsonb))
                      WHEN 'assigned_unit_heads' THEN jsonb_set(s, '{approver}', '{"type": "handling_unit_heads"}'::jsonb)
                      ELSE s
                    END ORDER BY e.ord)
             FROM jsonb_array_elements(w.steps) WITH ORDINALITY AS e(s, ord)
            WHERE s ->> 'kind' IS DISTINCT FROM 'direct'
       ), '[]'::jsonb),
       updated_at = now()
  FROM old
 WHERE old.id = w.id;

UPDATE correspondence_schema.workflows
   SET description = 'Trưởng phòng ban xử lý kiểm tra, lãnh đạo xem xét và cho ý kiến.'
 WHERE id = 'c0000000-0000-4000-8000-000000000001'
   AND description = 'Lãnh đạo chỉ đạo, phòng ban xử lý, trưởng phòng kiểm tra, lãnh đạo duyệt và ký.';

-- Quy trình mặc định của công văn đi.
INSERT INTO correspondence_schema.workflows (id, name, description, direction, is_default, steps)
VALUES (
    'c0000000-0000-4000-8000-000000000002',
    'Duyệt công văn đi',
    'Trưởng phòng soạn thảo duyệt, lãnh đạo duyệt ban hành.',
    'outgoing',
    true,
    '[
      {"key": "unit-head", "name": "Trưởng phòng soạn thảo duyệt", "kind": "approve", "approver": {"type": "handling_unit_heads"}},
      {"key": "sign", "name": "Lãnh đạo duyệt ban hành", "kind": "approve", "approver": {"type": "choose", "pool": "leaders"}}
    ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- --------------------------------------------------------------------------------------------- danh mục
-- Loại văn bản mang quy trình mặc định cho từng luồng và phòng ban gợi ý khi văn thư giao xử lý.
ALTER TABLE correspondence_schema.catalog_items
    ADD COLUMN IF NOT EXISTS outgoing_workflow_id UUID,
    ADD COLUMN IF NOT EXISTS default_unit_ids     UUID[] NOT NULL DEFAULT '{}';

-- --------------------------------------------------------------------------------------------- công văn cũ
-- Công văn đang chờ trình hay chờ chỉ đạo theo luồng cũ: về bước tiếp nhận để văn thư chọn phòng ban và giao lại.
DELETE FROM correspondence_schema.letter_steps s
 USING correspondence_schema.letters l
 WHERE s.letter_id = l.id AND l.stage IN ('registered', 'directing');

UPDATE correspondence_schema.letters
   SET stage = 'received', updated_at = now()
 WHERE stage IN ('registered', 'directing');
