-- WP4.6: gán ca chuẩn ở cấp đơn vị (kế thừa), không sao chép bản ghi cho từng nhân viên.
-- Thứ tự ưu tiên khi tra ca của nhân viên: ngoại lệ cá nhân (shift_assignments)
-- > ca của đơn vị trực tiếp > ca của đơn vị cha (đi dần lên cây tổ chức).
-- unit_id tham chiếu core_schema.organization_nodes (đơn vị). Nhân viên đổi phòng tự theo ca phòng mới
-- vì đơn vị được tra theo phân công tổ chức hiệu lực tại ngày cần tra.
CREATE TABLE IF NOT EXISTS hrm_schema.unit_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  unit_id uuid NOT NULL REFERENCES core_schema.organization_nodes(id),
  shift_id uuid NOT NULL REFERENCES hrm_schema.shift_definitions(id),
  effective_from date NOT NULL,
  effective_to date,
  status varchar(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_hrm_unit_shift_assignments_unit_date
  ON hrm_schema.unit_shift_assignments (tenant_id, unit_id, effective_from, effective_to)
  WHERE status = 'ACTIVE';
