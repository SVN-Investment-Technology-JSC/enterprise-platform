SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Hạn mức số đơn ĐÃ DUYỆT của một nhân viên trong một tháng, đặt riêng theo từng loại đơn (type_code = mã loại đơn trong
-- request_reason_categories, ví dụ LEAVE, OVERTIME hoặc mã loại tự tạo). Không có dòng cho loại đơn = không giới hạn.
-- Tháng tính theo thời điểm tạo đơn (múi giờ Asia/Ho_Chi_Minh). Đủ hạn mức thì không tạo thêm đơn và đơn đang chờ không
-- duyệt được nữa.
CREATE TABLE IF NOT EXISTS hrm_schema.request_quota_settings (
  tenant_id uuid NOT NULL,
  type_code varchar(50) NOT NULL,
  monthly_limit integer NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, type_code),
  CONSTRAINT request_quota_settings_limit CHECK (monthly_limit > 0 AND monthly_limit <= 1000)
);
