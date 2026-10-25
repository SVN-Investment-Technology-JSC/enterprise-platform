-- Quy tắc thời gian theo từng loại đơn. Mỗi cột NULL (mặc định, không có dòng) = chưa dùng quy tắc đó.
--   min_notice_days     : phải tạo đơn trước ngày ghi trên đơn (ngày bắt đầu) ít nhất N ngày.
--   max_backdate_days   : không được tạo đơn cho ngày đã qua quá N ngày.
--   escalate_after_days : đơn chờ quá N ngày thì người giữ chức danh dự phòng mới được xử lý (trước đó chỉ người duyệt chính).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS hrm_schema.request_time_rules (
  tenant_id uuid NOT NULL,
  request_kind text NOT NULL,
  min_notice_days integer,
  max_backdate_days integer,
  escalate_after_days integer,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, request_kind),
  CONSTRAINT request_time_rules_kind CHECK (
    request_kind IN ('leave', 'ot', 'business_trip', 'shift_change', 'correction', 'advance', 'profile_correction', 'custom')
  ),
  CONSTRAINT request_time_rules_min_notice CHECK (min_notice_days IS NULL OR min_notice_days BETWEEN 0 AND 365),
  CONSTRAINT request_time_rules_max_backdate CHECK (max_backdate_days IS NULL OR max_backdate_days BETWEEN 0 AND 365),
  CONSTRAINT request_time_rules_escalate CHECK (escalate_after_days IS NULL OR escalate_after_days BETWEEN 1 AND 90)
);
