-- Sổ đăng ký và số, ký hiệu văn bản theo Nghị định 30/2020/NĐ-CP:
-- - Nhiều sổ đăng ký cho mỗi luồng, mỗi sổ cấp số riêng theo năm (văn bản mật đăng ký, cấp số riêng); sổ chọn theo
--   độ mật và loại văn bản, mặc định là sổ mặc định của luồng.
-- - Mẫu số của sổ ({so}, {nam}, {loai}, {coquan}, {donvi}); loại văn bản có ký hiệu viết tắt và mẫu số riêng cho văn bản đi.
-- - Văn bản đi ghi người ký, chức vụ người ký.
-- Dữ liệu cũ: tạo sổ mặc định đến / đi theo ký hiệu số đang cấu hình, nối tiếp số đã cấp; công văn cũ thuộc sổ mặc định.
-- Sổ văn bản mật tạo sẵn nhưng chưa dùng, bật trong Cấu hình.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS correspondence_schema.registers (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    direction     VARCHAR(10)  NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    name          VARCHAR(160) NOT NULL,
    number_format VARCHAR(80)  NOT NULL CHECK (position('{so}' IN number_format) > 0),
    confidential  BOOLEAN      NOT NULL DEFAULT false,
    letter_types  TEXT[]       NOT NULL DEFAULT '{}',
    is_default    BOOLEAN      NOT NULL DEFAULT false,
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    sort_order    INTEGER      NOT NULL DEFAULT 0,
    updated_by    UUID,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_registers_default
    ON correspondence_schema.registers (direction) WHERE is_default;

CREATE TABLE IF NOT EXISTS correspondence_schema.register_counters (
    register_id UUID     NOT NULL REFERENCES correspondence_schema.registers (id) ON DELETE CASCADE,
    year        SMALLINT NOT NULL,
    value       INTEGER  NOT NULL DEFAULT 0 CHECK (value >= 0),
    PRIMARY KEY (register_id, year)
);

INSERT INTO correspondence_schema.registers (direction, name, number_format, is_default, sort_order)
SELECT 'incoming', 'Sổ công văn đến',
       '{so}/' || COALESCE(NULLIF((SELECT s.value ->> 'incomingSuffix' FROM correspondence_schema.settings s WHERE s.key = 'register'), ''), 'CVĐ'),
       true, 0
 WHERE NOT EXISTS (SELECT 1 FROM correspondence_schema.registers WHERE direction = 'incoming');
INSERT INTO correspondence_schema.registers (direction, name, number_format, is_default, sort_order)
SELECT 'outgoing', 'Sổ công văn đi',
       '{so}/' || COALESCE(NULLIF((SELECT s.value ->> 'outgoingSuffix' FROM correspondence_schema.settings s WHERE s.key = 'register'), ''), 'CV'),
       true, 0
 WHERE NOT EXISTS (SELECT 1 FROM correspondence_schema.registers WHERE direction = 'outgoing');
INSERT INTO correspondence_schema.registers (direction, name, number_format, confidential, is_active, sort_order)
SELECT d.direction, d.name, d.number_format, true, false, 10
  FROM (VALUES ('incoming', 'Sổ văn bản mật đến', '{so}/M-ĐẾN'), ('outgoing', 'Sổ văn bản mật đi', '{so}/M-ĐI')) AS d (direction, name, number_format)
 WHERE NOT EXISTS (SELECT 1 FROM correspondence_schema.registers r WHERE r.direction = d.direction AND r.confidential);

-- Nối tiếp số đã cấp của luồng vào sổ mặc định.
INSERT INTO correspondence_schema.register_counters (register_id, year, value)
SELECT r.id, c.year, c.value
  FROM correspondence_schema.counters c
  JOIN correspondence_schema.registers r ON r.is_default AND r.direction = c.kind
 WHERE c.kind IN ('incoming', 'outgoing')
ON CONFLICT (register_id, year) DO NOTHING;

ALTER TABLE correspondence_schema.letters
    ADD COLUMN IF NOT EXISTS register_id  UUID REFERENCES correspondence_schema.registers (id),
    ADD COLUMN IF NOT EXISTS signer_user_id UUID,
    ADD COLUMN IF NOT EXISTS signer_name  VARCHAR(160),
    ADD COLUMN IF NOT EXISTS signer_title VARCHAR(160);

UPDATE correspondence_schema.letters l
   SET register_id = r.id
  FROM correspondence_schema.registers r
 WHERE l.register_id IS NULL
   AND r.is_default
   AND r.direction = l.direction
   AND (l.direction = 'incoming' OR l.outgoing_seq IS NOT NULL);

-- Số đến đếm theo sổ; số dự thảo của văn bản đi vẫn đếm chung; số đi đếm theo sổ.
DROP INDEX IF EXISTS correspondence_schema.uq_correspondence_letters_direction_seq;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_incoming_register_seq
    ON correspondence_schema.letters (register_id, year, seq) WHERE direction = 'incoming';
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_draft_seq
    ON correspondence_schema.letters (year, seq) WHERE direction = 'outgoing';
DROP INDEX IF EXISTS correspondence_schema.uq_correspondence_letters_outgoing;
CREATE UNIQUE INDEX IF NOT EXISTS uq_correspondence_letters_outgoing_register
    ON correspondence_schema.letters (register_id, outgoing_year, outgoing_seq) WHERE outgoing_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_correspondence_letters_register
    ON correspondence_schema.letters (register_id) WHERE register_id IS NOT NULL;

ALTER TABLE correspondence_schema.catalog_items
    ADD COLUMN IF NOT EXISTS abbreviation  VARCHAR(20),
    ADD COLUMN IF NOT EXISTS number_format VARCHAR(80);
