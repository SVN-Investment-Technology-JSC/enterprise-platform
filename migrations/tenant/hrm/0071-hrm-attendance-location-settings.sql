-- Gộp "Quy định chấm công" vào "Địa điểm GPS": IP khai báo theo từng địa điểm, và một cài đặt chung về kiểm tra vị trí
-- (bật/tắt, sai số GPS tối đa) thay cho cờ requireGps/requireIp trong phiên bản chính sách theo ngày.
-- Chính sách chấm công cũ vẫn giữ nguyên (múi giờ, lịch sử); chỉ phần vị trí chuyển sang đây.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.attendance_sites
  ADD COLUMN IF NOT EXISTS allowed_ips text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS hrm_schema.attendance_settings (
  tenant_id uuid PRIMARY KEY,
  location_check boolean NOT NULL DEFAULT false,
  max_gps_accuracy_meters integer NOT NULL DEFAULT 100,
  -- Tenant cũ chỉ kiểm IP (không GPS) chưa diễn đạt được bằng địa điểm: tiếp tục dùng chính sách cũ cho tới khi khai báo GPS.
  legacy_policy boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT attendance_settings_accuracy_check CHECK (max_gps_accuracy_meters BETWEEN 1 AND 1000)
);

-- Chuyển cấu hình đang hiệu lực (áp dụng cho tất cả nhân viên) sang cài đặt mới.
WITH current_policy AS (
  SELECT DISTINCT ON (p.tenant_id) p.tenant_id, v.config_json AS c
    FROM hrm_schema.policy_versions v
    JOIN hrm_schema.policies p ON p.id = v.policy_id
   WHERE p.policy_type = 'ATTENDANCE'
     AND p.status = 'ACTIVE'
     AND v.status IN ('ACTIVE', 'SUPERSEDED')
     AND v.effective_from <= current_date
     AND (v.effective_to IS NULL OR v.effective_to >= current_date)
     AND NOT (CASE WHEN jsonb_typeof(v.config_json -> 'employeeIds') = 'array' THEN jsonb_array_length(v.config_json -> 'employeeIds') > 0 ELSE false END)
   ORDER BY p.tenant_id, v.effective_from DESC, v.version_no DESC
), flags AS (
  SELECT tenant_id, c,
         COALESCE((c ->> 'requireGps')::boolean, (c ->> 'require_gps')::boolean, false) AS gps,
         COALESCE((c ->> 'requireIp')::boolean, (c ->> 'require_ip')::boolean, false) AS ip,
         CASE
           WHEN COALESCE(c ->> 'maxGpsAccuracyMeters', c ->> 'max_gps_accuracy_meters') ~ '^[0-9]+$'
           THEN LEAST(1000, GREATEST(1, COALESCE(c ->> 'maxGpsAccuracyMeters', c ->> 'max_gps_accuracy_meters')::int))
           ELSE 100
         END AS accuracy
    FROM current_policy
)
INSERT INTO hrm_schema.attendance_settings (tenant_id, location_check, max_gps_accuracy_meters, legacy_policy)
SELECT tenant_id, gps, accuracy, (ip AND NOT gps)
  FROM flags
ON CONFLICT (tenant_id) DO NOTHING;

-- Tenant đang bắt cả IP lẫn GPS: danh sách IP chung trở thành IP của mọi địa điểm đang dùng (hành vi giữ nguyên: phải đạt cả hai).
UPDATE hrm_schema.attendance_sites s
   SET allowed_ips = ARRAY(SELECT jsonb_array_elements_text(cp.config_json -> 'allowedIps'))
  FROM (
    SELECT DISTINCT ON (p.tenant_id) p.tenant_id, v.config_json
      FROM hrm_schema.policy_versions v
      JOIN hrm_schema.policies p ON p.id = v.policy_id
     WHERE p.policy_type = 'ATTENDANCE' AND p.status = 'ACTIVE' AND v.status IN ('ACTIVE', 'SUPERSEDED')
       AND v.effective_from <= current_date AND (v.effective_to IS NULL OR v.effective_to >= current_date)
       AND NOT (CASE WHEN jsonb_typeof(v.config_json -> 'employeeIds') = 'array' THEN jsonb_array_length(v.config_json -> 'employeeIds') > 0 ELSE false END)
     ORDER BY p.tenant_id, v.effective_from DESC, v.version_no DESC
  ) AS cp
 WHERE s.tenant_id = cp.tenant_id
   AND s.active = true
   AND s.allowed_ips = '{}'
   AND jsonb_typeof(cp.config_json -> 'allowedIps') = 'array'
   AND COALESCE((cp.config_json ->> 'requireIp')::boolean, false)
   AND COALESCE((cp.config_json ->> 'requireGps')::boolean, false);
