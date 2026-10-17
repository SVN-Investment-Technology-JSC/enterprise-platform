SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Tenant có sẵn danh mục lý do cũ (0038) mang đúng mã của loại hệ thống, ví dụ BUSINESS_TRIP "Lý do công tác" (engine GENERIC):
-- phần seed của 0047 bỏ qua mã đó vì "đã tồn tại", nên tenant không có loại đơn Công tác (engine BUSINESS_TRIP) và
-- trang Đơn từ không hiện đơn công tác. Lý do của đơn gắn theo kind (request_reasons.kind = mã), không theo id danh mục,
-- nên chuyển ngay dòng cũ thành loại hệ thống là an toàn: giữ nguyên id, mã, trạng thái bật/tắt và các lý do đang dùng.
-- Chỉ chuyển khi tenant chưa có loại hệ thống đang hoạt động cùng engine (tránh trùng với loại đã tạo lại sau khi xoá mềm).
UPDATE hrm_schema.request_reason_categories c
   SET engine = d.engine,
       name = d.name,
       description = d.description,
       time_mode = d.time_mode,
       requires_attachment = false,
       fields = '[]'::jsonb,
       is_system = true,
       sort_order = d.sort_order,
       updated_at = now()
  FROM (VALUES
    ('LEAVE',                 'Nghỉ phép',        'Nghỉ phép năm, nghỉ ốm, việc riêng, nghỉ không lương theo lý do nghỉ đã cấu hình.', 'LEAVE',                 'RANGE_DATETIME', 10),
    ('OVERTIME',              'Làm thêm giờ',     'Đăng ký làm thêm ngoài ca theo hệ số của chính sách làm thêm.',                   'OVERTIME',              'RANGE_DATETIME', 20),
    ('BUSINESS_TRIP',         'Công tác',         'Công tác thực địa, hội thảo, hỗ trợ dự án kèm phụ cấp công tác.',                'BUSINESS_TRIP',         'RANGE_DATETIME', 30),
    ('SHIFT_CHANGE',          'Đổi ca',           'Hoán đổi ca với đồng nghiệp hoặc chuyển sang ca khác trong khoảng ngày chọn.',   'SHIFT_CHANGE',          'DATE_RANGE',     40),
    ('ATTENDANCE_CORRECTION', 'Giải trình công',  'Giải trình quên chấm công, lỗi thiết bị, bổ sung giờ vào ra thực tế.',            'ATTENDANCE_CORRECTION', 'SINGLE_DATE',    50),
    ('ADVANCE',               'Tạm ứng lương',    'Đề nghị tạm ứng một phần lương, hoàn trả bằng khấu trừ các kỳ lương sau.',       'ADVANCE',               'NONE',           60),
    ('PROFILE_CORRECTION',    'Đính chính hồ sơ', 'Đề nghị đính chính họ tên, ngày sinh, giấy tờ; hồ sơ chỉ đổi sau khi được duyệt.', 'PROFILE_CORRECTION',    'NONE',           70)
  ) AS d(code, name, description, engine, time_mode, sort_order)
 WHERE upper(c.code) = d.code
   AND c.engine = 'GENERIC'
   AND c.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM hrm_schema.request_reason_categories s
      WHERE s.tenant_id = c.tenant_id AND s.engine = d.engine AND s.deleted_at IS NULL
   );
