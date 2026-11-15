-- 0019: Mạng nội bộ bắt đầu thực thi `social.read` và `social.post.write` (ISS-BE-068). Trước đây guard đặt cứng hai
-- quyền này là true nên mọi người dùng tenant đều đọc và đăng bài được. Để người dùng hiện có không mất quyền:
--   1. Tạo permission hệ thống "Mạng nội bộ cơ bản (hệ thống)" gồm hai action trên và gán cho vai trò mặc định
--      `tenant-user` ("Nhân viên mặc định", id a0000000-...-0002).
--   2. Người dùng không phải quản trị tenant mà chưa có quyền đăng bài qua vai trò hay quyền bổ sung (ví dụ người được
--      tạo sau lần khởi tạo phân quyền nên không có vai trò nào) nhận hai action này dưới dạng quyền bổ sung
--      (`user_permission_grants`, granted_by NULL = hệ thống).
-- Chỉ chạy một lần: permission đã tồn tại thì bỏ qua, nên chạy lại (lúc tạo tenant mới, identity chạy lại toàn bộ core
-- không ghi ledger) không phục hồi quyền quản trị viên đã thu hồi. Trigger của 0005/0013 tăng revision phân quyền.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  pid constant uuid := 'a1000000-0000-4000-8000-000000000019';
  pname constant varchar := 'Mạng nội bộ cơ bản (hệ thống)';
BEGIN
  IF EXISTS (SELECT 1 FROM core_schema.permissions WHERE id = pid OR lower(name) = lower(pname)) THEN
    RETURN;
  END IF;

  INSERT INTO core_schema.permissions(id, name, description)
  VALUES (pid, pname,
          'Xem bảng tin, đăng bài, bình luận và phản ứng trên Mạng nội bộ. Tạo tự động khi Mạng nội bộ bắt đầu kiểm quyền.');
  INSERT INTO core_schema.permission_actions(permission_id, action_key)
  VALUES (pid, 'social.read'), (pid, 'social.post.write')
  ON CONFLICT DO NOTHING;

  INSERT INTO core_schema.role_permissions(role_id, permission_id)
  SELECT r.id, pid FROM core_schema.roles r WHERE r.key = 'tenant-user'
  ON CONFLICT DO NOTHING;

  INSERT INTO core_schema.user_permission_grants(user_id, action_key, granted_by)
  SELECT u.id, a.action_key, NULL
  FROM core_schema.users u
  CROSS JOIN (VALUES ('social.read'), ('social.post.write')) AS a(action_key)
  WHERE NOT EXISTS (
      SELECT 1 FROM core_schema.user_roles ur
      JOIN core_schema.roles r ON r.id = ur.role_id
      WHERE ur.user_id = u.id AND r.key = 'tenant-admin'
    )
    AND NOT EXISTS (
      SELECT 1 FROM core_schema.user_roles ur
      JOIN core_schema.role_permissions rp ON rp.role_id = ur.role_id
      JOIN core_schema.permission_actions pa ON pa.permission_id = rp.permission_id
      WHERE ur.user_id = u.id
        AND pa.action_key IN ('social.post.write', 'social.post.moderate', 'social.manage')
    )
    AND NOT EXISTS (
      SELECT 1 FROM core_schema.user_permission_grants g
      WHERE g.user_id = u.id
        AND g.action_key IN ('social.post.write', 'social.post.moderate', 'social.manage')
    )
  ON CONFLICT DO NOTHING;
END $$;
