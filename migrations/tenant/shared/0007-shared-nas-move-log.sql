-- Kho NAS: kéo thả để chuyển tệp, thư mục giữa các thư mục của NAS; nhật ký truy cập nhận thêm thao tác `move`.
-- Chỉ nới ràng buộc CHECK (thêm một giá trị), dòng cũ và bản app cũ không bị ảnh hưởng.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE shared_schema.nas_access_logs DROP CONSTRAINT IF EXISTS nas_access_logs_action_check;
ALTER TABLE shared_schema.nas_access_logs
    ADD CONSTRAINT nas_access_logs_action_check
    CHECK (action IN ('view', 'download', 'upload', 'create_folder', 'rename', 'move', 'delete'));
