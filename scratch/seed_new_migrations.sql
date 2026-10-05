DO $$
DECLARE
  v_tenant_id uuid;
  v_emp record;
  v_pp record;
  v_leave_type record;
BEGIN
  -- Lay tenant_id cua savina
  SELECT tenant_id INTO v_tenant_id FROM hrm_schema.employee_profiles LIMIT 1;
  IF v_tenant_id IS NULL THEN
    RAISE NOTICE 'Khong tim thay tenant_id';
    RETURN;
  END IF;

  -- 1. Sinh du lieu bang hrm_schema.leave_accrual_schedules
  FOR v_leave_type IN SELECT id FROM hrm_schema.leave_types WHERE tenant_id = v_tenant_id LIMIT 3 LOOP
    IF NOT EXISTS (SELECT 1 FROM hrm_schema.leave_accrual_schedules WHERE leave_type_id = v_leave_type.id) THEN
      INSERT INTO hrm_schema.leave_accrual_schedules (
        tenant_id, leave_type_id, accrual_frequency, accrual_amount, proration_rule,
        seniority_bonus_years, seniority_bonus_days, effective_from
      ) VALUES (
        v_tenant_id, v_leave_type.id, 'MONTHLY', 1.0, 'BY_JOIN_DATE', 5, 1.0, '2026-01-01'
      );
    END IF;
  END LOOP;

  -- 2. Sinh du lieu bang hrm_schema.request_drafts (Luu nhap don nghi phep, OT)
  FOR v_emp IN SELECT employee_id FROM hrm_schema.employee_profiles WHERE tenant_id = v_tenant_id LIMIT 5 LOOP
    IF NOT EXISTS (SELECT 1 FROM hrm_schema.request_drafts WHERE employee_id = v_emp.employee_id AND status = 'DRAFT') THEN
      INSERT INTO hrm_schema.request_drafts (
        tenant_id, employee_id, request_kind, status, revision, payload, created_by
      ) VALUES (
        v_tenant_id, v_emp.employee_id, 'leave', 'DRAFT', 1, 
        '{"reason": "Nghi viec ca nhan gia dinh (ban nhap)", "duration": 1, "fromDate": "2026-10-15", "toDate": "2026-10-15"}'::jsonb,
        v_emp.employee_id
      ),
      (
        v_tenant_id, v_emp.employee_id, 'ot', 'DRAFT', 1,
        '{"reason": "Tang ca hoan thanh du an Q4 (ban nhap)", "plannedHours": 2.5, "workDate": "2026-10-16"}'::jsonb,
        v_emp.employee_id
      );
    END IF;
  END LOOP;

  -- 3. Sinh du lieu bang hrm_schema.payroll_runs
  SELECT * INTO v_pp FROM hrm_schema.payroll_periods WHERE tenant_id = v_tenant_id LIMIT 1;
  IF v_pp.id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM hrm_schema.payroll_runs WHERE payroll_period_id = v_pp.id) THEN
      INSERT INTO hrm_schema.payroll_runs (
        tenant_id, payroll_period_id, run_no, calculation_version, status,
        calculated_at, review_notes
      ) VALUES (
        v_tenant_id, v_pp.id, 1, 'VN_LABOR_LAW_2026', 'CALCULATED',
        now(), 'Tinh luong du kien ky 10/2026 theo bang cong tu dong'
      );
    END IF;
  END IF;

  -- 4. Bo sung cau hinh nguoi duyet dong initiator_manager trong raci_assignments
  UPDATE procedure_schema.raci_assignments
  SET subject_type = 'initiator_manager', subject_id = NULL
  WHERE id IN (
    SELECT id FROM procedure_schema.raci_assignments 
    WHERE role_letter = 'A' AND subject_type = 'position'
    LIMIT 3
  );

  RAISE NOTICE 'Sinh du lieu mau thanh cong!';
END $$;
