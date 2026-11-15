-- 0017: xoá người dùng thành xoá mềm (ISS-BE-035).
-- Trước đây xoá người dùng là DELETE, kéo theo (ON DELETE CASCADE) bổ nhiệm, thành viên chat, thông báo... của người
-- đó. Nay người dùng đã phát sinh dữ liệu chỉ được đánh dấu `deleted_at` (kèm is_active = false); danh sách người dùng
-- và đăng nhập bỏ qua dòng đã xoá mềm. Email vẫn giữ ràng buộc duy nhất, nên không tạo lại được người dùng trùng email.
-- Dòng cũ có deleted_at NULL (chưa xoá); bản app cũ không đọc cột này nên vẫn chạy được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE core_schema.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- Danh sách và tra cứu người dùng chỉ đọc dòng chưa xoá.
CREATE INDEX IF NOT EXISTS users_not_deleted_idx
  ON core_schema.users (created_at DESC)
  WHERE deleted_at IS NULL;
