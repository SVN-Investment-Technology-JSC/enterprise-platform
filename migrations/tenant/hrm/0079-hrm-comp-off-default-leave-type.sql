-- Lý do nghỉ "Nghỉ bù" là lý do mặc định của mỗi tenant, cùng phép năm: có xử lý riêng (số dư lấy từ quỹ nghỉ bù),
-- tenant ngừng hoặc dùng lại được nhưng không xóa được. Chạy lại không đổi kết quả.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1) Tenant đã có loại nghỉ bù tự đặt (mã COMPENSATORY hoặc COMP, hoặc tên "Nghỉ bù"): đánh dấu loại đó, ưu tiên loại có nhiều đơn nhất.
WITH tenants AS (
  SELECT DISTINCT tenant_id FROM hrm_schema.leave_types
), already AS (
  SELECT DISTINCT tenant_id FROM hrm_schema.leave_types WHERE comp_off AND deleted_at IS NULL
), ranked AS (
  SELECT t.id, t.tenant_id,
         row_number() OVER (
           PARTITION BY t.tenant_id
           ORDER BY (SELECT count(*) FROM hrm_schema.leave_requests r WHERE r.tenant_id = t.tenant_id AND r.leave_type_id = t.id) DESC,
                    (t.code = 'COMPENSATORY') DESC, t.created_at
         ) AS rn
    FROM hrm_schema.leave_types t
   WHERE t.deleted_at IS NULL AND t.merged_into_id IS NULL AND NOT t.is_annual
     AND (t.code IN ('COMPENSATORY', 'COMP') OR lower(t.name) = 'nghỉ bù')
     AND t.tenant_id NOT IN (SELECT tenant_id FROM already)
)
UPDATE hrm_schema.leave_types t
   SET comp_off = true, deduct_balance = false, paid = true,
       updated_at = GREATEST(clock_timestamp(), t.updated_at + interval '1 millisecond')
  FROM ranked r
 WHERE t.id = r.id AND r.rn = 1;

-- 2) Tenant chưa có loại nghỉ bù nào: tạo lý do mặc định.
INSERT INTO hrm_schema.leave_types (tenant_id, code, name, unit, paid, deduct_balance, comp_off, active)
SELECT t.tenant_id, 'COMPENSATORY', 'Nghỉ bù', 'DAYS', true, false, true, true
  FROM (SELECT DISTINCT tenant_id FROM hrm_schema.leave_types) t
 WHERE NOT EXISTS (
         SELECT 1 FROM hrm_schema.leave_types c WHERE c.tenant_id = t.tenant_id AND c.comp_off AND c.deleted_at IS NULL)
   AND NOT EXISTS (
         SELECT 1 FROM hrm_schema.leave_types c WHERE c.tenant_id = t.tenant_id AND c.code = 'COMPENSATORY');
