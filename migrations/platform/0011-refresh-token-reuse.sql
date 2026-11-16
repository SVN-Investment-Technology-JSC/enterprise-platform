-- Phát hiện dùng lại refresh token đã xoay (ISS-BE-053).
--
-- Mỗi lần làm mới phiên, hash của refresh token vừa bị thay được giữ ở `previous_refresh_token_hash`. Token đó bị
-- gửi lại sau ân hạn vài giây nghĩa là có hai bên cùng giữ token (bị lộ), nên cả phiên bị thu hồi. Phiên cũ có cột
-- này NULL; chỉ thêm cột cho phép NULL và chỉ mục, bản app cũ không đọc cột này nên vẫn chạy bình thường.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE identity_schema.auth_sessions
  ADD COLUMN IF NOT EXISTS previous_refresh_token_hash char(64);

ALTER TABLE identity_schema.tenant_auth_sessions
  ADD COLUMN IF NOT EXISTS previous_refresh_token_hash char(64);

CREATE INDEX IF NOT EXISTS auth_sessions_previous_refresh_idx
  ON identity_schema.auth_sessions (previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_auth_sessions_previous_refresh_idx
  ON identity_schema.tenant_auth_sessions (previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;
