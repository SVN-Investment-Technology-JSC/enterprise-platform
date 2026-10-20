-- 0013: quyền hạn bổ sung gán thẳng cho người dùng, ngoài các vai trò đang gán.
-- Quyền hiệu lực = hợp quyền từ vai trò và quyền ở bảng này. Mỗi dòng là một action trong TENANT_PERMISSION_ACTIONS
-- (API kiểm khoá hợp lệ). Đổi hay gỡ vai trò không đụng tới bảng này; gỡ quyền bổ sung là xoá dòng tương ứng.
-- Gắn trigger tăng revision (hàm của 0012) nên cache quyền bị vô hiệu và sự kiện core.authorization.changed được phát.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_schema.user_permission_grants (
  user_id uuid NOT NULL REFERENCES core_schema.users(id) ON DELETE CASCADE,
  action_key varchar(100) NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action_key)
);
CREATE INDEX IF NOT EXISTS user_permission_grants_action_idx
  ON core_schema.user_permission_grants(action_key);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'rbac_revision_user_permission_grants'
      AND tgrelid = 'core_schema.user_permission_grants'::regclass
  ) THEN
    CREATE TRIGGER rbac_revision_user_permission_grants
      AFTER INSERT OR UPDATE OR DELETE ON core_schema.user_permission_grants
      FOR EACH STATEMENT EXECUTE FUNCTION core_schema.bump_authorization_revision();
  END IF;
END $$;
