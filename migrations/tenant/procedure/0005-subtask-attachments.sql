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

-- `synchronizeNormalized` xoá rồi dựng lại toàn bộ step_instances mỗi lần ghi
-- (nguồn sự thật là runtime_state jsonb). Id của bước là ổn định, nhưng FK
-- non-deferrable kiểm ngay lúc DELETE nên hồ sơ đã có đính kèm gắn bước sẽ vỡ ở
-- mọi lần ghi kế tiếp. Hoãn kiểm tới lúc COMMIT: khi đó các bước đã được chèn lại.
ALTER TABLE procedure_schema.attachments
  DROP CONSTRAINT IF EXISTS attachments_step_instance_id_fkey;

ALTER TABLE procedure_schema.attachments
  ADD CONSTRAINT attachments_step_instance_id_fkey
  FOREIGN KEY (step_instance_id) REFERENCES procedure_schema.step_instances(id)
  DEFERRABLE INITIALLY DEFERRED;
