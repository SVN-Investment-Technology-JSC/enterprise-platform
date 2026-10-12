SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- HỆ SỐ TĂNG CA THEO LÝ DO. Lý do của đơn tăng ca (request_reasons, kind = OVERTIME) có hệ số cấu hình động; đơn tăng ca
-- lấy hệ số của lý do đã chọn để tính lương (ot_requests.ot_rate_multiplier -> WEIGHTED_OT_MINUTES). Lý do không đặt hệ số
-- (NULL) thì hệ số lấy theo chính sách OT (ngày thường / ngày nghỉ / lễ / đêm) như trước.
ALTER TABLE hrm_schema.request_reasons
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(4,2);
ALTER TABLE hrm_schema.request_reasons DROP CONSTRAINT IF EXISTS request_reasons_rate_multiplier_check;
ALTER TABLE hrm_schema.request_reasons ADD CONSTRAINT request_reasons_rate_multiplier_check
  CHECK (rate_multiplier IS NULL OR (rate_multiplier >= 1 AND rate_multiplier <= 10));
COMMENT ON COLUMN hrm_schema.request_reasons.rate_multiplier IS 'Hệ số tăng ca của lý do (1 đến 10); NULL = theo chính sách OT. Chỉ dùng cho kind OVERTIME';

ALTER TABLE hrm_schema.ot_requests
  ADD COLUMN IF NOT EXISTS rate_source varchar(20) NOT NULL DEFAULT 'POLICY';
ALTER TABLE hrm_schema.ot_requests DROP CONSTRAINT IF EXISTS ot_requests_rate_source_check;
ALTER TABLE hrm_schema.ot_requests ADD CONSTRAINT ot_requests_rate_source_check CHECK (rate_source IN ('POLICY','REASON'));
COMMENT ON COLUMN hrm_schema.ot_requests.rate_source IS 'Nguồn hệ số của đơn: REASON (hệ số của lý do) hoặc POLICY (chính sách OT theo ngày/đêm)';
