SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- LOẠI ĐƠN LÀ CẤU HÌNH. Dùng lại bảng request_reason_categories (0038/0039) làm registry loại đơn:
--   * 7 loại hệ thống (is_system=true) tương ứng 7 engine có sẵn: nghỉ phép, làm thêm giờ, công tác, đổi ca,
--     giải trình công, tạm ứng lương, đính chính hồ sơ. Không xoá, không đổi engine; được đổi tên, mô tả, bật/tắt.
--   * Loại do quản trị tạo luôn có engine GENERIC (chỉ ghi nhận và duyệt, không ảnh hưởng công/phép/lương),
--     lưu ở bảng custom_requests; lý do của loại này nằm ở request_reasons với kind = mã loại.
ALTER TABLE hrm_schema.request_reason_categories
  ADD COLUMN IF NOT EXISTS engine varchar(30) NOT NULL DEFAULT 'GENERIC',
  ADD COLUMN IF NOT EXISTS time_mode varchar(20) NOT NULL DEFAULT 'RANGE_DATETIME',
  ADD COLUMN IF NOT EXISTS requires_attachment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS icon varchar(40);

ALTER TABLE hrm_schema.request_reason_categories DROP CONSTRAINT IF EXISTS request_reason_categories_engine_check;
ALTER TABLE hrm_schema.request_reason_categories ADD CONSTRAINT request_reason_categories_engine_check
  CHECK (engine IN ('LEAVE','OVERTIME','BUSINESS_TRIP','SHIFT_CHANGE','ATTENDANCE_CORRECTION','ADVANCE','PROFILE_CORRECTION','GENERIC'));
ALTER TABLE hrm_schema.request_reason_categories DROP CONSTRAINT IF EXISTS request_reason_categories_time_mode_check;
ALTER TABLE hrm_schema.request_reason_categories ADD CONSTRAINT request_reason_categories_time_mode_check
  CHECK (time_mode IN ('RANGE_DATETIME','DATE_RANGE','SINGLE_DATE','NONE'));
ALTER TABLE hrm_schema.request_reason_categories DROP CONSTRAINT IF EXISTS request_reason_categories_fields_check;
ALTER TABLE hrm_schema.request_reason_categories ADD CONSTRAINT request_reason_categories_fields_check
  CHECK (jsonb_typeof(fields) = 'array');

COMMENT ON COLUMN hrm_schema.request_reason_categories.engine IS 'Engine xử lý đơn: 7 engine hệ thống hoặc GENERIC (loại tự tạo, chỉ ghi nhận và duyệt)';
COMMENT ON COLUMN hrm_schema.request_reason_categories.time_mode IS 'RANGE_DATETIME: từ ngày giờ đến ngày giờ; DATE_RANGE: khoảng ngày; SINGLE_DATE: một ngày; NONE: không có thời gian';
COMMENT ON COLUMN hrm_schema.request_reason_categories.fields IS 'Khai báo trường động của loại GENERIC: [{key,label,type,required,options}]';

-- 7 loại hệ thống cho tenant HRM đã có (tenant mới: API /request-types tự tạo khi đọc lần đầu).
INSERT INTO hrm_schema.request_reason_categories
  (tenant_id, code, name, description, engine, time_mode, is_system, sort_order)
SELECT t.tenant_id, d.code, d.name, d.description, d.engine, d.time_mode, true, d.sort_order
FROM (
  SELECT tenant_id FROM hrm_schema.employee_profiles
  UNION SELECT tenant_id FROM hrm_schema.request_procedure_bindings
  UNION SELECT tenant_id FROM hrm_schema.leave_types
) t
CROSS JOIN (VALUES
  ('LEAVE',                 'Nghỉ phép',        'Nghỉ phép năm, nghỉ ốm, việc riêng, nghỉ không lương theo lý do nghỉ đã cấu hình.', 'LEAVE',                 'RANGE_DATETIME', 10),
  ('OVERTIME',              'Làm thêm giờ',     'Đăng ký làm thêm ngoài ca theo hệ số của chính sách làm thêm.',                   'OVERTIME',              'RANGE_DATETIME', 20),
  ('BUSINESS_TRIP',         'Công tác',         'Công tác thực địa, hội thảo, hỗ trợ dự án kèm phụ cấp công tác.',                'BUSINESS_TRIP',         'RANGE_DATETIME', 30),
  ('SHIFT_CHANGE',          'Đổi ca',           'Hoán đổi ca với đồng nghiệp hoặc chuyển sang ca khác trong khoảng ngày chọn.',   'SHIFT_CHANGE',          'DATE_RANGE',     40),
  ('ATTENDANCE_CORRECTION', 'Giải trình công',  'Giải trình quên chấm công, lỗi thiết bị, bổ sung giờ vào ra thực tế.',            'ATTENDANCE_CORRECTION', 'SINGLE_DATE',    50),
  ('ADVANCE',               'Tạm ứng lương',    'Đề nghị tạm ứng một phần lương, hoàn trả bằng khấu trừ các kỳ lương sau.',       'ADVANCE',               'NONE',           60),
  ('PROFILE_CORRECTION',    'Đính chính hồ sơ', 'Đề nghị đính chính họ tên, ngày sinh, giấy tờ; hồ sơ chỉ đổi sau khi được duyệt.', 'PROFILE_CORRECTION',    'NONE',           70)
) AS d(code, name, description, engine, time_mode, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM hrm_schema.request_reason_categories c
   WHERE c.tenant_id = t.tenant_id AND upper(c.code) = d.code AND c.deleted_at IS NULL
);

-- Thời gian "từ ngày giờ đến ngày giờ" cho các đơn có khoảng thời gian. Cột ngày/giờ cũ vẫn được ghi đồng bộ
-- để bảng công, tính lương, kiểm tra chồng đơn và khoá tháng hoạt động như trước. Đơn cũ để NULL (hiển thị cả ngày).
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['leave_requests','ot_requests','business_trip_requests','shift_change_requests'] LOOP
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD COLUMN IF NOT EXISTS from_at timestamptz', tab);
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD COLUMN IF NOT EXISTS to_at timestamptz', tab);
    EXECUTE format('ALTER TABLE hrm_schema.%I DROP CONSTRAINT IF EXISTS %I', tab, tab || '_time_range_check');
    EXECUTE format('ALTER TABLE hrm_schema.%I ADD CONSTRAINT %I CHECK (from_at IS NULL OR to_at IS NULL OR to_at > from_at)',
      tab, tab || '_time_range_check');
  END LOOP;
END $$;

-- Đơn của loại do quản trị tạo (engine GENERIC).
CREATE TABLE IF NOT EXISTS hrm_schema.custom_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  type_id uuid NOT NULL,
  type_code varchar(50) NOT NULL,
  type_name varchar(255) NOT NULL,
  employee_id uuid NOT NULL,
  from_at timestamptz,
  to_at timestamptz,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  reason_id uuid,
  reason_name varchar(255),
  reason text,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object'),
  attachment_file_id uuid,
  status varchar(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  submitted_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  procedure_instance_id uuid,
  current_step_name varchar(100),
  current_assignee_id varchar(100),
  current_assignee_name text,
  workflow_status varchar(50),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_at IS NULL OR to_at IS NULL OR to_at > from_at)
);
CREATE INDEX IF NOT EXISTS idx_hrm_custom_requests_emp ON hrm_schema.custom_requests (tenant_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hrm_custom_requests_type ON hrm_schema.custom_requests (tenant_id, type_id, status);
CREATE INDEX IF NOT EXISTS idx_hrm_custom_requests_time ON hrm_schema.custom_requests (tenant_id, from_at);
CREATE INDEX IF NOT EXISTS custom_requests_current_step_idx
  ON hrm_schema.custom_requests (tenant_id, current_step_name) WHERE current_step_name IS NOT NULL;

-- Mở rộng danh sách loại đơn hợp lệ ở liên kết quy trình và bản nháp.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname, conrelid::regclass AS tab FROM pg_constraint
            WHERE contype = 'c'
              AND conrelid IN ('hrm_schema.procedure_links'::regclass, 'hrm_schema.request_drafts'::regclass)
              AND pg_get_constraintdef(oid) LIKE '%request_kind%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tab, c.conname);
  END LOOP;
END $$;
ALTER TABLE hrm_schema.procedure_links ADD CONSTRAINT procedure_links_request_kind_check
  CHECK (request_kind IN ('leave','ot','business_trip','shift_change','correction','advance','profile_correction','custom'));
ALTER TABLE hrm_schema.request_drafts ADD CONSTRAINT request_drafts_request_kind_check
  CHECK (request_kind IN ('leave','ot','business_trip','shift_change','correction','advance','profile_correction','custom'));

CREATE OR REPLACE FUNCTION hrm_schema.canonical_request_kind(kind text) RETURNS text AS $$
  SELECT CASE kind WHEN 'LEAVE' THEN 'leave' WHEN 'OT' THEN 'ot' WHEN 'BUSINESS_TRIP' THEN 'business_trip'
    WHEN 'SHIFT_CHANGE' THEN 'shift_change' WHEN 'ATTENDANCE' THEN 'correction' WHEN 'ADVANCE' THEN 'advance'
    WHEN 'PROFILE' THEN 'profile_correction' WHEN 'CUSTOM' THEN 'custom' ELSE kind END;
$$ LANGUAGE sql IMMUTABLE;

DROP TRIGGER IF EXISTS hrm_workflow_guard ON hrm_schema.custom_requests;
CREATE TRIGGER hrm_workflow_guard BEFORE UPDATE OF status ON hrm_schema.custom_requests
  FOR EACH ROW EXECUTE FUNCTION hrm_schema.guard_workflow_transition('custom');
DROP TRIGGER IF EXISTS hrm_request_event ON hrm_schema.custom_requests;
CREATE TRIGGER hrm_request_event AFTER INSERT OR UPDATE OF status ON hrm_schema.custom_requests
  FOR EACH ROW EXECUTE FUNCTION hrm_schema.record_request_event('CUSTOM');
