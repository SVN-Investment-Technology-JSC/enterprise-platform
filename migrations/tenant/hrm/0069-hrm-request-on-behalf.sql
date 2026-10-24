-- Tạo đơn hộ nhân viên cho nghỉ phép, tăng ca, công tác: ghi lại ai là người gửi thật, đánh dấu đơn tạo hộ kèm lý do,
-- và bảng cấu hình phạm vi được tạo hộ theo từng tenant. Đơn cũ giữ nguyên: submitted_by NULL và created_on_behalf = false
-- nghĩa là nhân viên tự gửi. Chỉ thêm cột và bảng mới nên bản app cũ vẫn chạy được.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.leave_requests
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS created_on_behalf boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_behalf_reason text,
  ADD COLUMN IF NOT EXISTS on_behalf_by_name text;

ALTER TABLE hrm_schema.ot_requests
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS created_on_behalf boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_behalf_reason text,
  ADD COLUMN IF NOT EXISTS on_behalf_by_name text;

ALTER TABLE hrm_schema.business_trip_requests
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS created_on_behalf boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_behalf_reason text,
  ADD COLUMN IF NOT EXISTS on_behalf_by_name text;

-- Phạm vi tạo hộ. grantee_user_id NULL = áp cho mọi người có quyền hrm.request.create.behalf; có giá trị = chỉ áp cho
-- tài khoản đó. Nhiều dòng cùng áp cho một người thì lấy hợp các phạm vi. Người có hrm.request.create.behalf.all không
-- bị giới hạn bởi bảng này. Không có dòng nào áp thì mặc định chỉ tạo hộ cấp dưới (theo sơ đồ tổ chức).
CREATE TABLE IF NOT EXISTS hrm_schema.request_proxy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  grantee_user_id uuid,
  request_kinds text[] NOT NULL,
  scope_type text NOT NULL,
  unit_ids uuid[] NOT NULL DEFAULT '{}',
  employee_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT request_proxy_rules_scope_type CHECK (scope_type IN ('SUBORDINATES', 'SAME_UNIT', 'UNIT_LIST', 'EMPLOYEE_LIST', 'ALL')),
  CONSTRAINT request_proxy_rules_kinds CHECK (
    cardinality(request_kinds) > 0 AND request_kinds <@ ARRAY['leave', 'ot', 'business_trip']::text[]
  )
);

CREATE INDEX IF NOT EXISTS request_proxy_rules_tenant_idx
  ON hrm_schema.request_proxy_rules (tenant_id, grantee_user_id)
  WHERE deleted_at IS NULL;
