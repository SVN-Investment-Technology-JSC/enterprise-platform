-- Điều kiện hoàn thành công việc: người tạo việc đặt các điều kiện (minh chứng, chứng từ) mà người nhận việc
-- phải xác nhận đủ trước khi bấm Hoàn thành.
--  · work_items.completion_rule: 'all' = đủ mọi điều kiện, 'at_least' = đủ ít nhất completion_min_required điều kiện,
--    'none' = có điều kiện để nhắc nhưng không bắt buộc điều kiện nào. Việc cũ nhận mặc định 'all' và không có điều
--    kiện nào, nên hành vi hoàn thành của việc cũ không đổi; bản app cũ bỏ qua các cột và bảng mới.
--  · work_item_completion_conditions: danh sách điều kiện của từng việc, tuỳ ý số lượng.
--  · work_item_status_history.completion_evidence: ảnh chụp điều kiện và những mục đã xác nhận ở lần hoàn thành đó,
--    giữ nguyên dù điều kiện bị sửa hay xoá về sau.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE workspace_schema.work_items
    ADD COLUMN IF NOT EXISTS completion_rule VARCHAR(16) NOT NULL DEFAULT 'all',
    ADD COLUMN IF NOT EXISTS completion_min_required SMALLINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_work_items_completion_rule'
    ) THEN
        ALTER TABLE workspace_schema.work_items
            ADD CONSTRAINT chk_work_items_completion_rule CHECK (
                completion_rule IN ('all', 'at_least', 'none')
                -- COALESCE: CHECK cho qua khi biểu thức ra NULL, nên 'at_least' thiếu số tối thiểu phải ép về false.
                AND (
                    (completion_rule = 'at_least' AND COALESCE(completion_min_required >= 1, false))
                    OR (completion_rule <> 'at_least' AND completion_min_required IS NULL)
                )
            );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspace_schema.work_item_completion_conditions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_item_id  UUID NOT NULL REFERENCES workspace_schema.work_items(id) ON DELETE CASCADE,
    label         VARCHAR(300) NOT NULL CHECK (length(btrim(label)) > 0),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_by    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_item_completion_conditions_item
    ON workspace_schema.work_item_completion_conditions (work_item_id, sort_order);

ALTER TABLE workspace_schema.work_item_status_history
    ADD COLUMN IF NOT EXISTS completion_evidence JSONB;
