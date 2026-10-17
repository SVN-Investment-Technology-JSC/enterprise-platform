-- 0011: quyền vào module suy ra từ action, không còn cấp riêng qua role_modules.
-- Có bất kỳ action nào của module là vào được module đó (tenant có được dùng module hay không do gói quyết định).
-- Riêng Quy trình có người chỉ xử lý hồ sơ theo RACI, không cần action nào, nên thêm action `procedure.access`.
-- Vai trò (không phải quản trị) đang có module Quy trình hoặc '*' nhận action này qua một permission hệ thống để giữ
-- nguyên quyền hiện có. Các module khác trước đây vẫn đòi action cụ thể nên không đổi hành vi.
-- Chỉ chạy một lần: permission đã tồn tại thì bỏ qua, nên chạy lại không phục hồi quyền đã thu hồi.
-- Bảng role_modules được giữ nguyên để đối chiếu nhưng mã nguồn không còn đọc hay ghi.
DO $$
DECLARE
  pid constant uuid := 'a1000000-0000-4000-8000-000000000011';
BEGIN
  IF EXISTS (SELECT 1 FROM core_schema.permissions WHERE id = pid) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core_schema.role_modules rm
    JOIN core_schema.roles r ON r.id = rm.role_id
    WHERE rm.module_key IN ('*', 'procedure-engine') AND r.key <> 'tenant-admin'
  ) THEN
    RETURN;
  END IF;
  INSERT INTO core_schema.permissions(id, name, description)
  VALUES (pid, 'Truy cập Quy trình (hệ thống)',
          'Vào Quy trình, xem quy trình đã công bố và xử lý hồ sơ theo vai RACI. Tạo tự động khi bỏ bước cấp module cho vai trò.');
  INSERT INTO core_schema.permission_actions(permission_id, action_key) VALUES (pid, 'procedure.access');
  INSERT INTO core_schema.role_permissions(role_id, permission_id)
  SELECT DISTINCT rm.role_id, pid
  FROM core_schema.role_modules rm
  JOIN core_schema.roles r ON r.id = rm.role_id
  WHERE rm.module_key IN ('*', 'procedure-engine') AND r.key <> 'tenant-admin'
  ON CONFLICT DO NOTHING;
END $$;
