SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Lý do của đơn từ là DANH MỤC CẤU HÌNH (không nhập tự do) và tách khỏi "mô tả":
--   * Lý do: chọn từ danh mục (reason_id + bản chụp tên reason_name), có "có lương / không lương" (paid) và có thể bắt buộc mô tả.
--   * Mô tả: văn bản tự do bổ sung; vẫn nằm ở cột `reason` cũ của từng bảng đơn để không đổi dữ liệu cũ (API gọi là `description`).
-- Đơn nghỉ dùng loại nghỉ (leave_types) làm lý do nghỉ nên không thêm cột ở leave_requests.
-- Danh mục chỉ cho 4 loại đơn: làm thêm giờ, công tác, giải trình công, đổi ca. Mã lý do (code) là sub_type_code khi chọn cách duyệt theo lý do.
ALTER TABLE hrm_schema.request_reasons
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS requires_description boolean NOT NULL DEFAULT false;
ALTER TABLE hrm_schema.request_reasons DROP CONSTRAINT IF EXISTS request_reasons_kind_check;

-- Mục cũ chưa có mã: cấp mã ổn định từ id để dùng làm khóa cấu hình cách duyệt.
UPDATE hrm_schema.request_reasons
   SET code = 'R' || upper(substr(replace(id::text, '-', ''), 1, 8))
 WHERE code IS NULL;

COMMENT ON COLUMN hrm_schema.request_reasons.paid IS 'Có lương (true) hoặc không lương (false); áp dụng cho làm thêm giờ, các loại đơn khác luôn true';
COMMENT ON COLUMN hrm_schema.request_reasons.requires_description IS 'true: người làm đơn phải nhập mô tả khi chọn lý do này (ví dụ lý do "Khác")';

ALTER TABLE hrm_schema.ot_requests
  ADD COLUMN IF NOT EXISTS reason_id uuid,
  ADD COLUMN IF NOT EXISTS reason_name varchar(255),
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT true;
ALTER TABLE hrm_schema.business_trip_requests
  ADD COLUMN IF NOT EXISTS reason_id uuid,
  ADD COLUMN IF NOT EXISTS reason_name varchar(255);
ALTER TABLE hrm_schema.attendance_corrections
  ADD COLUMN IF NOT EXISTS reason_id uuid,
  ADD COLUMN IF NOT EXISTS reason_name varchar(255);
ALTER TABLE hrm_schema.shift_change_requests
  ADD COLUMN IF NOT EXISTS reason_id uuid,
  ADD COLUMN IF NOT EXISTS reason_name varchar(255);

COMMENT ON COLUMN hrm_schema.ot_requests.reason IS 'Mô tả (văn bản tự do). Lý do chọn từ danh mục ở reason_id/reason_name';
COMMENT ON COLUMN hrm_schema.business_trip_requests.reason IS 'Mô tả (văn bản tự do). Lý do chọn từ danh mục ở reason_id/reason_name';
COMMENT ON COLUMN hrm_schema.leave_requests.reason IS 'Mô tả (văn bản tự do). Lý do nghỉ là loại nghỉ (leave_type_id)';

-- Danh mục lý do mặc định cho tenant HRM đã có (tenant mới: quản trị bấm "Tạo lý do mặc định" trong Cấu hình).
INSERT INTO hrm_schema.request_reasons (tenant_id, kind, code, name, description, paid, requires_description, sort_order)
SELECT t.tenant_id, d.kind, d.code, d.name, d.description, true, d.requires_description, d.sort_order
FROM (
  SELECT tenant_id FROM hrm_schema.employee_profiles
  UNION SELECT tenant_id FROM hrm_schema.request_procedure_bindings
  UNION SELECT tenant_id FROM hrm_schema.leave_types
) t
CROSS JOIN (VALUES
  ('OVERTIME',              'OT_WORK',      'Theo yêu cầu công việc',  'Làm thêm để hoàn thành công việc được giao', false, 10),
  ('OVERTIME',              'OT_OTHER',     'Khác',                    'Lý do khác, cần mô tả cụ thể',               true,  90),
  ('BUSINESS_TRIP',         'TRIP_PLAN',    'Công tác theo kế hoạch',  'Công tác theo kế hoạch đã được giao',        false, 10),
  ('BUSINESS_TRIP',         'TRIP_OTHER',   'Khác',                    'Lý do khác, cần mô tả cụ thể',               true,  90),
  ('ATTENDANCE_CORRECTION', 'COR_FORGOT',   'Quên chấm công',          'Quên chấm vào hoặc chấm ra',                 false, 10),
  ('ATTENDANCE_CORRECTION', 'COR_DEVICE',   'Lỗi thiết bị hoặc mạng',  'Không chấm được do lỗi thiết bị hoặc mạng',  false, 20),
  ('ATTENDANCE_CORRECTION', 'COR_OTHER',    'Khác',                    'Lý do khác, cần mô tả cụ thể',               true,  90),
  ('SHIFT_CHANGE',          'SC_PERSONAL',  'Việc cá nhân',            'Đổi ca vì việc cá nhân',                     false, 10),
  ('SHIFT_CHANGE',          'SC_WORK',      'Theo yêu cầu công việc',  'Đổi ca theo yêu cầu công việc',              false, 20),
  ('SHIFT_CHANGE',          'SC_OTHER',     'Khác',                    'Lý do khác, cần mô tả cụ thể',               true,  90)
) AS d(kind, code, name, description, requires_description, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM hrm_schema.request_reasons r
   WHERE r.tenant_id = t.tenant_id AND r.kind = d.kind AND upper(r.code) = d.code AND r.deleted_at IS NULL
);
