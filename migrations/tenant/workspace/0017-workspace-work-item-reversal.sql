-- Huỷ hiệu lực công việc đã hoàn thành: công việc không mở lại, chuyển
-- `cancelled` kèm dấu huỷ hiệu lực, giữ nguyên lịch sử. Dùng `cancelled` để
-- tiến độ, tài chính, báo cáo đã loại việc huỷ thì loại luôn việc này.
ALTER TABLE workspace_schema.work_items
  ADD COLUMN IF NOT EXISTS reversed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by          UUID,
  ADD COLUMN IF NOT EXISTS reversed_by_name     VARCHAR(200),
  ADD COLUMN IF NOT EXISTS reversal_reason      TEXT,
  ADD COLUMN IF NOT EXISTS adjustment_requested BOOLEAN NOT NULL DEFAULT false,
  -- Công việc điều chỉnh trỏ về công việc đã huỷ hiệu lực.
  ADD COLUMN IF NOT EXISTS adjustment_of_id     UUID REFERENCES workspace_schema.work_items(id);

ALTER TABLE workspace_schema.work_items
  DROP CONSTRAINT IF EXISTS work_items_reversal_consistent;
ALTER TABLE workspace_schema.work_items
  ADD CONSTRAINT work_items_reversal_consistent
  CHECK (reversed_at IS NULL OR (status = 'cancelled' AND reversal_reason IS NOT NULL));

-- Mỗi công việc đã huỷ hiệu lực chỉ có một công việc điều chỉnh còn hiệu lực.
CREATE UNIQUE INDEX IF NOT EXISTS work_items_one_open_adjustment
  ON workspace_schema.work_items (adjustment_of_id)
  WHERE adjustment_of_id IS NOT NULL AND status <> 'cancelled';
