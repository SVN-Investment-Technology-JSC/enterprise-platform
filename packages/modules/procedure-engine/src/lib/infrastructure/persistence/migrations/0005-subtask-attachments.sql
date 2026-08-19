-- Đính kèm gắn vào từng đầu việc E(x): người thực hiện phải nộp bằng chứng
-- (ảnh hoặc văn bản) trước khi được đánh dấu xong.
ALTER TABLE procedure_schema.attachments
  ADD COLUMN IF NOT EXISTS subtask_id UUID;

CREATE INDEX IF NOT EXISTS idx_procedure_attachments_subtask
  ON procedure_schema.attachments (subtask_id)
  WHERE subtask_id IS NOT NULL;

-- Tên người được phân rã, chụp lại lúc gán để hiển thị không cần tra lại Core.
ALTER TABLE procedure_schema.subtasks
  ADD COLUMN IF NOT EXISTS assignee_name VARCHAR(180);
