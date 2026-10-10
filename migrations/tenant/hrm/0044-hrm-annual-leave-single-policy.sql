SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Phép năm chỉ có MỘT cấu hình: mỗi tenant có đúng một lý do nghỉ đánh dấu is_annual.
-- Chỉ lý do phép năm có lịch cộng phép và trừ quỹ; các lý do nghỉ khác (nghỉ ốm, cưới, không lương...) không trừ quỹ.
ALTER TABLE hrm_schema.leave_types
  ADD COLUMN IF NOT EXISTS is_annual boolean NOT NULL DEFAULT false;

-- Backfill an toàn, chạy lại không đổi kết quả. Chỉ xét tenant chưa có lý do phép năm nào:
--  * Đúng một loại nghỉ chưa xoá có lịch cộng phép: chọn loại đó.
--  * Nhiều hơn một: chọn loại có lịch hiệu lực mới nhất và đồng thời có lương, trừ quỹ phép;
--    nếu vẫn không xác định được duy nhất thì để nguyên (người dùng chọn trên giao diện Chính sách phép năm).
WITH candidates AS (
  SELECT t.tenant_id, t.id, t.paid, t.deduct_balance, max(s.effective_from) AS latest_from
    FROM hrm_schema.leave_types t
    JOIN hrm_schema.leave_accrual_schedules s
      ON s.tenant_id = t.tenant_id AND s.leave_type_id = t.id
   WHERE t.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM hrm_schema.leave_types a
        WHERE a.tenant_id = t.tenant_id AND a.is_annual AND a.deleted_at IS NULL
     )
   GROUP BY t.tenant_id, t.id, t.paid, t.deduct_balance
), per_tenant AS (
  SELECT tenant_id, count(*) AS total FROM candidates GROUP BY tenant_id
), ranked AS (
  SELECT c.tenant_id, c.id,
         rank() OVER (PARTITION BY c.tenant_id ORDER BY c.latest_from DESC) AS rank_no
    FROM candidates c
    JOIN per_tenant p ON p.tenant_id = c.tenant_id
   WHERE p.total > 1 AND c.paid AND c.deduct_balance
), chosen AS (
  SELECT c.tenant_id, c.id
    FROM candidates c
    JOIN per_tenant p ON p.tenant_id = c.tenant_id
   WHERE p.total = 1
  UNION ALL
  SELECT r.tenant_id, r.id
    FROM ranked r
   WHERE r.rank_no = 1
     AND (SELECT count(*) FROM ranked r2 WHERE r2.tenant_id = r.tenant_id AND r2.rank_no = 1) = 1
)
UPDATE hrm_schema.leave_types t
   SET is_annual = true
  FROM chosen c
 WHERE t.tenant_id = c.tenant_id AND t.id = c.id;

-- Mỗi tenant chỉ có một lý do phép năm đang dùng.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrm_leave_types_one_annual
  ON hrm_schema.leave_types (tenant_id)
  WHERE is_annual AND deleted_at IS NULL;
