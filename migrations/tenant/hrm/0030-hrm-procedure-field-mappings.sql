-- FIX-E-05: ánh xạ trường HRM -> thuộc tính Procedure theo từng binding.
-- OVERWRITE: giá trị hệ thống thắng; PREFILL: giá trị người nộp thắng (chỉ điền khi để trống).
-- Binding PROCEDURE hiện có được nạp bảng mặc định (đúng bảng mã cố định cũ) nên hành vi không đổi.
-- Idempotent. Cột condition_rules của request_procedure_bindings không còn được dùng (giữ nguyên, không xóa dữ liệu).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE hrm_schema.request_procedure_bindings
  ADD COLUMN IF NOT EXISTS field_mappings_configured boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS hrm_schema.request_procedure_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  binding_id uuid NOT NULL REFERENCES hrm_schema.request_procedure_bindings(id) ON DELETE CASCADE,
  hrm_field varchar(100) NOT NULL,
  attribute_code varchar(100) NOT NULL,
  scope varchar(10) NOT NULL DEFAULT 'any' CHECK (scope IN ('any','process','step')),
  step_id varchar(100) NOT NULL DEFAULT '',
  transform varchar(20) NOT NULL DEFAULT 'none'
    CHECK (transform IN ('none','to_number','to_string','to_boolean','to_date','upper','lower')),
  mode varchar(10) NOT NULL DEFAULT 'OVERWRITE' CHECK (mode IN ('OVERWRITE','PREFILL')),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hrm_field_mapping UNIQUE (tenant_id, binding_id, scope, step_id, attribute_code, hrm_field)
);
CREATE INDEX IF NOT EXISTS idx_hrm_field_mapping_binding
  ON hrm_schema.request_procedure_field_mappings(tenant_id, binding_id);

INSERT INTO hrm_schema.request_procedure_field_mappings(tenant_id, binding_id, hrm_field, attribute_code, scope, mode)
SELECT b.tenant_id, b.id, d.hrm_field, d.attribute_code, 'any', 'OVERWRITE'
FROM hrm_schema.request_procedure_bindings b
JOIN (VALUES
    ('leave','form.reason','ly_do'),
    ('leave','form.from_date','tu_ngay'),
    ('leave','form.to_date','den_ngay'),
    ('leave','form.duration','so_ngay_nghi'),
    ('leave','form.duration','duration'),
    ('leave','form.leave_type_id','leave_type_id'),
    ('leave','form.is_negative_leave','is_negative_leave'),
    ('ot','form.reason','ly_do'),
    ('ot','form.ot_hours','so_gio_ot'),
    ('ot','form.ot_hours','ot_hours'),
    ('ot','form.ot_type','loai_ot'),
    ('ot','form.is_night_ot','is_night_ot'),
    ('business_trip','form.reason','ly_do'),
    ('business_trip','form.from_date','tu_ngay'),
    ('business_trip','form.to_date','den_ngay'),
    ('business_trip','form.days_count','so_ngay_cong_tac'),
    ('business_trip','form.days_count','days_count'),
    ('business_trip','form.trip_type','loai_cong_tac'),
    ('business_trip','form.destination','dia_diem'),
    ('business_trip','form.allow_ot','allow_ot'),
    ('advance','form.reason','ly_do'),
    ('advance','form.amount','so_tien'),
    ('advance','form.amount','amount'),
    ('advance','form.installments','so_ky_tra'),
    ('correction','form.reason','ly_do'),
    ('correction','form.request_date','ngay'),
    ('shift_change','form.reason','ly_do'),
    ('shift_change','form.from_date','tu_ngay'),
    ('shift_change','form.to_date','den_ngay'),
    ('shift_change','form.change_type','loai_doi_ca'),
    ('profile_correction','form.reason','ly_do')
) AS d(kind, hrm_field, attribute_code) ON d.kind = b.request_kind
WHERE b.mode = 'PROCEDURE' AND b.is_active
  AND NOT EXISTS (
    SELECT 1 FROM hrm_schema.request_procedure_field_mappings m
    WHERE m.tenant_id = b.tenant_id AND m.binding_id = b.id
  )
ON CONFLICT DO NOTHING;
