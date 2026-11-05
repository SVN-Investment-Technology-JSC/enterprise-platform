-- Bán hàng (crm) · kế hoạch giai đoạn của dự án bán hàng (GĐB, P2B-13): mỗi cơ hội có một dòng
-- cho từng giai đoạn áp dụng (người đảm nhận, trạng thái, bỏ qua, hạn); giai đoạn thêm cờ
-- `skippable` (bỏ qua được) và quy tắc gán người mặc định (`assignee_rule`, `assignee_param`).
-- Dữ liệu cũ: mọi cơ hội có sẵn được lập kế hoạch cho mọi giai đoạn của luồng (áp dụng hết, chưa
-- gán người); giai đoạn hiện tại ACTIVE (cơ hội đã Thắng/Thua thì giai đoạn hiện tại là DONE),
-- giai đoạn đứng trước theo thứ tự là DONE, còn lại PENDING.
-- Chạy lại được: IF NOT EXISTS, backfill chỉ thêm dòng còn thiếu (ON CONFLICT DO NOTHING).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- `assignee_rule`: NONE (không gán), FIXED_USER (`assignee_param` = id người dùng), PROJECT_OWNER
-- (chủ dự án), DIRECT_MANAGER (quản lý trực tiếp của chủ dự án), MANAGER_LEVEL (`assignee_param`
-- = số bậc cấp trên, 1 trở lên), POSITION (`assignee_param` = id chức danh trong sơ đồ tổ chức,
-- gán người đang giữ chức danh). Quy tắc chỉ là mặc định, người có quyền ghi đè từng dự án.
ALTER TABLE crm_schema.pipeline_stages
    ADD COLUMN IF NOT EXISTS skippable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS assignee_rule VARCHAR(24) NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS assignee_param VARCHAR(100);

ALTER TABLE crm_schema.pipeline_stages DROP CONSTRAINT IF EXISTS ck_crm_pipeline_stages_assignee_rule;
ALTER TABLE crm_schema.pipeline_stages
    ADD CONSTRAINT ck_crm_pipeline_stages_assignee_rule
    CHECK (assignee_rule IN ('NONE', 'FIXED_USER', 'PROJECT_OWNER', 'DIRECT_MANAGER', 'MANAGER_LEVEL', 'POSITION'));

-- ---------------------------------------------------------------------------
-- KẾ HOẠCH GIAI ĐOẠN CỦA CƠ HỘI
--
-- `status`: PENDING (chưa tới), ACTIVE (đang ở giai đoạn này), DONE (đã qua), SKIPPED (bỏ qua,
-- cần `skipped_reason`). `assignee_user_id` rỗng = chưa gán. `assigned_by`, `assigned_at` ghi
-- lần gán hoặc ghi đè gần nhất; `assignee_warning` là lý do chưa gán được người theo quy tắc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_schema.opportunity_stage_plan (
    opportunity_id   UUID NOT NULL REFERENCES crm_schema.opportunities (id) ON DELETE CASCADE,
    stage_id         UUID NOT NULL REFERENCES crm_schema.pipeline_stages (id) ON DELETE RESTRICT,
    assignee_user_id UUID,
    status           VARCHAR(8) NOT NULL DEFAULT 'PENDING',
    skipped_reason   VARCHAR(2000),
    skipped_by       UUID,
    skipped_at       TIMESTAMPTZ,
    due_date         DATE,
    assigned_by      UUID,
    assigned_at      TIMESTAMPTZ,
    assignee_warning VARCHAR(500),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (opportunity_id, stage_id),
    CONSTRAINT ck_crm_opportunity_stage_plan_status CHECK (status IN ('PENDING', 'ACTIVE', 'DONE', 'SKIPPED')),
    CONSTRAINT ck_crm_opportunity_stage_plan_skipped
        CHECK (status <> 'SKIPPED' OR (skipped_reason IS NOT NULL AND btrim(skipped_reason) <> ''))
);

ALTER TABLE crm_schema.opportunity_stage_plan ADD COLUMN IF NOT EXISTS assignee_warning VARCHAR(500);

-- Tìm dự án theo người được gán (lọc phạm vi "việc của tôi").
CREATE INDEX IF NOT EXISTS ix_crm_opportunity_stage_plan_assignee
    ON crm_schema.opportunity_stage_plan (assignee_user_id, opportunity_id);
CREATE INDEX IF NOT EXISTS ix_crm_opportunity_stage_plan_stage
    ON crm_schema.opportunity_stage_plan (stage_id);

INSERT INTO crm_schema.opportunity_stage_plan (opportunity_id, stage_id, status)
SELECT o.id, s.id,
       CASE
           WHEN s.id = o.stage_id AND cur.semantic = 'OPEN' THEN 'ACTIVE'
           WHEN s.id = o.stage_id THEN 'DONE'
           WHEN s.sort_order < cur.sort_order AND s.semantic = 'OPEN' THEN 'DONE'
           ELSE 'PENDING'
       END
  FROM crm_schema.opportunities o
  JOIN crm_schema.pipeline_stages cur ON cur.id = o.stage_id
  JOIN crm_schema.pipeline_stages s ON s.pipeline_id = o.pipeline_id
ON CONFLICT (opportunity_id, stage_id) DO NOTHING;
