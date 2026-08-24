-- Bảo trì sự cố và lịch sử bảo trì.
--
-- Tới nay mọi occurrence đều do một lịch định kỳ sinh ra, nên `schedule_id` là
-- NOT NULL và tiêu đề/thiết bị đều lấy từ lịch cha. Sự cố thì không có lịch nào
-- cả: nó phải tự mang tiêu đề và mã thiết bị.

ALTER TABLE maintenance_schema.occurrences
  ALTER COLUMN schedule_id DROP NOT NULL;

ALTER TABLE maintenance_schema.occurrences
  ADD COLUMN IF NOT EXISTS kind varchar(20) NOT NULL DEFAULT 'preventive',
  ADD COLUMN IF NOT EXISTS code varchar(100),
  ADD COLUMN IF NOT EXISTS title varchar(255),
  ADD COLUMN IF NOT EXISTS asset_code varchar(80),
  ADD COLUMN IF NOT EXISTS description text,
  -- Sự cố không có lịch để đọc quy trình xử lý, nên tự giữ lấy.
  ADD COLUMN IF NOT EXISTS procedure_definition_id uuid,
  ADD COLUMN IF NOT EXISTS assignee_id uuid,
  ADD COLUMN IF NOT EXISTS assignee_name varchar(180),
  ADD COLUMN IF NOT EXISTS completion_note text,
  ADD COLUMN IF NOT EXISTS completed_by uuid,
  ADD COLUMN IF NOT EXISTS completed_by_name varchar(180),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS created_by_name varchar(180);

ALTER TABLE maintenance_schema.occurrences
  DROP CONSTRAINT IF EXISTS maintenance_occurrence_kind_check;
ALTER TABLE maintenance_schema.occurrences
  ADD CONSTRAINT maintenance_occurrence_kind_check CHECK (kind IN ('preventive','incident'));

-- Định kỳ phải có lịch; sự cố phải tự mang tiêu đề và thiết bị. Không có ràng
-- buộc này thì một dòng thiếu cả hai sẽ lọt xuống và hiện ra trống trơn trên UI.
ALTER TABLE maintenance_schema.occurrences
  DROP CONSTRAINT IF EXISTS maintenance_occurrence_origin_check;
ALTER TABLE maintenance_schema.occurrences
  ADD CONSTRAINT maintenance_occurrence_origin_check CHECK (
    (kind = 'preventive' AND schedule_id IS NOT NULL)
 OR (kind = 'incident'  AND title IS NOT NULL AND asset_code IS NOT NULL));

-- 'in_progress' cho sự cố đang xử lý. Không mượn 'planned' được vì KPI
-- "Sắp đến hạn" đếm theo trạng thái đó — một sự cố đang xử lý sẽ thổi phồng nó.
ALTER TABLE maintenance_schema.occurrences
  DROP CONSTRAINT IF EXISTS maintenance_occurrence_status_check;
ALTER TABLE maintenance_schema.occurrences
  ADD CONSTRAINT maintenance_occurrence_status_check
  CHECK (status IN ('planned','in_progress','dispatch_pending','generated','completed','failed','blocked'));

-- UNIQUE (schedule_id, due_at) sẵn có KHÔNG cần đụng: trong unique btree của
-- Postgres các NULL được coi là khác nhau, nên nhiều sự cố cùng thời điểm vẫn chèn được.

CREATE UNIQUE INDEX IF NOT EXISTS maintenance_occurrence_code_idx
  ON maintenance_schema.occurrences (code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS maintenance_occurrence_history_idx
  ON maintenance_schema.occurrences (due_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS maintenance_occurrence_asset_idx
  ON maintenance_schema.occurrences (asset_code);
