-- Bán hàng (crm) · luồng cơ hội dạng dữ liệu (GĐB, P2B-01): luồng (pipeline), giai đoạn
-- (mang nghĩa OPEN/WON/LOST), bước chuyển và điều kiện chuyển của từng giai đoạn. Nạp luồng
-- mặc định "Bán hàng thông thường" với 7 giai đoạn cũ (NEW, CONTACTED, DISCOVERY, QUOTING,
-- NEGOTIATION, WON, LOST), bước chuyển và điều kiện mặc định theo máy trạng thái phase 1.
-- Chỉ thêm bảng mới và dữ liệu mẫu, chưa đụng bảng cũ (0018 gán cơ hội vào luồng).
-- Chạy lại được: CREATE ... IF NOT EXISTS, nạp mẫu bằng ON CONFLICT DO NOTHING.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- LUỒNG
--
-- `profile`: STANDARD hoặc TENDER (luồng chào thầu có thêm hồ sơ thầu). Mỗi tenant có đúng
-- một luồng mặc định (chỉ mục duy nhất một phần).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.pipelines (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code       VARCHAR(32) NOT NULL,
    name       VARCHAR(200) NOT NULL,
    profile    VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
    is_default BOOLEAN NOT NULL DEFAULT false,
    active     BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID,

    CONSTRAINT uq_crm_pipelines_code UNIQUE (code),
    CONSTRAINT ck_crm_pipelines_profile CHECK (profile IN ('STANDARD', 'TENDER'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_pipelines_default
    ON crm_schema.pipelines (is_default) WHERE is_default;

-- ---------------------------------------------------------------------------
-- GIAI ĐOẠN
--
-- `semantic`: OPEN (đang chạy), WON (thắng), LOST (thua); báo cáo và dashboard gom theo
-- nghĩa này, không theo mã. Mã giai đoạn duy nhất trong luồng. `active = false` là tắt:
-- cơ hội đang ở đó vẫn xem và chuyển đi được, không chuyển mới vào.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.pipeline_stages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id         UUID NOT NULL REFERENCES crm_schema.pipelines (id) ON DELETE RESTRICT,
    code                VARCHAR(32) NOT NULL,
    name                VARCHAR(200) NOT NULL,
    semantic            VARCHAR(8) NOT NULL DEFAULT 'OPEN',
    sort_order          INTEGER NOT NULL DEFAULT 0,
    default_probability SMALLINT NOT NULL DEFAULT 0,
    active              BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by          UUID,

    CONSTRAINT uq_crm_pipeline_stages_code UNIQUE (pipeline_id, code),
    CONSTRAINT ck_crm_pipeline_stages_semantic CHECK (semantic IN ('OPEN', 'WON', 'LOST')),
    CONSTRAINT ck_crm_pipeline_stages_probability CHECK (default_probability BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS ix_crm_pipeline_stages_order
    ON crm_schema.pipeline_stages (pipeline_id, sort_order);

-- ---------------------------------------------------------------------------
-- BƯỚC CHUYỂN
--
-- Chuyển giai đoạn chỉ hợp lệ khi cặp (from, to) có ở đây (cả hai thuộc cùng một luồng,
-- do ứng dụng kiểm khi cấu hình).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.pipeline_stage_transitions (
    from_stage_id UUID NOT NULL REFERENCES crm_schema.pipeline_stages (id) ON DELETE CASCADE,
    to_stage_id   UUID NOT NULL REFERENCES crm_schema.pipeline_stages (id) ON DELETE CASCADE,

    PRIMARY KEY (from_stage_id, to_stage_id),
    CONSTRAINT ck_crm_pipeline_stage_transitions_distinct CHECK (from_stage_id <> to_stage_id)
);

CREATE INDEX IF NOT EXISTS ix_crm_pipeline_stage_transitions_to
    ON crm_schema.pipeline_stage_transitions (to_stage_id);

-- ---------------------------------------------------------------------------
-- ĐIỀU KIỆN CHUYỂN VÀO GIAI ĐOẠN
--
-- `kind`: DOCUMENT_TYPE (`ref` = mã loại tài liệu), FIELD (`ref` = tên trường cơ hội),
-- QUOTE_APPROVED (có báo giá Khách chấp nhận), REASON (phải ghi lý do). `required`:
-- true thì chặn chuyển khi thiếu, false thì chỉ hiện trong danh sách "cần có" (gợi ý).
-- `ref` là chuỗi rỗng khi loại điều kiện không cần tham chiếu (để khoá duy nhất dùng được).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.pipeline_stage_requirements (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id   UUID NOT NULL REFERENCES crm_schema.pipeline_stages (id) ON DELETE CASCADE,
    kind       VARCHAR(24) NOT NULL,
    ref        VARCHAR(100) NOT NULL DEFAULT '',
    required   BOOLEAN NOT NULL DEFAULT true,
    message    VARCHAR(500) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_crm_pipeline_stage_requirements UNIQUE (stage_id, kind, ref),
    CONSTRAINT ck_crm_pipeline_stage_requirements_kind
        CHECK (kind IN ('DOCUMENT_TYPE', 'FIELD', 'QUOTE_APPROVED', 'REASON'))
);

-- ---------------------------------------------------------------------------
-- LUỒNG MẶC ĐỊNH "Bán hàng thông thường"
-- ---------------------------------------------------------------------------
INSERT INTO crm_schema.pipelines (code, name, profile, is_default, sort_order)
SELECT 'SALES_STANDARD', 'Bán hàng thông thường', 'STANDARD', true, 0
 WHERE NOT EXISTS (SELECT 1 FROM crm_schema.pipelines WHERE is_default)
ON CONFLICT (code) DO NOTHING;

INSERT INTO crm_schema.pipeline_stages (pipeline_id, code, name, semantic, sort_order, default_probability)
SELECT p.id, s.code, s.name, s.semantic, s.sort_order, s.probability
  FROM crm_schema.pipelines p
 CROSS JOIN (VALUES
     ('NEW',         'Mới',               'OPEN', 10,   0),
     ('CONTACTED',   'Đã liên hệ',        'OPEN', 20,  10),
     ('DISCOVERY',   'Khảo sát nhu cầu',  'OPEN', 30,  25),
     ('QUOTING',     'Báo giá',           'OPEN', 40,  50),
     ('NEGOTIATION', 'Đàm phán',          'OPEN', 50,  75),
     ('WON',         'Thắng',             'WON',  60, 100),
     ('LOST',        'Thua',              'LOST', 70,   0)
 ) AS s (code, name, semantic, sort_order, probability)
 WHERE p.code = 'SALES_STANDARD'
ON CONFLICT (pipeline_id, code) DO NOTHING;

-- Bước chuyển như phase 1: giai đoạn mở tiến hoặc lùi một bước, Đàm phán sang Thắng,
-- mọi giai đoạn mở sang Thua; Thắng và Thua là cuối.
INSERT INTO crm_schema.pipeline_stage_transitions (from_stage_id, to_stage_id)
SELECT f.id, t.id
  FROM crm_schema.pipelines p
  JOIN crm_schema.pipeline_stages f ON f.pipeline_id = p.id
  JOIN crm_schema.pipeline_stages t ON t.pipeline_id = p.id
  JOIN (VALUES
     ('NEW', 'CONTACTED'), ('NEW', 'LOST'),
     ('CONTACTED', 'NEW'), ('CONTACTED', 'DISCOVERY'), ('CONTACTED', 'LOST'),
     ('DISCOVERY', 'CONTACTED'), ('DISCOVERY', 'QUOTING'), ('DISCOVERY', 'LOST'),
     ('QUOTING', 'DISCOVERY'), ('QUOTING', 'NEGOTIATION'), ('QUOTING', 'LOST'),
     ('NEGOTIATION', 'QUOTING'), ('NEGOTIATION', 'WON'), ('NEGOTIATION', 'LOST')
  ) AS m (from_code, to_code) ON m.from_code = f.code AND m.to_code = t.code
 WHERE p.code = 'SALES_STANDARD'
ON CONFLICT DO NOTHING;

-- Điều kiện mặc định (đều bắt buộc): vào Thắng cần báo giá Khách chấp nhận, vào Thua cần lý do.
INSERT INTO crm_schema.pipeline_stage_requirements (stage_id, kind, ref, required, message, sort_order)
SELECT s.id, r.kind, '', true, r.message, 0
  FROM crm_schema.pipelines p
  JOIN crm_schema.pipeline_stages s ON s.pipeline_id = p.id
  JOIN (VALUES
     ('WON',  'QUOTE_APPROVED', 'Cần có báo giá Khách chấp nhận trước khi chuyển sang Thắng.'),
     ('LOST', 'REASON',         'Phải ghi lý do thua.')
  ) AS r (stage_code, kind, message) ON r.stage_code = s.code
 WHERE p.code = 'SALES_STANDARD'
ON CONFLICT (stage_id, kind, ref) DO NOTHING;
