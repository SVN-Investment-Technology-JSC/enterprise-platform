-- Cấu hình duyệt trực tiếp (mode DIRECT) chọn được NGUỒN người duyệt:
--  - DIRECT_MANAGER (mặc định, hành vi cũ): quản lý trực tiếp của người làm đơn theo sơ đồ tổ chức;
--  - POSITION: người đang giữ chức danh được chỉ định (approver_position_id).
-- Chức danh duyệt dự phòng (fallback_position_id) vẫn tuỳ chọn ở cả hai nguồn. Bản ghi cũ giữ DIRECT_MANAGER.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.request_procedure_bindings
  ADD COLUMN IF NOT EXISTS direct_approver_source text NOT NULL DEFAULT 'DIRECT_MANAGER',
  ADD COLUMN IF NOT EXISTS approver_position_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'request_procedure_bindings_direct_approver_chk'
  ) THEN
    ALTER TABLE hrm_schema.request_procedure_bindings
      ADD CONSTRAINT request_procedure_bindings_direct_approver_chk
      CHECK (
        direct_approver_source IN ('DIRECT_MANAGER', 'POSITION')
        AND (direct_approver_source = 'POSITION') = (approver_position_id IS NOT NULL)
      );
  END IF;
END $$;
