-- Hệ số OT là dữ liệu khai báo trong danh mục Loại OT (request_reasons, kind = 'OT_TYPE'),
-- không còn nằm trong cấu hình chính sách OT. Không có ngày hiệu lực hay phiên bản:
-- đơn OT chụp hệ số lúc tạo/duyệt (ot_requests.ot_rate_multiplier) nên đổi hệ số không sửa đơn cũ.
ALTER TABLE hrm_schema.request_reasons
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(6,3);
ALTER TABLE hrm_schema.request_reasons
  DROP CONSTRAINT IF EXISTS request_reasons_rate_multiplier_check;
ALTER TABLE hrm_schema.request_reasons
  ADD CONSTRAINT request_reasons_rate_multiplier_check
  CHECK (rate_multiplier IS NULL OR (rate_multiplier >= 1 AND rate_multiplier <= 10));

-- Chuyển hệ số đang dùng từ phiên bản chính sách OT hiện hành sang danh mục (mỗi tenant có chính sách OT).
CREATE TEMP TABLE _ot_rate_seed AS
SELECT DISTINCT ON (p.tenant_id) p.tenant_id, v.config_json AS cfg
  FROM hrm_schema.policies p
  JOIN hrm_schema.policy_versions v ON v.policy_id = p.id
 WHERE p.policy_type = 'OT' AND v.status = 'ACTIVE'
 ORDER BY p.tenant_id, v.effective_from DESC, v.version_no DESC;

INSERT INTO hrm_schema.request_reason_categories
  (tenant_id, code, name, sort_order, is_system, fixed_items)
SELECT tenant_id, 'OT_TYPE', 'Loại OT (hệ số lương)', 3, true, true
  FROM _ot_rate_seed
ON CONFLICT DO NOTHING;

WITH items(code, name, ord, cfg_key) AS (
  VALUES
    ('WEEKDAY', 'Ngày thường', 1, 'weekdayRate'),
    ('WEEKEND', 'Ngày nghỉ hằng tuần', 2, 'offRate'),
    ('NIGHT', 'Làm thêm ca đêm', 3, 'nightRate'),
    ('HOLIDAY', 'Ngày lễ / Tết', 4, 'holidayRate'),
    ('NIGHT_WEEKEND', 'Làm thêm ca đêm ngày nghỉ hằng tuần', 5, 'nightOffRate'),
    ('NIGHT_HOLIDAY', 'Làm thêm ca đêm ngày lễ / Tết', 6, 'nightHolidayRate')
)
INSERT INTO hrm_schema.request_reasons
  (tenant_id, kind, name, code, rate_multiplier, sort_order)
SELECT s.tenant_id, 'OT_TYPE', i.name, i.code,
       NULLIF(s.cfg ->> i.cfg_key, '')::numeric, i.ord
  FROM _ot_rate_seed s CROSS JOIN items i
ON CONFLICT DO NOTHING;

-- Các mục OT_TYPE đã có (tạo từ danh mục trước đây, chưa có hệ số): điền hệ số từ chính sách.
UPDATE hrm_schema.request_reasons r
   SET rate_multiplier = NULLIF(s.cfg ->> m.cfg_key, '')::numeric,
       updated_at = now()
  FROM _ot_rate_seed s,
       (VALUES ('WEEKDAY', 'weekdayRate'), ('WEEKEND', 'offRate'), ('NIGHT', 'nightRate'),
               ('HOLIDAY', 'holidayRate'), ('NIGHT_WEEKEND', 'nightOffRate'),
               ('NIGHT_HOLIDAY', 'nightHolidayRate')) AS m(code, cfg_key)
 WHERE r.tenant_id = s.tenant_id AND r.kind = 'OT_TYPE'
   AND upper(r.code) = m.code AND r.rate_multiplier IS NULL AND r.deleted_at IS NULL;

DROP TABLE IF EXISTS _ot_rate_seed;
