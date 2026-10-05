-- FIX-E-07: chính sách duyệt đơn chế độ DIRECT.
-- allow_self_approval: ngoại lệ theo tenant cho phép người duyệt tự duyệt đơn của chính mình.
-- Mặc định FALSE (không có dòng = FALSE): chặn tự duyệt (403 SELF_APPROVAL_FORBIDDEN).
CREATE TABLE IF NOT EXISTS hrm_schema.approval_policy_settings (
  tenant_id uuid PRIMARY KEY,
  allow_self_approval boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
