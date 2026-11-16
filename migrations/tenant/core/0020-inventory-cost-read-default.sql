-- 0020: Kho tách quyền xem giá vốn thành action riêng `inventory.cost.read` (ISS-BE-013). Theo quyết định nghiệp vụ,
-- người đang ghi phát sinh kho (Thủ kho) vẫn được thấy giá vốn, nhưng quản trị tenant có thể gỡ trên màn Phân quyền:
--   1. Tạo permission hệ thống "Xem giá vốn kho (hệ thống)" gồm `inventory.cost.read` và gán cho mọi vai trò đang có
--      `inventory.transaction.write`.
--   2. Người được cấp trực tiếp `inventory.transaction.write` (quyền bổ sung) nhận thêm `inventory.cost.read` dưới dạng
--      quyền bổ sung (granted_by NULL = hệ thống).
-- `inventory.manage` đã bao hàm `inventory.cost.read` nên không cần gán cho vai trò quản lý kho.
-- Chỉ chạy một lần: permission đã tồn tại thì bỏ qua, nên chạy lại không phục hồi quyền quản trị viên đã thu hồi.
-- Trigger của 0005/0013 tăng revision phân quyền.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  pid constant uuid := 'a1000000-0000-4000-8000-000000000020';
  pname constant varchar := 'Xem giá vốn kho (hệ thống)';
BEGIN
  IF EXISTS (SELECT 1 FROM core_schema.permissions WHERE id = pid OR lower(name) = lower(pname)) THEN
    RETURN;
  END IF;

  INSERT INTO core_schema.permissions(id, name, description)
  VALUES (pid, pname,
          'Xem giá vốn, giá trị tồn kho và nguồn giữ hàng. Tạo tự động cho vai trò ghi phát sinh kho khi Kho tách quyền xem giá vốn; quản trị tenant có thể gỡ.');
  INSERT INTO core_schema.permission_actions(permission_id, action_key)
  VALUES (pid, 'inventory.cost.read')
  ON CONFLICT DO NOTHING;

  INSERT INTO core_schema.role_permissions(role_id, permission_id)
  SELECT DISTINCT rp.role_id, pid
  FROM core_schema.role_permissions rp
  JOIN core_schema.permission_actions pa ON pa.permission_id = rp.permission_id
  WHERE pa.action_key = 'inventory.transaction.write'
  ON CONFLICT DO NOTHING;

  INSERT INTO core_schema.user_permission_grants(user_id, action_key, granted_by)
  SELECT DISTINCT g.user_id, 'inventory.cost.read', NULL::uuid
  FROM core_schema.user_permission_grants g
  WHERE g.action_key = 'inventory.transaction.write'
  ON CONFLICT DO NOTHING;
END $$;
