SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- ============================================================================
-- HRM Schema — Human Resource Management (Phase 1: 23 Tables)
-- Architecture Principles:
-- 1. Decoupled tenant module schema (hrm_schema).
-- 2. Master entities (Employee, Position) extend Core references via UUIDs.
-- 3. High performance composite indexing for attendance, timesheet, payroll.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS hrm_schema;

-- ----------------------------------------------------------------------------
-- 1. Foundation: Policies & Policy Versions
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    policy_type VARCHAR(50) NOT NULL CHECK (policy_type IN ('ATTENDANCE', 'LEAVE', 'OT', 'PAYROLL', 'SHIFT', 'GENERAL')),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DEPRECATED')),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT uq_hrm_policies_code UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_hrm_policies_tenant ON hrm_schema.policies(tenant_id, status);

CREATE TABLE IF NOT EXISTS hrm_schema.policy_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    policy_id UUID NOT NULL REFERENCES hrm_schema.policies(id) ON DELETE CASCADE,
    version_no INT NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    CONSTRAINT uq_hrm_policy_versions UNIQUE (policy_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_hrm_policy_versions_active ON hrm_schema.policy_versions(policy_id, status, effective_from);

-- ----------------------------------------------------------------------------
-- 2. Foundation: Salary Grades & Steps
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.salary_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_hrm_salary_grades_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS hrm_schema.salary_grade_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    salary_grade_id UUID NOT NULL REFERENCES hrm_schema.salary_grades(id) ON DELETE CASCADE,
    step_no INT NOT NULL,
    min_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    mid_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    max_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    base_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_salary_steps UNIQUE (salary_grade_id, step_no)
);
CREATE INDEX IF NOT EXISTS idx_hrm_salary_steps_grade ON hrm_schema.salary_grade_steps(salary_grade_id, step_no);

-- ----------------------------------------------------------------------------
-- 3. Core Extension: Profiles (Employee & Position)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.employee_profiles (
    employee_id UUID PRIMARY KEY, -- references core_employees(id)
    tenant_id UUID NOT NULL,
    employee_code VARCHAR(50) NOT NULL,
    personal_email VARCHAR(255),
    phone VARCHAR(30),
    date_of_birth DATE,
    gender VARCHAR(30) CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    identity_card_number VARCHAR(50),
    identity_card_issued_date DATE,
    identity_card_issued_place VARCHAR(255),
    tax_code VARCHAR(50),
    social_insurance_number VARCHAR(50),
    bank_account_number VARCHAR(50),
    bank_name VARCHAR(100),
    bank_branch VARCHAR(100),
    current_address TEXT,
    permanent_address TEXT,
    emergency_contact_name VARCHAR(255),
    emergency_contact_phone VARCHAR(30),
    emergency_contact_relationship VARCHAR(100),
    join_date DATE NOT NULL,
    official_date DATE,
    employment_status VARCHAR(30) NOT NULL DEFAULT 'OFFICIAL' CHECK (employment_status IN ('PROBATION', 'OFFICIAL', 'ON_LEAVE', 'RESIGNED', 'TERMINATED')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    CONSTRAINT uq_hrm_employee_profiles_code UNIQUE (tenant_id, employee_code)
);
CREATE INDEX IF NOT EXISTS idx_hrm_employee_profiles_tenant_status ON hrm_schema.employee_profiles(tenant_id, employment_status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS hrm_schema.position_profiles (
    position_id UUID PRIMARY KEY, -- references core_positions(id)
    tenant_id UUID NOT NULL,
    salary_grade_id UUID REFERENCES hrm_schema.salary_grades(id),
    default_policy_id UUID REFERENCES hrm_schema.policies(id),
    description TEXT,
    responsibilities JSONB DEFAULT '[]'::jsonb,
    requirements JSONB DEFAULT '[]'::jsonb,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID
);
CREATE INDEX IF NOT EXISTS idx_hrm_position_profiles_tenant ON hrm_schema.position_profiles(tenant_id, active) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 4. Time & Attendance (Shifts, Assignments, Attendances, Corrections)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.shift_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes INT NOT NULL DEFAULT 60,
    cross_midnight BOOLEAN NOT NULL DEFAULT false,
    grace_late_minutes INT NOT NULL DEFAULT 10,
    grace_early_minutes INT NOT NULL DEFAULT 5,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_shift_definitions_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS hrm_schema.shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    position_id UUID,
    shift_id UUID NOT NULL REFERENCES hrm_schema.shift_definitions(id) ON DELETE CASCADE,
    effective_from DATE NOT NULL,
    effective_to DATE,
    source VARCHAR(50) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'SCHEDULE_POLICY', 'SWAP_REQUEST')),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_shift_assignments_emp_date ON hrm_schema.shift_assignments(tenant_id, employee_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS hrm_schema.attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    work_date DATE NOT NULL,
    check_in_at TIMESTAMPTZ,
    check_out_at TIMESTAMPTZ,
    attendance_source VARCHAR(50) DEFAULT 'BIOMETRIC_DEVICE' CHECK (attendance_source IN ('BIOMETRIC_DEVICE', 'MOBILE_GPS', 'WEB_PORTAL', 'MANUAL_CORRECTION')),
    device_id VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'LATE', 'EARLY_LEAVE', 'MISSING_PUNCH', 'ABNORMAL', 'APPROVED_CORRECTION')),
    worked_minutes INT NOT NULL DEFAULT 0,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_attendances_emp_date UNIQUE (tenant_id, employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_hrm_attendances_emp_date ON hrm_schema.attendances(tenant_id, employee_id, work_date);

CREATE TABLE IF NOT EXISTS hrm_schema.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    attendance_id UUID REFERENCES hrm_schema.attendances(id) ON DELETE SET NULL,
    request_date DATE NOT NULL,
    old_check_in_at TIMESTAMPTZ,
    old_check_out_at TIMESTAMPTZ,
    new_check_in_at TIMESTAMPTZ,
    new_check_out_at TIMESTAMPTZ,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    workflow_instance_id UUID,
    submitted_by UUID NOT NULL,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    applied_at TIMESTAMPTZ,
    timesheet_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_att_corrections_emp ON hrm_schema.attendance_corrections(tenant_id, employee_id, status);

-- ----------------------------------------------------------------------------
-- 5. Leave Management (Types, Balances, Accruals, Transactions, Requests)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(20) NOT NULL DEFAULT 'DAYS' CHECK (unit IN ('DAYS', 'HOURS')),
    paid BOOLEAN NOT NULL DEFAULT true,
    requires_attachment BOOLEAN NOT NULL DEFAULT false,
    carryover_allowed BOOLEAN NOT NULL DEFAULT false,
    max_carryover_days NUMERIC(5,2) DEFAULT 0,
    carryover_expiry_month INT DEFAULT 3,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_hrm_leave_types_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS hrm_schema.leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL REFERENCES hrm_schema.leave_types(id) ON DELETE CASCADE,
    year INT NOT NULL,
    opening_balance NUMERIC(6,2) NOT NULL DEFAULT 0,
    accrued NUMERIC(6,2) NOT NULL DEFAULT 0,
    used NUMERIC(6,2) NOT NULL DEFAULT 0,
    pending NUMERIC(6,2) NOT NULL DEFAULT 0,
    adjusted NUMERIC(6,2) NOT NULL DEFAULT 0,
    remaining NUMERIC(6,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_leave_balances_emp_year UNIQUE (tenant_id, employee_id, leave_type_id, year)
);

CREATE TABLE IF NOT EXISTS hrm_schema.leave_accrual_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    leave_type_id UUID NOT NULL REFERENCES hrm_schema.leave_types(id) ON DELETE CASCADE,
    policy_version_id UUID REFERENCES hrm_schema.policy_versions(id),
    accrual_frequency VARCHAR(30) NOT NULL DEFAULT 'MONTHLY' CHECK (accrual_frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY', 'MILESTONE')),
    accrual_amount NUMERIC(6,2) NOT NULL DEFAULT 1.0,
    proration_rule VARCHAR(50) DEFAULT 'BY_JOIN_DATE',
    seniority_bonus_years INT DEFAULT 5,
    seniority_bonus_days NUMERIC(5,2) DEFAULT 1.0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hrm_schema.leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL REFERENCES hrm_schema.leave_types(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    duration NUMERIC(5,2) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    workflow_instance_id UUID,
    attachment_file_id UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    timesheet_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hrm_leave_requests_emp ON hrm_schema.leave_requests(tenant_id, employee_id, status);

CREATE TABLE IF NOT EXISTS hrm_schema.leave_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL REFERENCES hrm_schema.leave_types(id),
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('ACCRUAL', 'USAGE', 'ADJUSTMENT', 'CARRYOVER_EXPIRE', 'REVERSAL')),
    days_changed NUMERIC(6,2) NOT NULL,
    balance_after NUMERIC(6,2) NOT NULL,
    reference_request_id UUID REFERENCES hrm_schema.leave_requests(id) ON DELETE SET NULL,
    accrual_schedule_id UUID REFERENCES hrm_schema.leave_accrual_schedules(id) ON DELETE SET NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_leave_tx_emp ON hrm_schema.leave_transactions(tenant_id, employee_id, leave_type_id);

-- ----------------------------------------------------------------------------
-- 6. HR e-Requests (Overtime, Business Trip, Shift Change)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.ot_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    work_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    planned_minutes INT NOT NULL,
    approved_minutes INT DEFAULT 0,
    actual_minutes INT DEFAULT 0,
    billable_ot_minutes INT DEFAULT 0,
    ot_type VARCHAR(50) NOT NULL DEFAULT 'WEEKDAY' CHECK (ot_type IN ('WEEKDAY', 'WEEKEND', 'HOLIDAY', 'NIGHT')),
    ot_rate_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.5,
    policy_version_id UUID REFERENCES hrm_schema.policy_versions(id),
    monthly_accumulated_ot_minutes INT DEFAULT 0,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    workflow_instance_id UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    timesheet_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_ot_requests_emp ON hrm_schema.ot_requests(tenant_id, employee_id, status);

CREATE TABLE IF NOT EXISTS hrm_schema.business_trip_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    business_trip_type VARCHAR(50) NOT NULL DEFAULT 'DOMESTIC' CHECK (business_trip_type IN ('DOMESTIC', 'OVERSEAS', 'INTERSITE')),
    destination VARCHAR(255) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    days_count NUMERIC(5,2) NOT NULL,
    allow_ot BOOLEAN NOT NULL DEFAULT false,
    per_diem_policy_id UUID REFERENCES hrm_schema.policies(id),
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    workflow_instance_id UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    timesheet_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_trip_requests_emp ON hrm_schema.business_trip_requests(tenant_id, employee_id, status);

CREATE TABLE IF NOT EXISTS hrm_schema.shift_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    change_type VARCHAR(50) NOT NULL DEFAULT 'SWAP' CHECK (change_type IN ('SWAP', 'CHANGE_SHIFT')),
    current_shift_id UUID NOT NULL REFERENCES hrm_schema.shift_definitions(id),
    requested_shift_id UUID NOT NULL REFERENCES hrm_schema.shift_definitions(id),
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    swap_with_employee_id UUID,
    swap_peer_confirmed BOOLEAN NOT NULL DEFAULT false,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PEER_CONFIRMED', 'APPROVED', 'REJECTED', 'CANCELLED')),
    workflow_instance_id UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_shift_change_emp ON hrm_schema.shift_change_requests(tenant_id, employee_id, status);

-- ----------------------------------------------------------------------------
-- 7. Timesheet & Monthly Aggregation
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.timesheet_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    period_code VARCHAR(50) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'APPROVED', 'LOCKED', 'REOPENED')),
    submitted_by UUID,
    submitted_at TIMESTAMPTZ,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    locked_by UUID,
    locked_at TIMESTAMPTZ,
    reopened_by UUID,
    reopened_at TIMESTAMPTZ,
    reopen_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_timesheet_periods_code UNIQUE (tenant_id, period_code)
);

CREATE TABLE IF NOT EXISTS hrm_schema.timesheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    period_id UUID NOT NULL REFERENCES hrm_schema.timesheet_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    work_date DATE NOT NULL,
    shift_id UUID REFERENCES hrm_schema.shift_definitions(id),
    attendance_id UUID REFERENCES hrm_schema.attendances(id),
    leave_request_id UUID REFERENCES hrm_schema.leave_requests(id),
    ot_request_id UUID REFERENCES hrm_schema.ot_requests(id),
    business_trip_request_id UUID REFERENCES hrm_schema.business_trip_requests(id),
    scheduled_minutes INT NOT NULL DEFAULT 480,
    worked_minutes INT NOT NULL DEFAULT 0,
    paid_minutes INT NOT NULL DEFAULT 0,
    ot_minutes INT NOT NULL DEFAULT 0,
    late_minutes INT NOT NULL DEFAULT 0,
    early_leave_minutes INT NOT NULL DEFAULT 0,
    workday_units NUMERIC(4,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'LEAVE', 'HOLIDAY', 'ABSENT', 'ADJUSTED')),
    is_manually_adjusted BOOLEAN NOT NULL DEFAULT false,
    adjusted_by UUID,
    adjusted_reason TEXT,
    calculation_snapshot JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_timesheets_emp_date UNIQUE (period_id, employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_hrm_timesheets_emp_period ON hrm_schema.timesheets(tenant_id, employee_id, period_id);

-- ----------------------------------------------------------------------------
-- 8. Salary Advance (Requests & Deductions)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.salary_advance_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    request_date DATE NOT NULL,
    requested_amount NUMERIC(15,2) NOT NULL,
    approved_amount NUMERIC(15,2) DEFAULT 0,
    disbursed_amount NUMERIC(15,2) DEFAULT 0,
    number_of_installments INT NOT NULL DEFAULT 1,
    total_deducted_amount NUMERIC(15,2) DEFAULT 0,
    remaining_balance NUMERIC(15,2) DEFAULT 0,
    reason TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DISBURSED', 'REJECTED', 'CANCELLED')),
    workflow_instance_id UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    disbursed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_advance_emp ON hrm_schema.salary_advance_requests(tenant_id, employee_id, status);

-- ----------------------------------------------------------------------------
-- 9. Payroll Configuration & Engine (Profiles, Periods, Runs, Items, Totals, Payslips, Deductions)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hrm_schema.employee_salary_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    salary_grade_id UUID REFERENCES hrm_schema.salary_grades(id),
    salary_step_id UUID REFERENCES hrm_schema.salary_grade_steps(id),
    salary_type VARCHAR(50) NOT NULL DEFAULT 'NET' CHECK (salary_type IN ('GROSS', 'NET')),
    base_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'VND',
    change_reason TEXT,
    effective_from DATE NOT NULL,
    effective_to DATE,
    approved_by UUID,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_emp_salary_profiles ON hrm_schema.employee_salary_profiles(tenant_id, employee_id, status);

CREATE TABLE IF NOT EXISTS hrm_schema.payroll_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    period_code VARCHAR(50) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    timesheet_period_id UUID REFERENCES hrm_schema.timesheet_periods(id),
    payment_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PROCESSING', 'LOCKED', 'PAID')),
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_payroll_periods_code UNIQUE (tenant_id, period_code)
);

CREATE TABLE IF NOT EXISTS hrm_schema.payroll_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    payroll_period_id UUID NOT NULL REFERENCES hrm_schema.payroll_periods(id) ON DELETE CASCADE,
    run_no INT NOT NULL DEFAULT 1,
    calculation_version VARCHAR(50) NOT NULL DEFAULT 'VN_LABOR_LAW_2026',
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'CALCULATED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'FINALIZED')),
    reviewer_id UUID,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejected_by UUID,
    rejection_reason TEXT,
    finalized_by UUID,
    finalized_at TIMESTAMPTZ,
    calculated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_payroll_runs UNIQUE (payroll_period_id, run_no)
);

CREATE TABLE IF NOT EXISTS hrm_schema.payroll_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    payroll_run_id UUID NOT NULL REFERENCES hrm_schema.payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    item_code VARCHAR(50) NOT NULL,
    item_type VARCHAR(50) NOT NULL CHECK (item_type IN ('EARNING', 'ALLOWANCE', 'OVERTIME', 'STATUTORY_DEDUCTION', 'TAX_DEDUCTION', 'ADVANCE_DEDUCTION', 'NET_PAY')),
    description VARCHAR(255) NOT NULL,
    quantity NUMERIC(10,2) DEFAULT 1.0,
    rate NUMERIC(15,2) DEFAULT 0,
    amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    source_type VARCHAR(50) DEFAULT 'TIMESHEET',
    source_id UUID,
    policy_version_id UUID REFERENCES hrm_schema.policy_versions(id),
    calculation_snapshot JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_payroll_items_emp_run ON hrm_schema.payroll_items(payroll_run_id, employee_id);

CREATE TABLE IF NOT EXISTS hrm_schema.payroll_employee_totals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    payroll_run_id UUID NOT NULL REFERENCES hrm_schema.payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    gross_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_allowance NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_ot_pay NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_statutory_deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
    advance_deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
    taxable_income NUMERIC(15,2) NOT NULL DEFAULT 0,
    personal_income_tax NUMERIC(15,2) NOT NULL DEFAULT 0,
    other_deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_salary NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(10) NOT NULL DEFAULT 'VND',
    payment_status VARCHAR(30) NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PAYMENT_QUEUED', 'PAID')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_payroll_totals UNIQUE (payroll_run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_hrm_payroll_totals_emp ON hrm_schema.payroll_employee_totals(tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS hrm_schema.payslips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    payroll_run_id UUID NOT NULL REFERENCES hrm_schema.payroll_runs(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    payslip_no VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'PUBLISHED', 'VIEWED', 'DOWNLOADED')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    file_id UUID,
    snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_hrm_payslips_no UNIQUE (tenant_id, payslip_no)
);
CREATE INDEX IF NOT EXISTS idx_hrm_payslips_emp ON hrm_schema.payslips(tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS hrm_schema.salary_advance_deductions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    advance_request_id UUID NOT NULL REFERENCES hrm_schema.salary_advance_requests(id) ON DELETE CASCADE,
    payroll_period_id UUID NOT NULL REFERENCES hrm_schema.payroll_periods(id),
    installment_no INT NOT NULL DEFAULT 1,
    scheduled_amount NUMERIC(15,2) NOT NULL,
    actual_deducted_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'DEDUCTED', 'SKIPPED', 'CANCELLED')),
    deducted_at TIMESTAMPTZ,
    payroll_run_id UUID REFERENCES hrm_schema.payroll_runs(id),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hrm_advance_deductions_req ON hrm_schema.salary_advance_deductions(advance_request_id, payroll_period_id);
