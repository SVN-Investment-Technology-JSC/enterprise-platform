-- FIX-C-01: mot loai chinh sach toan tenant chi co mot ban ghi policies ACTIVE.
-- An toan: khong bao gio lam hong migration. Neu du lieu hien tai dang vi pham
-- (nhieu ban ghi ACTIVE cung loai) thi chi RAISE NOTICE va bo qua; sau khi don du lieu
-- migration van duoc ghi nhan da chay; sau khi don du lieu hay tao chi muc bang tay (lenh CREATE UNIQUE INDEX ben duoi).
-- Pham vi: ATTENDANCE, PAYROLL, OT (cac loai co controller cau hinh rieng, luon toan tenant).
DO $$
DECLARE
  violation record;
  has_violation boolean := false;
BEGIN
  IF to_regclass('hrm_schema.ux_hrm_policies_one_active_per_type') IS NOT NULL THEN
    RAISE NOTICE 'ux_hrm_policies_one_active_per_type da ton tai; bo qua';
    RETURN;
  END IF;
  FOR violation IN
    SELECT tenant_id, policy_type, count(*) AS n, string_agg(code, ', ' ORDER BY created_at) AS codes
    FROM hrm_schema.policies
    WHERE status = 'ACTIVE' AND policy_type IN ('ATTENDANCE','PAYROLL','OT')
    GROUP BY tenant_id, policy_type
    HAVING count(*) > 1
  LOOP
    has_violation := true;
    RAISE NOTICE 'Bo qua chi muc duy nhat: tenant % loai % co % ban ghi ACTIVE (%)',
      violation.tenant_id, violation.policy_type, violation.n, violation.codes;
  END LOOP;
  IF NOT has_violation THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_hrm_policies_one_active_per_type
      ON hrm_schema.policies (tenant_id, policy_type)
      WHERE status = 'ACTIVE' AND policy_type IN ('ATTENDANCE','PAYROLL','OT');
  END IF;
END
$$;
