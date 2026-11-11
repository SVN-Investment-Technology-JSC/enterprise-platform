-- CRM · PAKD trình riêng qua Quy trình và thông tin nguồn gửi Quy trình (phase 3, plan mục 17.2, 17.3; D3-30, D3-31).
-- - Loại duyệt `BUSINESS_PLAN` (approval_bindings) và nguồn phiên Quy trình `crm_business_plan` (procedure_links,
--   source_id là id vòng duyệt `business_plan_rounds`).
-- - `procedure_links.source_summary_synced_at`: lúc đã gửi thông tin nguồn cho hồ sơ (khi tạo hoặc bổ sung sau); rỗng là
--   chưa gửi, worker bổ sung một lần cho hồ sơ đang chạy.
-- Tương thích ngược: chỉ nới ràng buộc và thêm cột cho phép rỗng; bản app cũ không ghi giá trị mới. Chạy lại được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_schema.procedure_links ADD COLUMN IF NOT EXISTS source_summary_synced_at TIMESTAMPTZ;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_approval_bindings_kind'
                  AND pg_get_constraintdef(oid) NOT LIKE '%BUSINESS_PLAN%') THEN
        ALTER TABLE crm_schema.approval_bindings DROP CONSTRAINT ck_crm_approval_bindings_kind;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_approval_bindings_kind') THEN
        ALTER TABLE crm_schema.approval_bindings
            ADD CONSTRAINT ck_crm_approval_bindings_kind
            CHECK (kind IN ('QUOTE', 'ORDER_CREDIT', 'TENDER_PLAN', 'BUSINESS_PLAN'));
    END IF;

    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_procedure_links_source_type'
                  AND pg_get_constraintdef(oid) NOT LIKE '%crm_business_plan%') THEN
        ALTER TABLE crm_schema.procedure_links DROP CONSTRAINT ck_crm_procedure_links_source_type;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_crm_procedure_links_source_type') THEN
        ALTER TABLE crm_schema.procedure_links
            ADD CONSTRAINT ck_crm_procedure_links_source_type
            CHECK (source_type IN ('crm_quote', 'crm_order_credit', 'crm_tender_plan', 'crm_business_plan'));
    END IF;
END $$;

-- Worker tìm hồ sơ đang chạy chưa có thông tin nguồn (báo giá, PAKD).
CREATE INDEX IF NOT EXISTS ix_crm_procedure_links_summary_due
    ON crm_schema.procedure_links (updated_at)
    WHERE status = 'RUNNING' AND source_summary_synced_at IS NULL
      AND source_type IN ('crm_quote', 'crm_business_plan');
