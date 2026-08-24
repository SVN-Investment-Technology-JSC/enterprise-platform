-- Đính kèm bị xoá sạch sau mỗi lần ghi hồ sơ.
--
-- `synchronizeNormalized()` dựng lại toàn bộ bảng chuẩn hoá từ runtime_state, và
-- bước đầu là `DELETE FROM procedure_schema.instances`. FK cũ của attachments là
-- ON DELETE CASCADE nên mọi dòng đính kèm bị cuốn theo — im lặng, không báo lỗi.
-- Object vẫn nằm lại trong S3 và trở thành rác mồ côi.
--
-- Id của instance là ổn định (nằm trong runtime_state) và được chèn lại ngay
-- trong cùng transaction, nên hoãn kiểm tới COMMIT là đủ và đúng. Bỏ CASCADE:
-- không có đường nào xoá instance thật sự, nên nếu sau này có thì thà lỗi ở
-- COMMIT còn hơn âm thầm mất hồ sơ bằng chứng.
--
-- Cùng cách xử lý đã dùng cho step_instance_id ở 0005.

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

-- Cùng lý do, cho FK trỏ tới instances. Đây mới là chỗ gây mất dữ liệu thật sự
-- vì nó là ON DELETE CASCADE: mọi lần ghi đều cuốn sạch dòng đính kèm.
ALTER TABLE procedure_schema.attachments
  DROP CONSTRAINT IF EXISTS attachments_instance_id_fkey;

ALTER TABLE procedure_schema.attachments
  ADD CONSTRAINT attachments_instance_id_fkey
  FOREIGN KEY (instance_id) REFERENCES procedure_schema.instances(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_procedure_attachments_step
  ON procedure_schema.attachments (instance_id, step_instance_id);
