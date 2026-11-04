-- Bán hàng (crm) · chào thầu (GĐ E, P2E-01, P2E-04): hồ sơ thầu 1-1 với cơ hội của luồng profile TENDER, danh sách
-- đối tác liên danh, các vòng duyệt phương án chào thầu; mở rộng ba ràng buộc loại để nhận loại duyệt mới
-- `TENDER_PLAN` (approval_bindings, procedure_links) và hai loại điều kiện chuyển giai đoạn mới
-- `TENDER_PLAN_APPROVED`, `TENDER_FIELD` (pipeline_stage_requirements).
-- Tương thích ngược: bản app cũ không ghi giá trị mới nên các ràng buộc nới rộng không ảnh hưởng.
-- Chạy lại được: CREATE ... IF NOT EXISTS; ràng buộc loại bỏ bản cũ (tên tự sinh) rồi thêm bản có tên cố định.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- HỒ SƠ THẦU
--
-- Mỗi cơ hội có tối đa một hồ sơ (UNIQUE opportunity_id); chỉ cơ hội thuộc luồng profile TENDER mới có hồ sơ
-- (ứng dụng kiểm). `plan_status`: DRAFT (đang soạn), PENDING (đã trình, khoá sửa kịch bản/liên danh), APPROVED,
-- REJECTED (trả về sửa). `result`: WON hoặc LOST khi đã ghi kết quả. `version` chống ghi đè đồng thời.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.tender_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id       UUID NOT NULL REFERENCES crm_schema.opportunities (id) ON DELETE CASCADE,
    package_name         VARCHAR(300) NOT NULL,
    inviter_name         VARCHAR(300) NOT NULL,
    package_code         VARCHAR(100),
    submission_deadline  TIMESTAMPTZ,
    -- ONLINE: nộp qua mạng; IN_PERSON: nộp trực tiếp; POST: gửi bưu điện.
    submission_method    VARCHAR(16),
    submitter_user_id    UUID,
    -- Ngày nộp thực tế; tự ghi khi cơ hội sang giai đoạn Đã nộp (TENDER_SUBMITTED), sửa tay được.
    submitted_at         TIMESTAMPTZ,
    has_joint_venture    BOOLEAN NOT NULL DEFAULT false,
    scenario             VARCHAR(4000),
    plan_status          VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    plan_round_no        INTEGER NOT NULL DEFAULT 0,
    plan_submitted_at    TIMESTAMPTZ,
    plan_submitted_by    UUID,
    plan_decided_at      TIMESTAMPTZ,
    plan_decided_by      UUID,
    plan_decision_reason VARCHAR(2000),
    result               VARCHAR(8),
    winning_price        NUMERIC(18, 2),
    winner_name          VARCHAR(300),
    lost_reason          VARCHAR(2000),
    result_recorded_at   TIMESTAMPTZ,
    result_recorded_by   UUID,
    version              INTEGER NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by           UUID NOT NULL,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by           UUID NOT NULL,

    CONSTRAINT uq_crm_tender_profiles_opportunity UNIQUE (opportunity_id),
    CONSTRAINT ck_crm_tender_profiles_method CHECK (submission_method IS NULL OR submission_method IN ('ONLINE', 'IN_PERSON', 'POST')),
    CONSTRAINT ck_crm_tender_profiles_plan_status CHECK (plan_status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED')),
    CONSTRAINT ck_crm_tender_profiles_result CHECK (result IS NULL OR result IN ('WON', 'LOST')),
    CONSTRAINT ck_crm_tender_profiles_price CHECK (winning_price IS NULL OR winning_price >= 0),
    CONSTRAINT ck_crm_tender_profiles_version CHECK (version >= 1)
);

-- Nhắc hạn nộp (P2E-05) và báo cáo thầu (P2E-07): hồ sơ chưa nộp, chưa có kết quả, theo hạn.
CREATE INDEX IF NOT EXISTS ix_crm_tender_profiles_deadline
    ON crm_schema.tender_profiles (submission_deadline)
    WHERE submission_deadline IS NOT NULL AND submitted_at IS NULL AND result IS NULL;
CREATE INDEX IF NOT EXISTS ix_crm_tender_profiles_result ON crm_schema.tender_profiles (result);

-- ---------------------------------------------------------------------------
-- ĐỐI TÁC LIÊN DANH: danh sách đơn giản (tên, phạm vi đảm nhận), không quản lý quan hệ đối tác.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.tender_partners (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES crm_schema.tender_profiles (id) ON DELETE CASCADE,
    name       VARCHAR(300) NOT NULL,
    scope      VARCHAR(1000),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_crm_tender_partners_profile ON crm_schema.tender_partners (profile_id, sort_order, created_at);

-- ---------------------------------------------------------------------------
-- CÁC VÒNG DUYỆT PHƯƠNG ÁN CHÀO THẦU
--
-- Mỗi lần trình là một vòng (số vòng tăng dần); vòng đã quyết định không sửa nữa. `via`: DIRECT (duyệt trực
-- tiếp trong CRM) hoặc PROCEDURE (qua Quy trình, có dòng `procedure_links` với source_id = id vòng).
-- Chụp lại kịch bản và liên danh tại lúc trình để lịch sử đúng với từng vòng.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.tender_plan_rounds (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id        UUID NOT NULL REFERENCES crm_schema.tender_profiles (id) ON DELETE CASCADE,
    round_no          INTEGER NOT NULL,
    via               VARCHAR(12) NOT NULL,
    has_joint_venture BOOLEAN NOT NULL DEFAULT false,
    scenario          VARCHAR(4000),
    partner_count     INTEGER NOT NULL DEFAULT 0,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_by      UUID NOT NULL,
    decided_at        TIMESTAMPTZ,
    decided_by        UUID,
    decision          VARCHAR(12),
    reason            VARCHAR(2000),

    CONSTRAINT uq_crm_tender_plan_rounds_no UNIQUE (profile_id, round_no),
    CONSTRAINT ck_crm_tender_plan_rounds_via CHECK (via IN ('DIRECT', 'PROCEDURE')),
    CONSTRAINT ck_crm_tender_plan_rounds_decision CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED'))
);

-- ---------------------------------------------------------------------------
-- MỞ RỘNG RÀNG BUỘC LOẠI
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    old RECORD;
BEGIN
    -- Loại duyệt: thêm TENDER_PLAN.
    FOR old IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'crm_schema.approval_bindings'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%ORDER_CREDIT%' AND conname <> 'ck_crm_approval_bindings_kind'
    LOOP
        EXECUTE format('ALTER TABLE crm_schema.approval_bindings DROP CONSTRAINT %I', old.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_approval_bindings_kind') THEN
        ALTER TABLE crm_schema.approval_bindings
            ADD CONSTRAINT ck_crm_approval_bindings_kind CHECK (kind IN ('QUOTE', 'ORDER_CREDIT', 'TENDER_PLAN'));
    END IF;

    -- Nguồn phiên Quy trình: thêm crm_tender_plan.
    FOR old IN
        SELECT conname FROM pg_constraint
         WHERE conrelid = 'crm_schema.procedure_links'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%crm_order_credit%' AND conname <> 'ck_crm_procedure_links_source_type'
    LOOP
        EXECUTE format('ALTER TABLE crm_schema.procedure_links DROP CONSTRAINT %I', old.conname);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_procedure_links_source_type') THEN
        ALTER TABLE crm_schema.procedure_links
            ADD CONSTRAINT ck_crm_procedure_links_source_type
            CHECK (source_type IN ('crm_quote', 'crm_order_credit', 'crm_tender_plan'));
    END IF;

    -- Điều kiện chuyển giai đoạn: thêm TENDER_PLAN_APPROVED (phương án chào thầu đã duyệt) và
    -- TENDER_FIELD (`ref` là tên trường hồ sơ thầu, phải có giá trị).
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_pipeline_stage_requirements_kind'
                  AND pg_get_constraintdef(oid) NOT LIKE '%TENDER_FIELD%') THEN
        ALTER TABLE crm_schema.pipeline_stage_requirements DROP CONSTRAINT ck_crm_pipeline_stage_requirements_kind;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_pipeline_stage_requirements_kind') THEN
        ALTER TABLE crm_schema.pipeline_stage_requirements
            ADD CONSTRAINT ck_crm_pipeline_stage_requirements_kind
            CHECK (kind IN ('DOCUMENT_TYPE', 'FIELD', 'QUOTE_APPROVED', 'REASON', 'TENDER_PLAN_APPROVED', 'TENDER_FIELD'));
    END IF;
END $$;
