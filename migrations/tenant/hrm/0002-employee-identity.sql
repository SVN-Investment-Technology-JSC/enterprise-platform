SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Preserve every existing HRM ID, including profiles without a matching user.
INSERT INTO core_schema.employees (id, tenant_id, user_id, full_name, work_email)
SELECT ep.employee_id, ep.tenant_id, u.id,
       COALESCE(NULLIF(trim(u.full_name), ''), ep.employee_code), u.email
FROM hrm_schema.employee_profiles ep
LEFT JOIN core_schema.users u ON u.id = ep.employee_id
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'hrm_employee_core_fk'
                   AND conrelid = 'hrm_schema.employee_profiles'::regclass) THEN
    ALTER TABLE hrm_schema.employee_profiles ADD CONSTRAINT hrm_employee_core_fk
      FOREIGN KEY (tenant_id, employee_id)
      REFERENCES core_schema.employees(tenant_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- A single read model prevents display queries from assuming profile.id/name.
CREATE OR REPLACE VIEW hrm_schema.employee_directory AS
SELECT ep.*, e.user_id, e.full_name, e.work_email,
       org.position_id, org.position_code, org.position_name,
       org.department_id, org.department_code, org.department_name,
       org.division_name, org.salary_grade_code, org.salary_grade_name
FROM hrm_schema.employee_profiles ep
JOIN core_schema.employees e ON e.id = ep.employee_id AND e.tenant_id = ep.tenant_id
LEFT JOIN LATERAL (
  SELECT pos.id AS position_id, pos.code AS position_code, pos.name AS position_name,
         unit.id AS department_id, unit.code AS department_code, unit.name AS department_name,
         division.name AS division_name, sg.code AS salary_grade_code, sg.name AS salary_grade_name
  FROM core_schema.organization_node_assignments a
  JOIN core_schema.organization_nodes pos ON pos.id = a.node_id
    AND pos.category = 'position' AND pos.deleted_at IS NULL
  LEFT JOIN core_schema.organization_nodes unit ON unit.id = pos.parent_id AND unit.deleted_at IS NULL
  LEFT JOIN core_schema.organization_nodes division ON division.id = unit.parent_id AND division.deleted_at IS NULL
  LEFT JOIN hrm_schema.position_profiles pp ON pp.position_id = pos.id AND pp.tenant_id = ep.tenant_id AND pp.deleted_at IS NULL
  LEFT JOIN hrm_schema.salary_grades sg ON sg.id = pp.salary_grade_id AND sg.tenant_id = ep.tenant_id AND sg.deleted_at IS NULL
  WHERE a.user_id = e.user_id AND a.status = 'active' AND a.deleted_at IS NULL
    AND (a.start_date IS NULL OR a.start_date <= CURRENT_DATE)
    AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
  ORDER BY a.is_primary DESC, a.created_at DESC, a.id
  LIMIT 1
) org ON true
WHERE e.deleted_at IS NULL;
