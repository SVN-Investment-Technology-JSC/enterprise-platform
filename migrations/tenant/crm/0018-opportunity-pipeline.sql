-- Bán hàng (crm) · gán cơ hội vào luồng (GĐB, P2B-02): thêm `pipeline_id`, `stage_id` cho cơ hội,
-- `from_stage_id`, `to_stage_id` cho lịch sử; gỡ CHECK cứng 7 giai đoạn (`opportunities_stage_check`
-- ở 0003) và CHECK "Thua cần lý do" (`ck_crm_opportunities_lost_reason`), việc kiểm chuyển sang
-- quy tắc theo `semantic` ở ứng dụng; nới `from_stage`, `to_stage` lên VARCHAR(32).
-- Dữ liệu cũ: backfill theo mã `stage` vào luồng mặc định (0017); cơ hội có mã lạ thì dừng
-- bằng RAISE EXCEPTION nêu cơ hội và mã. Sau backfill đặt NOT NULL. Cột `stage` giữ lại.
-- Tương thích ngược: trigger điền `stage_id` và id lịch sử từ mã `stage` cho bản app cũ chưa
-- biết các cột mới (bỏ ở đợt sau khi không còn bản cũ).
-- Chạy lại được: ADD COLUMN IF NOT EXISTS, DROP ... IF EXISTS, backfill chỉ chạm dòng còn NULL.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.opportunities
    ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES crm_schema.pipelines (id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES crm_schema.pipeline_stages (id) ON DELETE RESTRICT;

ALTER TABLE crm_schema.opportunity_stage_history
    ADD COLUMN IF NOT EXISTS from_stage_id UUID REFERENCES crm_schema.pipeline_stages (id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS to_stage_id UUID REFERENCES crm_schema.pipeline_stages (id) ON DELETE RESTRICT;

ALTER TABLE crm_schema.opportunity_stage_history
    ALTER COLUMN from_stage TYPE VARCHAR(32),
    ALTER COLUMN to_stage TYPE VARCHAR(32);

-- Gỡ CHECK cứng đúng tên (0003): CHECK cột `stage` không đặt tên nên PostgreSQL tự đặt
-- `opportunities_stage_check`.
ALTER TABLE crm_schema.opportunities DROP CONSTRAINT IF EXISTS opportunities_stage_check;
ALTER TABLE crm_schema.opportunities DROP CONSTRAINT IF EXISTS ck_crm_opportunities_lost_reason;

DO $$
DECLARE
    default_pipeline UUID;
    unknown_count    INTEGER;
    unknown_sample   TEXT;
BEGIN
    SELECT id INTO default_pipeline FROM crm_schema.pipelines WHERE is_default;
    IF default_pipeline IS NULL THEN
        RAISE EXCEPTION 'Không có luồng mặc định (crm_schema.pipelines.is_default); hãy áp 0017-pipelines trước.';
    END IF;

    -- Mã giai đoạn lạ: dừng, không bỏ sót im lặng.
    SELECT count(*),
           string_agg(sample, '; ')
      INTO unknown_count, unknown_sample
      FROM (
          SELECT o.id || ' (stage=' || coalesce(o.stage, 'NULL') || ')' AS sample
            FROM crm_schema.opportunities o
           WHERE o.stage_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM crm_schema.pipeline_stages s
                              WHERE s.pipeline_id = default_pipeline AND s.code = o.stage)
           ORDER BY o.id
           LIMIT 10
      ) AS u;
    IF unknown_count > 0 THEN
        RAISE EXCEPTION 'Cơ hội có mã giai đoạn không thuộc luồng mặc định, không thể gán luồng: %', unknown_sample;
    END IF;

    UPDATE crm_schema.opportunities o
       SET pipeline_id = s.pipeline_id, stage_id = s.id
      FROM crm_schema.pipeline_stages s
     WHERE s.pipeline_id = default_pipeline AND s.code = o.stage
       AND (o.pipeline_id IS NULL OR o.stage_id IS NULL);

    -- Lịch sử: gán id theo mã trong luồng của cơ hội; mã không còn trong luồng giữ NULL (lịch sử cũ giữ nguyên).
    UPDATE crm_schema.opportunity_stage_history h
       SET from_stage_id = s.id
      FROM crm_schema.opportunities o
      JOIN crm_schema.pipeline_stages s ON s.pipeline_id = o.pipeline_id
     WHERE h.opportunity_id = o.id AND s.code = h.from_stage
       AND h.from_stage IS NOT NULL AND h.from_stage_id IS NULL;

    UPDATE crm_schema.opportunity_stage_history h
       SET to_stage_id = s.id
      FROM crm_schema.opportunities o
      JOIN crm_schema.pipeline_stages s ON s.pipeline_id = o.pipeline_id
     WHERE h.opportunity_id = o.id AND s.code = h.to_stage AND h.to_stage_id IS NULL;
END
$$;

ALTER TABLE crm_schema.opportunities
    ALTER COLUMN pipeline_id SET NOT NULL,
    ALTER COLUMN stage_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_crm_opportunities_pipeline_stage
    ON crm_schema.opportunities (pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS ix_crm_opportunities_stage_id
    ON crm_schema.opportunities (stage_id);
CREATE INDEX IF NOT EXISTS ix_crm_opportunity_stage_history_to_stage
    ON crm_schema.opportunity_stage_history (to_stage_id);

-- Tương thích ngược cho bản app cũ (chỉ biết cột `stage`). Cơ hội mới không có luồng thì vào luồng
-- mặc định; đổi `stage` mà không đổi `stage_id` thì tra lại `stage_id` theo mã trong luồng của cơ hội.
CREATE OR REPLACE FUNCTION crm_schema.opportunities_sync_stage() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.pipeline_id IS NULL THEN
        SELECT id INTO NEW.pipeline_id FROM crm_schema.pipelines WHERE is_default;
    END IF;
    IF NEW.stage_id IS NULL
       OR (TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id) THEN
        SELECT id INTO NEW.stage_id FROM crm_schema.pipeline_stages
         WHERE pipeline_id = NEW.pipeline_id AND code = NEW.stage;
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_crm_opportunities_sync_stage ON crm_schema.opportunities;
CREATE TRIGGER trg_crm_opportunities_sync_stage
    BEFORE INSERT OR UPDATE OF stage ON crm_schema.opportunities
    FOR EACH ROW EXECUTE FUNCTION crm_schema.opportunities_sync_stage();

CREATE OR REPLACE FUNCTION crm_schema.opportunity_stage_history_sync_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    pipeline UUID;
BEGIN
    IF NEW.from_stage_id IS NULL OR NEW.to_stage_id IS NULL THEN
        SELECT pipeline_id INTO pipeline FROM crm_schema.opportunities WHERE id = NEW.opportunity_id;
        IF NEW.from_stage_id IS NULL AND NEW.from_stage IS NOT NULL THEN
            SELECT id INTO NEW.from_stage_id FROM crm_schema.pipeline_stages
             WHERE pipeline_id = pipeline AND code = NEW.from_stage;
        END IF;
        IF NEW.to_stage_id IS NULL THEN
            SELECT id INTO NEW.to_stage_id FROM crm_schema.pipeline_stages
             WHERE pipeline_id = pipeline AND code = NEW.to_stage;
        END IF;
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_crm_opportunity_stage_history_sync_ids ON crm_schema.opportunity_stage_history;
CREATE TRIGGER trg_crm_opportunity_stage_history_sync_ids
    BEFORE INSERT ON crm_schema.opportunity_stage_history
    FOR EACH ROW EXECUTE FUNCTION crm_schema.opportunity_stage_history_sync_ids();
