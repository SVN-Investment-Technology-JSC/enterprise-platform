-- Cách tính tiến độ của công việc (bám 1Office), chọn lúc tạo hoặc sửa công việc:
--  · 'manual'       theo % người dùng tự báo (mặc định, hành vi từ trước tới nay);
--  · 'quantity'     theo khối lượng đã làm / khối lượng cần làm (quantity_done / quantity_target, kèm đơn vị);
--  · 'checklist'    theo tỷ lệ đầu việc đã tích (bảng work_item_checklist_items);
--  · 'child_weight' việc cha tính theo tỷ trọng của các việc con (work_items.weight của con); equal_child_weight = true
--                   thì chia đều, bỏ qua tỷ trọng.
-- Mặc định 'manual' nên mọi công việc có sẵn (và công việc do bản app cũ tạo, không biết các cột này) giữ nguyên số liệu.
-- Bản app cũ bỏ qua các cột và bảng mới.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.work_items
    ADD COLUMN IF NOT EXISTS progress_method VARCHAR(20) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS quantity_target NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS quantity_unit   VARCHAR(30),
    ADD COLUMN IF NOT EXISTS quantity_done   NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS equal_child_weight BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_work_items_progress_method') THEN
        ALTER TABLE workspace_schema.work_items
            ADD CONSTRAINT chk_work_items_progress_method
            CHECK (progress_method IN ('manual', 'quantity', 'checklist', 'child_weight'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_work_items_quantity') THEN
        ALTER TABLE workspace_schema.work_items
            ADD CONSTRAINT chk_work_items_quantity
            CHECK ((quantity_target IS NULL OR quantity_target > 0) AND quantity_done >= 0);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspace_schema.work_item_checklist_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    title        VARCHAR(200) NOT NULL,
    done         BOOLEAN NOT NULL DEFAULT FALSE,
    done_at      TIMESTAMPTZ,
    done_by      UUID,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_item_checklist_items_item
    ON workspace_schema.work_item_checklist_items (work_item_id, sort_order, created_at);

-- Báo cáo theo khối lượng ghi thêm khối lượng đã làm tại thời điểm báo.
ALTER TABLE workspace_schema.work_item_progress_reports
    ADD COLUMN IF NOT EXISTS quantity_done NUMERIC(14, 2);
