# Audit C - Mô hình dữ liệu, luồng dữ liệu liên module và phân quyền HRM

Phạm vi: phân tích tĩnh (không chạy migration, không truy vấn DB, không build/test). Repo E:\ERP, nhánh dev/release. Ngày: 2026-10-09.
Quy ước: "chưa xác minh" = không chứng minh được bằng đọc mã. Ghi chú từ điều phối: migration 0035, 0036 đã áp lên prod; shift_assignments / unit_shift_assignments không còn được code tra ca (đã xác nhận ở mục 1.4).

> TRẠNG THÁI: HOÀN TẤT (Part 1-4 + Phụ lục A).

---------------------------------------------------------------------

# PART 1 - DANH MỤC CƠ SỞ DỮ LIỆU

## 1.0 Tổng quan

- Migration HRM: migrations/tenant/hrm/0001..0036 (38 file; thiếu số 0023 và 0025 - chưa xác minh lý do, có thể nằm ở nhánh khác). Có các số trùng tiền tố (0002 x2, 0003 x2, 0015 x3, 0016 x3, 0021 x2) - thứ tự chạy theo tên file đầy đủ (chưa xác minh bộ chạy migration sắp xếp thế nào; xem tools/apply-hrm-migration.mjs và packages/platform/entitlement/src/lib/tenant-migrations.ts).
- Schema cuối cùng: 72 bảng trong hrm_schema + 1 view (hrm_schema.employee_directory). Comment đầu 0001-hrm.sql ghi "23 Tables" nhưng thực tế 0001 tạo 28 bảng (comment lỗi thời).
- Bảng Core liên quan (core_schema): users, employees (0006), organization_trees/node_types/nodes/node_assignments (0001..0006, 0009), roles/permissions/permission_actions/role_permissions/role_modules/user_roles/authorization_state/authorization_audit (0005), view core_schema.employee_career_history (0007-org-hrm-bridge).
- Khóa nối HRM-Core: employee_id (UUID) = core_schema.employees.id; FK (tenant_id, employee_id) -> core_schema.employees(tenant_id,id) chỉ có ở các bảng tạo từ 0003 trở đi (attendance_events, attendance_devices, notifications, payroll_employee_inputs, profile_corrections, attachments, employee_dependents, employee_family_members, employment_contracts, procedure_links, request_drafts, request_reversals, employee_qualifications) và employee_profiles (hrm_employee_core_fk, 0002-employee-identity). KHÔNG có FK employee_id ở: attendances, attendance_corrections, leave_balances, leave_requests, leave_transactions, ot_requests, business_trip_requests, shift_change_requests, timesheets, salary_advance_requests, employee_salary_profiles, payroll_items, payroll_employee_totals, payslips, shift_assignments, leave_carryovers, leave_settlements, personnel_decisions, employee_reporting_lines, employee_work_days, work_schedule_rules (0001 và 0009/0033..0036 không khai FK). Đây là rủi ro toàn vẹn tham chiếu (chỉ app-level).
- Tenant_id có ở hầu hết bảng nhưng chỉ vài FK ghép (tenant_id, id); các FK đơn (vd. policy_versions.policy_id, shift_id) không ép cùng tenant (DB mỗi tenant tách riêng database nên rủi ro thấp - chưa xác minh mô hình DB-per-tenant ở mọi môi trường; mã tenant-migrations cho thấy "dedicated database").
- Tên nhật ký: audit_log (chung) và work_schedule_audit (riêng lịch làm việc) - hai kho nhật ký song song.

## 1.1 Danh mục bảng theo domain

Cột "Ai đọc/ghi" chỉ nêu file chính (đường dẫn rút gọn: M = packages/modules/hrm/src/lib, F = packages/features/hrm/src/lib). I = infrastructure, P = presentation. Phép đếm tham chiếu lấy bằng grep tên bảng trên mã nguồn không phải spec (773 file .ts/.tsx/.mjs); tách đọc/ghi chi tiết "chưa xác minh" trừ khi nói rõ.

### A. Nhân sự - tổ chức - hợp đồng - quyết định

| Bảng | Mục đích | Cột chính / trạng thái (CHECK) | FK | Ai đọc/ghi |
|---|---|---|---|---|
| employee_profiles | Hồ sơ nhân sự mở rộng của core employees (1 dòng/NV) | PK employee_id; employee_code (unique theo tenant); join_date, official_date; employment_status IN (PROBATION, OFFICIAL, ON_LEAVE, RESIGNED, TERMINATED); inactive_from, inactive_reason (0016); gender IN (MALE,FEMALE,OTHER); photo/identity attachment ids (0031); deleted_at | (tenant_id,employee_id) -> core employees (RESTRICT); attachments x3 | I/hrm-lifecycle, hrm-context.service (tự tạo hồ sơ), hrm-timesheet-calculation, hrm-leave-*, hrm-payroll-calculation, P/hrm-employee.controller, ... (24 file) |
| employee_directory (VIEW) | Read model: profile + core employees + chức danh/phòng/bộ phận hiện hành từ organization_node_assignments + ngạch từ position_profiles | ep.* + user_id, full_name, work_email, position_*, department_*, division_name, salary_grade_* | - | 14 file (audit-trail, payroll-calculation, các controller). Chọn assignment theo is_primary DESC, created_at DESC, LIMIT 1, a.user_id = e.user_id (nhân viên không có user_id không có chức danh) |
| position_profiles | Mở rộng chức danh Core (node category=position) | PK position_id; salary_grade_id; default_policy_id; responsibilities/requirements/authorities JSONB; active | salary_grades, policies | hrm-lifecycle, hrm-field-mappings, org-hrm-bridge.consumer, P/hrm-employee, hrm-salary |
| employee_family_members | Thành viên gia đình tự khai (có cờ is_dependent) | relationship, is_dependent, dependent_from/to, deleted_at | (tenant,emp) -> core employees | hrm-family.ts, P/hrm-employee |
| employee_dependents | Đăng ký người phụ thuộc đã xác minh phục vụ thuế TNCN | reference_code, birth_date, evidence_reference, effective_from/to, verified_by | (tenant,emp) | P/hrm-dependent, hrm-payroll-calculation (đếm REGISTERED_DEPENDENT_COUNT). Lưu ý 0014 có nhánh RENAME bảng employee_dependents cũ sang employee_family_members cho tenant layout cũ |
| employment_contracts | Hợp đồng lao động | contract_code (unique khi chưa xóa), contract_type (text tự do), sign_date, effective_from/to, status IN (DRAFT, ACTIVE, EXPIRED, TERMINATED), base_salary, parent_contract_id (phụ lục, 0016), issued_snapshot/issued_at/issued_by, terminated_on, termination_reason, file_url | self FK parent; (tenant,emp) | hrm-contracts.ts, P/hrm-contract, hrm-employee, hrm-leave-policy-data (ngày ký HĐ đầu tiên làm cơ sở phép), hrm-field-mappings |
| personnel_decisions | Quyết định bổ nhiệm/thăng chức/điều chuyển/kiêm nhiệm/miễn nhiệm/đổi quản lý, gộp đổi lương | decision_type IN (APPOINT, PROMOTE, TRANSFER, CONCURRENT, DISMISS, CHANGE_MANAGER); status IN (DRAFT, APPROVED, APPLY_PENDING, APPLIED, REJECTED, CANCELLED); from_*/to_* (position node id + tên chụp, unit name, manager, salary grade/step/base); manager_mode (KEEP,SET,CLEAR), subordinate_mode (KEEP,REASSIGN); applied_steps JSONB; core_assignment_id; version | salary_grades, steps, attachments; nút Core chỉ lưu id (không FK, khác schema) | hrm-personnel-decisions.ts, P/hrm-personnel-decision |
| employee_reporting_lines | Quản lý trực tiếp theo ngày hiệu lực (nhân viên -> nhân viên) | relation_type IN (DIRECT, DOTTED); effective_from/to; source IN (DECISION, MANUAL, IMPORT, CORE_SYNC); unique 1 DIRECT mở / nhân viên | decision_id -> personnel_decisions | CHỈ hrm-personnel-decisions.ts (ghi từ quyết định; đọc cho endpoint reporting-lines/subordinates). KHÔNG dùng cho phạm vi duyệt đơn (xem Part 3/4). Giá trị MANUAL/IMPORT/CORE_SYNC/DOTTED không có đường ghi trong mã (chỉ type FE/contract) |
| employee_qualifications | Bằng cấp/chứng chỉ/hộ chiếu/giấy phép | qualification_type IN (DEGREE, CERTIFICATE, LANGUAGE, PROFESSIONAL, PASSPORT, WORK_PERMIT, LICENSE, OTHER); expiry_date; attachment_id | attachments | hrm-profile-documents.ts, P/hrm-attachment |
| profile_corrections | Đơn điều chỉnh hồ sơ (self-service) | changes, previous_values, document_changes JSONB; status IN (PENDING, APPROVED, REJECTED, CANCELLED); procedure_instance_id | (tenant,emp) | P/hrm-profile-correction, hrm-request-transition, hrm-procedure-links |
| salary_grades | Ngạch lương | code, name, status IN (ACTIVE, INACTIVE), deleted_at | - | P/hrm-salary, hrm-lifecycle |
| salary_grade_steps | Bậc lương (khung min/mid/max + base) | step_no (unique/ngạch), min/mid/max/base_salary, effective_from/to, status IN (ACTIVE, INACTIVE), deleted_at | salary_grades CASCADE | P/hrm-salary, hrm-personnel-decisions. Cột mid_salary, min/max chỉ ở hrm-salary.controller (CRUD) - không dùng khi tính lương |

### B. Ca làm việc và lịch (shift + schedule)

| Bảng | Mục đích | Cột chính / trạng thái | FK | Ai đọc/ghi |
|---|---|---|---|---|
| shift_definitions | Danh mục ca (nguồn duy nhất của giờ ca) | code, start_time, end_time, break_minutes, break_start/end_time, cross_midnight, grace_late/early_minutes, check_in_before_minutes, check_out_after_minutes, status IN (ACTIVE, INACTIVE) | - | hrm-shift-resolution, hrm-work-schedule(+rules), hrm-shift-change, P/hrm-shift |
| work_schedule_templates / work_schedule_template_days | Mẫu lịch tuần (weekday ISO 1..7; day_type SHIFT/OFF) | status IN (ACTIVE, INACTIVE) | shift_definitions | hrm-work-schedule(+rules), P/hrm-work-schedule |
| work_schedule_batches | Mỗi lần phân ca/ngoại lệ/lễ/hủy/sao chép là một đợt; lưu pattern_snapshot | kind IN (ASSIGN, EXCEPTION, HOLIDAY, CANCEL, COPY); scope_type IN (EMPLOYEE, EMPLOYEES, UNIT, COMPANY) | - | hrm-work-schedule(+rules) |
| employee_work_days | Lịch từng ngày đã sinh sẵn (NV x ngày) | day_type IN (SHIFT, OFF, HOLIDAY); source IN (TEMPLATE, MANUAL, EXCEPTION, HOLIDAY); status IN (ACTIVE, CANCELLED); cancel_reason; shift_snapshot (chỉ đối soát); unique (tenant,emp,date) WHERE ACTIVE | shift_definitions, company_holidays, batches | hrm-shift-resolution (tra ca), hrm-time, hrm-shift-change, hrm-work-schedule, P/hrm-shift |
| work_schedule_rules / work_schedule_rule_days | Lịch định kỳ không ngày kết thúc theo EMPLOYEE/UNIT/COMPANY; mẫu tuần được chụp lại | status IN (ACTIVE, CANCELLED); effective_to NULL = vô hạn; template_name chụp | core organization_nodes (unit), batches | hrm-work-schedule-resolve/rules, P/hrm-shift, hrm-work-schedule |
| company_holidays | Ngày lễ/Tết/làm bù/đặc biệt theo phạm vi | kind IN (HOLIDAY, TET, COMPENSATORY, SPECIAL); scope_type IN (COMPANY, UNIT, EMPLOYEES); treatment IN (OFF, SHIFT); paid; status IN (ACTIVE, CANCELLED); calendar_ids uuid[] | shift_definitions | hrm-work-schedule, P/hrm-work-schedule |
| work_schedule_audit | Nhật ký lịch (before/after theo đoạn ngày) | action, batch_id, employee_id, unit_id | batches | hrm-work-schedule(+rules), hrm-shift-change |
| shift_assignments (LEGACY) | Gán ca cá nhân theo khoảng ngày (cũ) | source IN (MANUAL, SCHEDULE_POLICY, SWAP_REQUEST); status IN (ACTIVE, SUPERSEDED, CANCELLED) | shift_definitions CASCADE | KHÔNG còn bị tra ca: hrm-shift-resolution.ts (header: "Các bảng gán ca cũ ... không còn được dùng để tra ca"). Còn tham chiếu: hrm-audit-trail.ts (chỉ dựng nhãn cho log ROSTER_*) + 8 script thủ công (scripts/*.mjs). hrm-roster.ts và controller unit-shift đã bị xóa khỏi working tree. Giá trị source SCHEDULE_POLICY/SWAP_REQUEST không có đường ghi nào |
| unit_shift_assignments (LEGACY) | Gán ca theo đơn vị, kế thừa lên cây (0034) | status IN (ACTIVE, CANCELLED) | core organization_nodes, shift_definitions | KHÔNG còn code đọc/ghi (chỉ nhắc trong comment hrm-shift-resolution.ts). Ứng viên bỏ |
| work_calendar | Lịch ngày làm/nghỉ/lễ toàn công ty theo ngày (cũ, 0003) | day_kind IN (WORK, OFF, HOLIDAY); paid | - | hrm-time (dayKindOf/effectiveDayKind), hrm-timesheet-calculation, hrm-leave-*, hrm-overtime, P/hrm-time-settings, hrm-operations. Vẫn SỐNG; trùng chức năng với company_holidays (xem 1.3) |

### C. Chấm công (attendance)

| Bảng | Mục đích | Cột chính / trạng thái | FK | Ai đọc/ghi |
|---|---|---|---|---|
| attendance_events | Sự kiện thô IN/OUT (nguồn sự thật chấm công) | event_kind IN (IN, OUT); source; external_event_id (unique theo tenant+source); voided_by_correction_id; evidence JSONB; work_date | (tenant,emp) -> core employees | hrm-attendance-ingest, hrm-time (recalculate), hrm-timesheet-calculation (đọc), hrm-request-transition (giải trình), hrm-request-reversal, P/hrm-attendance |
| attendances | Tổng hợp ngày (check_in/out, worked/late/early, calculation_snapshot), 1 dòng/NV/ngày | status IN (VALID, LATE, EARLY_LEAVE, MISSING_PUNCH, ABNORMAL, APPROVED_CORRECTION); attendance_source IN (BIOMETRIC_DEVICE, MOBILE_GPS, WEB_PORTAL, MANUAL_CORRECTION) | không FK emp | hrm-time.recalculateAttendance (ghi), hrm-attendance-ingest, P/hrm-attendance, hrm-dashboard, FE attendance-screen/timesheets-screen. status APPROVED_CORRECTION không bao giờ được ghi (mã dùng calculation.status) |
| attendance_corrections | Đơn giải trình công | status IN (PENDING, APPROVED, REJECTED, CANCELLED); corrected_sessions JSONB; applied_at, timesheet_updated_at; procedure_* | attendances SET NULL | P/hrm-attendance, hrm-request-transition |
| attendance_sites | Địa điểm chấm công GPS | latitude, longitude, radius_meters, active | - | hrm-attendance-ingest, P/hrm-time-settings |
| attendance_devices | Trình duyệt/thiết bị chấm công của NV | status IN (PENDING, ACTIVE, REVOKED); 1 ACTIVE/NV (unique index) | (tenant,emp) | hrm-attendance-ingest, P/hrm-time-settings |

### D. Bảng công (timesheet)

| Bảng | Mục đích | Cột chính / trạng thái | FK | Ai đọc/ghi |
|---|---|---|---|---|
| timesheet_periods | Kỳ công | status IN (OPEN, SUBMITTED, APPROVED, LOCKED, REOPENED); calculated_at; locked_by/at; reopened_*; unique period_code | - | hrm-timesheet-calculation, hrm-time (assertOpenRange), P/hrm-timesheet, hrm-payroll. SUBMITTED/APPROVED không có đường ghi (chưa xác minh toàn bộ; grep trong hrm-timesheet.controller chỉ thấy LOCKED/REOPENED) |
| timesheets | Dòng công NV x ngày trong kỳ | status IN (NORMAL, LEAVE, HOLIDAY, ABSENT, ADJUSTED, OFF, BUSINESS_TRIP, ABNORMAL) (0005 thay CHECK); scheduled/worked/paid/ot/late/early minutes; workday_units; is_manually_adjusted; adjustment_needs_review (0019); calculation_snapshot; shift_id | period CASCADE; shift_definitions; attendance_id; leave_request_id; ot_request_id; business_trip_request_id | hrm-timesheet-calculation (ghi), hrm-payroll-calculation (đọc), P/hrm-timesheet, hrm-dashboard. Cột ot_request_id không bao giờ được ghi (chỉ đọc trong controller); leave_request_id chỉ lưu đơn nghỉ đầu tiên (id đầy đủ ở snapshot.leaveIds/otIds/tripIds) |

### E. Nghỉ phép (leave)

| Bảng | Mục đích | Cột chính / trạng thái | FK | Ai đọc/ghi |
|---|---|---|---|---|
| leave_types | Loại nghỉ | unit IN (DAYS, HOURS); paid; deduct_balance; negative_limit; carryover_*; merged_into_id/merged_at (0024) | self | hrm-leave-*, hrm-subtype-catalog, P/hrm-leave |
| leave_balances | Quỹ phép/năm (tổng hợp có thể tính lại) | opening_balance, accrued, used, pending, adjusted, remaining, seniority_days, carryover_remaining, carryover_expiry_date, max_negative_allowed | leave_types CASCADE | hrm-leave-balance/carryover/reconcile/merge/settlement, P/hrm-leave, hrm-dashboard |
| leave_transactions | SỔ CÁI phép (ledger) | transaction_type IN (ACCRUAL, SENIORITY_ACCRUAL, USAGE, ADJUSTMENT, CARRYOVER_EXPIRE, CARRYOVER_IN, CARRYOVER_OUT, YEAR_END_RESET, RECOVERY, REVERSAL) (0033); days_changed; balance_after; operation_key (unique idempotent); reference_request_id; accrual_schedule_id; actor_id | leave_requests/accrual_schedules SET NULL | hrm-leave-accrual/carryover/operations/reconcile/merge/settlement, P/hrm-leave |
| leave_accrual_schedules | Lịch cộng phép (gồm cơ sở HĐ ký) | accrual_frequency IN (MONTHLY, QUARTERLY, YEARLY, MILESTONE); accrual_basis IN (JOIN_DATE, CONTRACT_SIGN_DATE); annual_days, start_offset_months, advance_allowed; effective_from/to; policy_version_id | leave_types, policy_versions | hrm-leave-accrual/schedule/annual-leave/policy-data, P/hrm-leave, hrm-payroll-settings. proration_rule/seniority_bonus_* thuộc lịch cũ (JOIN_DATE) |
| leave_seniority_tiers | Mốc thâm niên nhiều bậc (lịch CONTRACT_SIGN_DATE) | min_years, bonus_days | schedule CASCADE | hrm-annual-leave, hrm-leave-schedule, P/hrm-leave |
| leave_requests | Đơn nghỉ | status IN (PENDING, APPROVED, REJECTED, CANCELLED); duration; is_negative_leave; balance_reserved; seniority_days_used; attachment_file_id; procedure_instance_id; workflow_status | leave_types | hrm-leave-operations, hrm-timesheet-calculation (đọc), hrm-leave-settlement, P/hrm-leave, hrm-request. workflow_instance_id: chỉ ánh xạ đọc, không ghi (legacy) |
| leave_request_days | Chi tiết từng ngày đơn nghỉ (quantity, paid_minutes) tại thời điểm duyệt | PK (request_id, work_date) | leave_requests | hrm-leave-operations (ghi), hrm-timesheet-calculation (đọc) |
| leave_carryovers / leave_carryover_usage | Phép tồn chuyển năm và dùng theo đơn | reserved/used/expired; state IN (RESERVED, USED, REVERSED) | leave_types, requests | hrm-leave-carryover/reconcile/merge |
| leave_settlements | Quyết toán phép khi nghỉ việc, thu hồi vào kỳ lương | status IN (PENDING, SCHEDULED, DEDUCTED, WAIVED, CLOSED, REVERSED); excess_days, recovery_amount, payroll_period_id/run_id | leave_types, payroll_periods, payroll_runs | hrm-leave-settlement, hrm-payroll-calculation (đọc SCHEDULED), hrm-payroll.controller (finalize -> DEDUCTED) |

### F. Tăng ca, công tác, đổi ca, tạm ứng (đơn nghiệp vụ)

| Bảng | Mục đích | Cột chính / trạng thái | Ai đọc/ghi |
|---|---|---|---|
| ot_requests | Đơn tăng ca | ot_type IN (WEEKDAY, WEEKEND, HOLIDAY, NIGHT); status IN (PENDING, APPROVED, REJECTED, CANCELLED); approved/actual/billable_ot_minutes; ot_rate_multiplier; policy_version_id; is_night_ot, exceeds_*_limit (chỉ ghi ở request controller); monthly_accumulated_ot_minutes | hrm-overtime, hrm-timesheet-calculation (ghi actual/billable ngược lại vào đơn), P/hrm-request |
| business_trip_requests | Đơn công tác | business_trip_type IN (DOMESTIC, OVERSEAS, INTERSITE); allow_ot; per_diem_policy_id; project/work refs; destination_lat/lng; work_reference JSONB | P/hrm-request, hrm-timesheet-calculation (đọc). per_diem_policy_id chỉ ở request controller; không có tính công tác phí trong payroll |
| shift_change_requests | Đơn đổi ca (SWAP/CHANGE_SHIFT) | status IN (PENDING, PEER_CONFIRMED, APPROVED, REJECTED, CANCELLED); swap_with_employee_id; submitted_by, submitted_attributes | hrm-shift-change (ghi employee_work_days khi duyệt), P/hrm-request |
| salary_advance_requests | Tạm ứng | status IN (PENDING, APPROVED, DISBURSED, REPAID, REJECTED, CANCELLED) (0011); approved/disbursed/total_deducted/remaining_balance | P/hrm-salary, hrm-payroll (finalize cập nhật remaining), hrm-payroll-calculation |
| salary_advance_deductions | Lịch thu hồi theo kỳ lương | status IN (SCHEDULED, DEDUCTED, SKIPPED, CANCELLED); installment_no; payroll_run_id | hrm-payroll-calculation (đọc SCHEDULED), hrm-payroll finalize, hrm-request-reversal, P/hrm-salary. SKIPPED không có đường ghi |
| request_drafts | Nháp đơn (7 loại) | status IN (DRAFT, SUBMITTED, DELETED); payload JSONB | hrm-request-drafts, hrm-submission, P/hrm-operations |
| request_reversals | Hủy hiệu lực đơn đã duyệt (before_snapshot) | request_kind IN (leave, ot, business_trip, correction, advance) | hrm-request-reversal (duy nhất) |

### G. Workflow / Procedure Engine

| Bảng | Mục đích | Ghi chú | Ai đọc/ghi |
|---|---|---|---|
| request_procedure_bindings | Cấu hình chế độ duyệt theo loại đơn/sub-type (DIRECT hoặc PROCEDURE) | mode IN (DIRECT, PROCEDURE); configuration_status IN (ACTIVE, CONFLICT); condition_rules JSONB (0030 ghi chú "không còn được dùng", 0 tham chiếu code) | hrm-procedure-links, hrm-procedure-bridge, hrm-field-mappings, P/hrm-operations, tenant-provisioning.processor (seed DIRECT) |
| request_procedure_field_mappings | Ánh xạ trường HRM -> thuộc tính Procedure | scope IN (any, process, step); transform; mode IN (OVERWRITE, PREFILL) | hrm-field-mappings.ts (duy nhất) |
| procedure_links | Liên kết đơn <-> instance Procedure (revision), có lease/retry | sync_status IN (START_PENDING, RUNNING, APPLY_PENDING, APPLIED, FAILED, CONFLICT); definition_snapshot (0015-snapshot); current_step_* | hrm-procedure-links/sync/bridge/progress, hrm-approval-policy, hrm-submission, hrm-request-reversal, P/* |
| procedure_correlations / procedure_result_inbox / procedure_step_inbox | Tương quan, hộp thư kết quả (idempotent theo event_id), hộp thư bước | status IN (PENDING, APPLIED, FAILED, REJECTED) / (PENDING, APPLIED, SKIPPED, FAILED) | hrm-procedure-sync, hrm-procedure-progress |
| workflow_rules, workflow_links, workflow_callbacks (LEGACY) | Cơ chế workflow đời đầu (0012) | KHÔNG còn tham chiếu nào trong mã ứng dụng (chỉ migration 0012 và backfill 0015 đọc sang procedure_links/bindings; trigger record_request_event đã thay ở 0015 nên không còn tạo workflow_links) | Ứng viên bỏ (sau khi xác minh dữ liệu prod) |
| approval_policy_settings | allow_self_approval theo tenant | | hrm-approval-policy(-settings) |
| Cột procedure_instance_id, current_step_name, current_assignee_id/name, workflow_status | Trên 7 bảng đơn (0002, 0029) | trùng với procedure_links.instance_id/current_step_* (lưu hai nơi) | hrm-procedure-progress, hrm-procedure-links |

### H. Chính sách (policy)

| Bảng | Mục đích | Cột | Ai đọc/ghi |
|---|---|---|---|
| policies | Khung chính sách | policy_type IN (ATTENDANCE, LEAVE, OT, PAYROLL, SHIFT, GENERAL); status IN (ACTIVE, INACTIVE, DEPRECATED); unique 1 ACTIVE/tenant cho ATTENDANCE, PAYROLL, OT (0022, có thể bỏ qua nếu dữ liệu vi phạm) | hrm-policy-versions, hrm-time, P/hrm-policy, hrm-time-settings, hrm-payroll-settings, hrm-leave-schedule |
| policy_versions | Phiên bản có hiệu lực theo ngày; config_json (công thức lương, giờ OT, timezone, weeklyOffDays, employeeIds...) | status IN (DRAFT, ACTIVE, SUPERSEDED); effective_from/to | hrm-time.resolvePolicy, hrm-policy-versions, hrm-payroll-calculation, P/hrm-policy, hrm-time-settings, hrm-payroll-settings |
| automation_settings / automation_runs | Lịch chạy tự động tích phép/chuyển phép | | hrm-automation, apps/worker/src/main.ts, P/hrm-operations |
| payroll_sod_settings | Phân tách nhiệm vụ lương | separate_calc_finalize, separate_finalize_publish | hrm-payroll-sod, P/hrm-payroll-sod |

### I. Lương (payroll), tạm ứng, phiếu lương

| Bảng | Mục đích | Cột chính / trạng thái | Ai đọc/ghi |
|---|---|---|---|
| employee_salary_profiles | Hồ sơ lương NV có hiệu lực theo ngày (effective_from/to) | salary_type IN (GROSS, NET); base_salary; status IN (ACTIVE, SUPERSEDED, CANCELLED); salary_grade_id/step_id; change_reason | P/hrm-salary, hrm-personnel-decisions.applySalaryStep, hrm-payroll-calculation (đọc), hrm-leave-settlement (đơn giá phép), hrm-payroll.generatePayslips |
| payroll_employee_inputs | Tham số lương theo NV có hiệu lực theo ngày (JSONB) | PK (tenant, emp, effective_from) | hrm-payroll-calculation, P/hrm-payroll-settings |
| payroll_periods | Kỳ lương | status IN (OPEN, PROCESSING, LOCKED, PAID); timesheet_period_id; payment_date | hrm-payroll-*, hrm-leave-settlement, hrm-personnel-decisions. PROCESSING không có đường ghi; LOCKED do finalize; PAID do record-payment khi mọi dòng đã trả |
| payroll_runs | Lần tính lương | status IN (DRAFT, CALCULATED, IN_REVIEW, APPROVED, REJECTED, FINALIZED, CANCELLED) (0020); calculation_version; calculated_by/finalized_by/published_by (0026); cancel_* | P/hrm-payroll, hrm-payroll-calculation. IN_REVIEW/REJECTED không có đường ghi; APPROVED chỉ được chấp nhận làm trạng thái đầu vào của finalize nhưng không có chỗ đặt; reviewer_* chỉ ở controller (chưa thấy ghi) |
| payroll_items | Dòng lương theo NV (công thức + điều chỉnh tay MANUAL_ADJUSTMENT + LEAVE_RECOVERY) | item_type IN (EARNING, ALLOWANCE, OVERTIME, STATUTORY_DEDUCTION, TAX_DEDUCTION, ADVANCE_DEDUCTION, OTHER_DEDUCTION, NET_PAY); source_type; policy_version_id; calculation_snapshot JSONB (formula, inputs, components, dependentIds) | hrm-payroll-calculation (ghi), P/hrm-payroll (đọc, điều chỉnh tay) |
| payroll_employee_totals | Tổng theo NV + chi trả | payment_status IN (UNPAID, PAYMENT_QUEUED, PAID); beneficiary_snapshot (0013); payment_reference, paid_at | hrm-payroll-calculation, P/hrm-payroll-settings (record-payment), hrm-payroll. PAYMENT_QUEUED không có đường ghi |
| payslips | Phiếu lương | status IN (GENERATED, PUBLISHED, VIEWED, DOWNLOADED); snapshot_json (period, total, salaryProfiles, items); file_id | P/hrm-payroll (generate -> PUBLISHED ngay; đọc lọc PUBLISHED/VIEWED/DOWNLOADED). GENERATED/VIEWED/DOWNLOADED không có đường ghi; file_id không ghi |

### J. Tài liệu / đính kèm
| attachments | Tệp đính kèm hồ sơ (object storage) | status IN (UPLOADING, READY); document_type IN (PHOTO, ID_CARD_FRONT, ID_CARD_BACK, QUALIFICATION); is_confidential; deleted_at/by/reason; size 1..10MB | (tenant,emp) | P/hrm-attachment, hrm-profile-document, hrm-profile-documents.ts, hrm-leave-operations, hrm-procedure-bridge |

### K. Nhật ký, thông báo, outbox
| Bảng | Mục đích | Ghi chú |
|---|---|---|
| audit_log | Nhật ký nghiệp vụ chung (action, entity_type, entity_id, detail JSONB) | Ghi ở 18 file; đọc bởi hrm-audit-trail.listAuditTrail (endpoint GET operations/audit, quyền hrm.audit.read). entity_type hầu như không được dùng để phân giải (tra theo entity_id bằng UNION trên 35 bảng - ENTITY_SOURCES) |
| work_schedule_audit | Nhật ký riêng lịch làm việc | Không hiển thị trong màn audit chung (kho thứ hai) |
| notifications (LEGACY, hrm_schema) | Thông báo đơn cũ | Từ 0021 trigger record_request_event không còn INSERT vào bảng này (chỉ ghi outbox -> notification_schema). Chỉ còn P/hrm-operations GET my-notifications / POST my-notifications/:id/read đọc và đánh dấu đã đọc dữ liệu cũ. Bảng đóng băng. |
| integration_schema.outbox_events | Outbox sự kiện (hrm.request.created/status-changed, hrm.employee.offboarded, hrm-payslip) | Ghi bởi trigger DB (record_request_event, record_employee_offboarded_event) và payslip generate; tiêu thụ bởi org-hrm-bridge.consumer.ts, notification-worker |
| Trigger DB | hrm_workflow_guard (BEFORE UPDATE OF status trên 7 bảng đơn): chặn APPROVED/REJECTED/CANCELLED khi đơn có procedure_links trừ khi set hrm.workflow_callback/hrm.business_reversal; hrm_request_event; trg_hrm_employee_offboarded | |

## 1.2 Lược đồ ghi chú các thay đổi sau cùng (ALTER/DROP/RENAME)

- timesheets.status CHECK thay 0005 (thêm OFF, BUSINESS_TRIP, ABNORMAL); payroll_items.item_type thêm OTHER_DEDUCTION (0006); salary_advance_requests.status thêm REPAID (0011); payroll_runs.status thêm CANCELLED (0020); leave_transactions.transaction_type mở rộng (0033); leave_accrual_schedules thêm accrual_basis và 3 CHECK (0033).
- employee_dependents <-> employee_family_members: 0014 có thể đổi tên bảng cũ (layout tự khai) rồi tạo employee_family_members; employee_dependents mới (0013) có reference_code, verified_by.
- employee_directory được tái tạo bằng CREATE OR REPLACE VIEW ... existing.* + cột mới (0014, 0031) để giữ thứ tự cột.
- guard_workflow_transition viết lại 3 lần (0012 -> 0015 -> 0018).
- RBAC Core: 0005-tenant-rbac-legacy-compat đổi roles.code -> key, thay role_permissions.permission_key bằng permission_id + bảng permissions/permission_actions, lưu rbac_legacy_archive; 0007-default-tenant-user-role đổi legacy-tenant-user thành tenant-user ('Nhân viên mặc định').
- Không có DROP TABLE nào trong 36 migration HRM: bảng cũ (workflow_*, shift_assignments, unit_shift_assignments, notifications) vẫn còn trong schema.

## 1.3 Bảng/chức năng trùng lặp, chồng lấn

| Cặp / nhóm | Phân tích | Rủi ro / đề xuất |
|---|---|---|
| attendance_events vs attendances vs timesheets | events = dữ liệu thô nguồn; attendances = tổng hợp ngày do hrm-time.recalculateAttendance ghi (gọi calculateAttendance); timesheets = dòng công kỳ do hrm-timesheet-calculation ghi (gọi lại calculateAttendance từ events, KHÔNG đọc attendances; chỉ đọc id attendances để gán attendance_id). Cùng thuật toán chạy hai nơi, hai snapshot. | Trùng tính toán + trùng lưu trữ; hai kết quả có thể lệch nhau nếu ca/lịch đổi giữa hai thời điểm. attendances có thể thay bằng view hoặc chỉ cache; FE attendance-screen đọc attendances còn bảng công đọc timesheets. |
| work_calendar vs company_holidays vs employee_work_days(HOLIDAY) vs policy weeklyOffDays | work_calendar (toàn công ty theo ngày, 0003) vẫn là nguồn "day_kind" cho timesheet/leave/OT; company_holidays (0035) lưu lễ theo phạm vi và sinh calendar_ids vào work_calendar khi COMPANY + sinh employee_work_days HOLIDAY. weeklyOffDays nằm trong policy_versions.config_json. Thứ tự ưu tiên: employee_work_days (qua applyScheduleDayKind) > work_calendar > weeklyOffDays. | 4 nguồn "ngày nghỉ"; người dùng có hai nơi cấu hình ngày lễ (màn Cấu hình công và màn Phân ca). |
| workflow_rules/workflow_links vs request_procedure_bindings/procedure_links | Hai thế hệ; thế hệ cũ chết trong mã. | Bỏ sau backfill (đã backfill ở 0015). |
| shift_assignments / unit_shift_assignments vs employee_work_days / work_schedule_rules | Thế hệ cũ gán ca theo khoảng ngày/đơn vị; thế hệ mới (0035, 0036) thay thế hoàn toàn trong tra ca. Dữ liệu cũ KHÔNG được migrate sang lịch mới (không có script nằm trong migrations 0035/0036 - 0035 nói "Chỉ thêm bảng mới"). | Nhân viên chỉ có ca bằng shift_assignments trước đây giờ không có ca (picked = null, NO_SHIFT) nếu chưa được phân lại; cần xác nhận đã chạy cutover dữ liệu (chưa xác minh trên prod). |
| policies/policy_versions vs payroll settings vs leave_accrual_schedules vs approval/sod settings | Cấu hình rải 4 nơi: (1) policy_versions.config_json cho ATTENDANCE/PAYROLL/OT (qua hrm-time-settings, hrm-payroll-settings; có thêm controller generic hrm-policy.controller yêu cầu hrm.manage); (2) leave_accrual_schedules có policy_version_id nhưng lịch phép không đọc config policy; (3) payroll_sod_settings, approval_policy_settings, automation_settings là bảng thiết lập riêng một dòng/tenant. policies.policy_type SHIFT/LEAVE/GENERAL không có người dùng. | Không có "một nơi" xem toàn bộ chính sách; hrm-policy.controller (hrm.manage) là cửa thứ hai ghi cùng bảng với hrm.time.configure / hrm.payroll.configure -> bypass phân quyền chi tiết nếu hrm.manage; ngược lại role C&B không dùng được. |
| salary: employment_contracts.base_salary vs employee_salary_profiles vs personnel_decisions.to_base_salary vs salary_grade_steps.base_salary | Lương lưu ở 4 nơi. Payroll CHỈ đọc employee_salary_profiles. Hợp đồng không cập nhật hồ sơ lương và ngược lại. | Hợp đồng/phụ lục đổi lương không tự ảnh hưởng lương (cần nhập hồ sơ lương riêng); dễ lệch. |
| Quản lý trực tiếp: employee_reporting_lines (HRM) vs core reports_to_position_id/head_position_id/reports_to_position_override_id (Core) | Phạm vi duyệt đơn dùng Core (HrmOrgScopePort -> subordinateUserIds, đọc snapshot tổ chức qua API Platform), còn quyết định nhân sự ghi employee_reporting_lines. | Hai nguồn cấp bậc quản lý; thay đổi quản lý bằng quyết định CHANGE_MANAGER KHÔNG làm đổi phạm vi duyệt. |
| leave_balances (tổng hợp) vs leave_transactions (ledger) vs leave_carryovers | balances có cột remaining/used/pending/adjusted cập nhật trực tiếp; có hrm-leave-reconcile.ts đối soát balances với ledger. | Có cơ chế reconcile; vẫn là lưu hai nơi. |
| Cột trạng thái tiến độ duyệt trên 7 bảng đơn vs procedure_links | procedure_instance_id, current_step_name/assignee, workflow_status lưu trên bảng đơn và current_step_*/instance_id trên procedure_links | Hai nơi, đồng bộ qua hrm-procedure-progress. |
| audit_log vs work_schedule_audit vs core.authorization_audit vs bảng đơn lưu snapshot (request_reversals.before_snapshot) | Nhiều kho nhật ký | Màn "Nhật ký nghiệp vụ" chỉ hiển thị audit_log. |

## 1.4 Danh sách ứng viên không dùng (CHỈ là ứng viên, cần xác minh dữ liệu prod)

Bảng không có tham chiếu trong mã ứng dụng (không tính migration/spec/script):
1. workflow_rules, workflow_links, workflow_callbacks (0 tham chiếu).
2. unit_shift_assignments (0 tham chiếu thực thi; chỉ comment).
3. shift_assignments (chỉ audit-trail để dựng nhãn log ROSTER_* cũ và scripts/*.mjs diagnostic).
4. hrm_schema.notifications: không còn đường ghi (từ 0021), chỉ có endpoint đọc dữ liệu cũ.

Cột / trạng thái tồn tại nhưng không bao giờ được ghi (theo grep):
- request_procedure_bindings.condition_rules (0 tham chiếu; 0030 ghi chú đã bỏ).
- *.workflow_instance_id trên 5 bảng đơn (chỉ được map ra DTO, không ghi) - thay bằng procedure_instance_id.
- timesheets.ot_request_id (không ghi); timesheets.leave_request_id chỉ giữ đơn đầu tiên.
- payslips.status GENERATED/VIEWED/DOWNLOADED và file_id; payroll_employee_totals.payment_status PAYMENT_QUEUED; payroll_runs.status IN_REVIEW/REJECTED (APPROVED chỉ được chấp nhận ở finalize); payroll_periods.status PROCESSING; payroll_runs.reviewer_id/reviewed_at/review_notes/approved_*/rejected_*.
- attendances.status APPROVED_CORRECTION; timesheet_periods.status SUBMITTED/APPROVED (chưa thấy đường ghi); salary_advance_deductions.status SKIPPED; policies.status DEPRECATED; shift_assignments.source SCHEDULE_POLICY/SWAP_REQUEST.
- employee_reporting_lines: relation_type DOTTED và source MANUAL/IMPORT/CORE_SYNC (chỉ DECISION được ghi).
- employment_contracts.file_url có ghi nhưng đồng thời hệ thống có attachments (hai cách đính kèm).
- business_trip_requests.per_diem_policy_id, position_profiles.default_policy_id: chỉ lưu, không có logic tiêu thụ ngoài CRUD (chưa xác minh đầy đủ).
- leave_requests.attachment_file_id vs attachments (id trỏ không FK).
- ot_requests.monthly_accumulated_ot_minutes, exceeds_*_limit: ghi ở request controller; không dùng khi tính công (chưa xác minh ở FE).
- 0001 chứa mid_salary/min/max_salary của salary_grade_steps: chỉ CRUD, không dùng tính lương.

Đánh dấu "thiếu FK employee_id" ở mục 1.0 là rủi ro dữ liệu mồ côi.

---------------------------------------------------------------------

# PART 2 - BẢO TOÀN LỊCH SỬ DỮ LIỆU

Quy ước cột "Lịch sử giữ?": CÓ / MỘT PHẦN / KHÔNG.

| # | Kịch bản | Cách lưu | Lịch sử giữ? | Bằng chứng | Rủi ro / khoảng trống |
|---|---|---|---|---|---|
| 1 | NV chuyển phòng ban | Phân công ở Core: organization_node_assignments (start_date, end_date, status, is_primary, source_decision_id). Quyết định HRM (TRANSFER/PROMOTE/APPOINT) gọi endpoint Core applyAppointment: kết thúc phân công cũ (end_date = effectiveDate-1, status 'ended' nếu đã qua, is_primary=false) rồi INSERT phân công mới (platform-identity.service.ts:1011-1140; hrm-personnel-decisions.ts runApply:1028). | CÓ (dòng phân công cũ không xóa); HRM giữ thêm ảnh chụp tên trong personnel_decisions (from/to_position_name, from/to_unit_name, from/to_salary_*). | core 0007-org-hrm-bridge: view employee_career_history; migration 0032 (comment "ảnh chụp trước/sau kể cả tên"). | (a) Timesheet/payroll/attendance KHÔNG lưu đơn vị: báo cáo theo phòng ban tại thời điểm phải suy ngược từ phân công Core. (b) employee_career_history chỉ JOIN nút chưa xóa mềm (pos.deleted_at IS NULL) nên chức danh bị xóa mềm làm mất dòng lịch sử trong view. (c) Tên chức danh/đơn vị trong view là tên HIỆN TẠI. (d) Phân công sửa tay qua API Core (UPDATE assignment, platform-identity.service.ts:1651) đổi start/end trực tiếp, không có audit HRM; rule UNIT của lịch làm việc tính theo phân công nên sửa lùi ngày làm đổi ca quá khứ (xem #3). (e) employee_directory chỉ phản ánh phân công hiệu lực HÔM NAY; NV đã nghỉ không còn chức danh/phòng trong view (ảnh hưởng nhãn trong danh sách/audit). |
| 2 | Bổ nhiệm/miễn nhiệm, thăng chức, kiêm nhiệm | personnel_decisions (DRAFT->APPROVED->APPLIED, applied_steps, version) + Core assignment (source_decision_id idempotent) + employee_reporting_lines (đóng dòng cũ effective_to, mở dòng mới; hrm-personnel-decisions.ts:834-925) + lương (employee_salary_profiles SUPERSEDED). | CÓ (quyết định giữ trạng thái, before/after; reporting lines có effective_from/to; lương có chuỗi hiệu lực). | Bảng personnel_decisions; index uq_hrm_reporting_open_direct. | Quyết định chỉ áp khi effective_date <= hôm nay (runApply); phạm vi duyệt đơn KHÔNG dùng employee_reporting_lines (xem Part 3/4). Gán assignment thẳng ở Core không có bản ghi quyết định HRM. |
| 3 | Đổi ca / đổi lịch | (a) Lịch từng ngày: employee_work_days; dòng bị thay thế chuyển status='CANCELLED' + cancel_reason (CANCELLED_BY_BATCH:<id>, HOLIDAY_CANCELLED), KHÔNG xóa cứng; unique index chỉ 1 dòng ACTIVE/ngày (hrm-work-schedule.ts:450,631). (b) Lịch định kỳ: work_schedule_rules; áp lịch mới CẮT (UPDATE effective_to) hoặc HỦY (status CANCELLED) lịch cũ tại chỗ (hrm-work-schedule-rules.ts:301-306; endRule 370; cancelRule 388); mẫu tuần chụp vào work_schedule_rule_days nên sửa mẫu không đổi lịch đã gán. (c) Đổi ca duyệt: hrm-shift-change.ts ghi employee_work_days + work_schedule_audit. | MỘT PHẦN: dòng ngày giữ (CANCELLED); lịch định kỳ bị cắt chỉ giữ giá trị cũ trong work_schedule_audit.before (effective_to cũ bị ghi đè trên dòng rule), không có bảng version. | work_schedule_audit (before/after, batch), work_schedule_batches.pattern_snapshot; employee_work_days.shift_snapshot "chỉ để đối soát, tra ca vẫn dùng shift_definitions hiện hành" (0035 comment). | (a) Lịch định kỳ được TRA KHI CẦN (hrm-work-schedule-resolve.ts), không materialize: kết quả quá khứ phụ thuộc rule + phân công Core + shift_definitions HIỆN TẠI; chỉ kỳ công đã KHÓA được bảo vệ (assertOpenRange chặn thay đổi chạm kỳ khóa và đặt calculated_at=NULL để buộc tính lại). (b) resolveRuleDays lấy phòng ban của NV tại ngày `from` của truy vấn và dùng cho cả khoảng [from,to] (hrm-work-schedule-resolve.ts start_unit): khi gọi theo khoảng (lưới/xuất lịch) mà NV chuyển phòng giữa khoảng thì các ngày sau chuyển hiển thị theo phòng cũ (tính công gọi từng ngày nên không bị). (c) Sửa giờ shift_definitions bị chặn khi ca đang dùng ở employee_work_days ACTIVE hoặc rule còn hiệu lực (hrm-shift.controller.ts updateShift:133-173) nhưng KHÔNG chặn khi ca chỉ còn ở dòng CANCELLED, rule đã hết hạn, hoặc kỳ công chưa khóa: tính lại kỳ chưa khóa/đã mở lại dùng giờ ca mới. check_in_before/check_out_after_minutes không nằm trong timingKeys nên sửa tự do. (d) shift_assignments/unit_shift_assignments không còn được đọc: dữ liệu phân ca cũ vô tác dụng; NV chưa được phân lại bằng lịch mới sẽ báo NO_SHIFT. |
| 4 | Hợp đồng thay đổi | employment_contracts: DRAFT -> ban hành (ACTIVE) lưu issued_snapshot (JSON toàn dòng), issued_at/by; phụ lục = hợp đồng con (parent_contract_id) tạo mới; chấm dứt = status TERMINATED + terminated_on/reason; chặn trùng hiệu lực hợp đồng gốc (hrm-contract.controller.ts:140-235, 296-345). | CÓ (bản ban hành bất biến qua snapshot; phụ lục là dòng mới). | issued_snapshot, audit_log CONTRACT_* | (a) status 'EXPIRED' không có đường ghi (không job hết hạn): hợp đồng hết hạn vẫn 'ACTIVE' đến khi chấm dứt tay. (b) Ban hành HĐ DEFINITE/INDEFINITE tự đặt employee_profiles.employment_status='OFFICIAL' kể cả khi đang ON_LEAVE (chỉ loại RESIGNED/TERMINATED) và official_date (dòng 214-228). Chấm dứt HĐ KHÔNG đổi employment_status. (c) base_salary trên hợp đồng không tác động lương (lương lấy employee_salary_profiles). (d) Ngày ký HĐ chính thức đầu tiên (firstOfficialContractSignDate, hrm-contracts.ts:~150) là cơ sở phép năm. |
| 5 | Đổi lương / bậc ngạch | employee_salary_profiles có hiệu lực theo ngày: dòng cũ -> 'SUPERSEDED', effective_to = hiệu lực - 1; dòng mới ACTIVE (hrm-salary.controller.ts:547-569; hrm-personnel-decisions.ts applySalaryStep:927-970). Tính lương chia theo từng ngày công theo hồ sơ lương hiệu lực ngày đó (hrm-payroll-calculation.ts:128-160). | CÓ (effective dating đầy đủ). | cột effective_from/effective_to/status/change_reason, approved_by. | (a) Cho phép hiệu lực lùi ngày; chỉ chặn nếu kỳ lương (payroll_periods.to_date >= ngày) LOCKED/PAID; khi có kỳ chưa chốt, mọi run chưa FINALIZED bị reset DRAFT. (b) Cập nhật dòng cũ ghi đè effective_to cũ. (c) createEmployeeSalaryProfile (hrm.salary.manage) KHÔNG ghi audit_log và không đặt approved_by - bỏ qua luồng quyết định/phê duyệt; quyết định nhân sự thì có audit PERSONNEL_DECISION_APPLIED. (d) salary_grade_steps.base_salary là giá trị tham chiếu; lương NV là bản sao nên đổi bậc không đổi lương NV. |
| 6 | Nghỉ việc | employee_profiles: employment_status RESIGNED/TERMINATED + inactive_from + inactive_reason (hrm-employee.controller.ts:929-985). Trigger DB 0021 -> outbox 'hrm.employee.offboarded' (effectiveDate = CURRENT_DATE) -> org-hrm-bridge.consumer.ts: kết thúc MỌI phân công active (status 'inactive', end_date = COALESCE(end_date, ngày sự kiện)) và VÔ HIỆU HÓA tài khoản (core users.is_active=false, status 'disabled'). | MỘT PHẦN: hồ sơ, bảng công, lương, phép đều giữ; phân công Core giữ nhưng status 'inactive' (khác 'ended' ở luồng quyết định). | Tác động: timesheets: dòng ngoài [join_date, inactive_from) bị XÓA nếu chưa chỉnh tay, đánh dấu ABNORMAL/ADJUSTED nếu đã chỉnh tay (hrm-timesheet-calculation.ts:49-71). Chấm công chặn từ inactive_from (hrm-attendance-ingest.ts:89-100). | (a) end_date phân công lấy NGÀY CHẠY SỰ KIỆN (payload effectiveDate = CURRENT_DATE trong trigger 0021-hrm-offboarding-event.sql) chứ không phải inactive_from khi nghỉ lùi ngày. (b) Nghỉ việc không tự: kết thúc hợp đồng, kết thúc hồ sơ lương, hủy đơn PENDING, hủy rule EMPLOYEE, chốt/ quyết toán phép, thu hồi tạm ứng (chưa thấy mã tự động). (c) Xóa dòng công "ngoài thời gian làm việc" là xóa thật (chỉ còn trong audit_log TIMESHEET_OUTSIDE_EMPLOYMENT_REMOVED.detail.before) và chỉ chạy khi kỳ công chưa khóa. (d) Không thấy đường tái tuyển dụng (RESIGNED -> ACTIVE) trong mã (chưa xác minh đầy đủ). (e) Tài khoản bị khóa ở Core, mở lại cần thao tác Core. |
| 7 | Kỳ công đã KHÓA | timesheet_periods.status='LOCKED' + locked_by/at; mọi thay đổi nguồn gọi assertOpenRange/assertOpenDate (409 'Kỳ công đã khóa'); calculateTimesheet từ chối khi LOCKED (hrm-timesheet-calculation.ts:25-27). Điều kiện khóa: kỳ đã kết thúc, có dòng, đã tính lại (calculated_at), không còn ABNORMAL, không còn đơn PENDING (hrm-timesheet.controller.ts:300-345). | CÓ ở mức dòng: mỗi dòng lưu scheduled/worked/paid/ot/late/early, workday_units, shift_id và calculation_snapshot (snapshot.shift.window, dayKind, policyVersionId, leaveIds/tripIds/otIds, weightedOtMinutes). KHÔNG có snapshot cấp kỳ. | Mở lại: REOPENED + reopen_reason + audit; mọi run lương của kỳ -> DRAFT; bị chặn nếu có run FINALIZED (hrm-timesheet.controller.ts:372-420). | Sau khóa đổi shift_definitions/work_calendar/policy KHÔNG đổi timesheets đã tính, nhưng khi mở lại và tính lại sẽ dùng định nghĩa HIỆN HÀNH (không dùng snapshot cũ). Dòng chỉnh tay giữ paid_minutes/workday_units nhưng chuyển ABNORMAL nếu snapshot khác. calculateTimesheet GHI NGƯỢC ot_requests.actual_minutes/billable_ot_minutes nên đơn OT phụ thuộc lần tính cuối. Payroll đọc timesheets sống; không có đối chiếu "tổng lúc tính == lúc chốt" ngoài việc chặn mở lại khi FINALIZED. |
| 8 | Kỳ lương đã CHỐT | payroll_runs FINALIZED + payroll_periods LOCKED; payroll_items.calculation_snapshot {formula, inputs đầy đủ (BASE_SALARY, PAID_MINUTES, ADVANCE_DUE...), components, dependentIds}, policy_version_id; payroll_employee_totals + beneficiary_snapshot (tên, mã, ngân hàng lúc tính); payslips.snapshot_json (period, total, salaryProfiles theo kỳ, items) khi phát hành (hrm-payroll.controller.ts generatePayslips:736-840). | CÓ (nhiều lớp chụp). | calculation_snapshot, beneficiary_snapshot, snapshot_json. | (a) Sau chốt: sửa policy_version đã dùng bị chặn (hrm-payroll-settings.controller.ts:418-428); thay đổi hồ sơ lương chạm kỳ LOCKED/PAID bị chặn; mở lại kỳ công bị chặn; điều chỉnh phải ghi vào kỳ sau. (b) payroll_items chỉ chụp TỔNG đầu vào, không chụp từng dòng công. (c) Chốt cập nhật ngay tạm ứng (remaining_balance, REPAID) và leave_settlements (DEDUCTED); không có endpoint hủy chốt (cancelRun chỉ cho run chưa chốt, hrm-payroll.controller.ts:364). (d) calculation_version bị ghi cố định 'HRM_FORMULA_V1' (hrm-payroll-calculation.ts cuối hàm) - không phản ánh phiên bản công thức thực. (e) payroll_periods.PAID chỉ khi mọi total PAID, không có đường mở lại. |
| 9 | Điều chỉnh quỹ phép | Sổ cái leave_transactions (append-only; operation_key unique để idempotent); leave_balances cập nhật song song; ADJUSTMENT / REVERSAL (hrm-leave.controller.ts:709, 788); hrm-leave-reconcile.ts đối soát. | CÓ (không UPDATE/DELETE ledger trong mã; ngoại lệ: gộp loại nghỉ UPDATE leave_type_id, hrm-leave-merge.ts:130). | transaction_type mở rộng 0033; balance_after lưu mỗi dòng. | leave_balances là bản tổng hợp có thể lệch ledger; leave_request_days chụp ngày/paid_minutes tại lúc duyệt nên không đổi khi lịch đổi sau (dòng công vẫn tính LEAVE kể cả khi ngày đó sau này được đặt OFF/HOLIDAY). |
| 10 | Chính sách (policy_versions) | Phiên bản có effective_from/to, DRAFT/ACTIVE/SUPERSEDED; resolvePolicy chọn theo ngày + phạm vi employeeIds (hrm-time.ts:123-165). | CÓ cho phiên bản đã dùng (bị chặn sửa), MỘT PHẦN cho bản chưa dùng (UPDATE config_json tại chỗ, hrm-payroll-settings.controller.ts:487). | | Chính sách ATTENDANCE chỉ được tham chiếu trong timesheets.calculation_snapshot.policyVersionId (không FK, không guard "đã dùng") - chưa xác minh time-settings có chặn sửa phiên bản đã dùng. |

## Tổng kết Part 2

- Tốt: effective dating cho lương, phụ lục hợp đồng, reporting lines, policy versions; snapshot ở payroll_items/payslips/payroll_employee_totals/hợp đồng ban hành/personnel_decisions; ledger phép bất biến; khóa kỳ công chặn thay đổi lùi.
- Yếu: (1) lịch định kỳ ghi đè effective_to và tra động theo dữ liệu hiện hành (phòng ban, giờ ca); (2) không snapshot cấp kỳ công; dòng công không lưu đơn vị/chức danh; (3) xóa dòng công khi NV nghỉ chỉ còn trong audit_log; (4) end_date phân công khi nghỉ lấy ngày hệ thống; (5) hợp đồng không có job hết hạn; (6) tạo hồ sơ lương trực tiếp không có audit_log; (7) tính lại kỳ mở lại không dùng snapshot cũ.

> Trạng thái: Part 1 và 2 hoàn tất. Part 3 bên dưới; Part 4 sẽ bổ sung ngay sau.

---------------------------------------------------------------------

# PART 3 - LUỒNG DỮ LIỆU ĐẦU - CUỐI

## 3.1 Sơ đồ (văn bản)

```
[CORE] users / employees / organization_node_assignments (chức danh, đơn vị, start/end)
   |  HRM ghi THẲNG vào core_schema.employees khi tạo NV (hrm-employee.controller.ts createEmployee:402) và
   |  ĐỌC trực tiếp core_schema (employees, users, organization_nodes/assignments) trong cùng DB tenant
   v
[HRM] employee_profiles (join_date, employment_status, inactive_from)  <--- employee_directory (view, chỉ phân công HÔM NAY)
   |   + employment_contracts (ban hành -> auto OFFICIAL; ngày ký -> mốc phép năm)   [KHÔNG nối vào lịch/lương]
   |   + employee_salary_profiles (hiệu lực theo ngày)   [nhập tay hoặc từ personnel_decisions; KHÔNG sinh từ hợp đồng]
   v
[LỊCH] shift_definitions  <- work_schedule_templates -> work_schedule_rules (định kỳ: NV > đơn vị gần nhất > công ty; tra động)
   |                                          employee_work_days (từng ngày: ngoại lệ / lễ / gán theo khoảng) [ưu tiên cao hơn rule]
   |     tra ca: hrm-shift-resolution.resolveDay -> hrm-time.dayContextForDate/shiftForDate
   |     (shift_assignments / unit_shift_assignments KHÔNG còn tham gia)
   v
[CHẤM CÔNG] POST attendance/check-in|out (hrm-attendance.controller) -> hrm-attendance-ingest -> hrm-time.timeContext (chọn ca + work_date)
   |     -> INSERT attendance_events (thô, idempotent theo external_event_id)
   |     -> hrm-time.recalculateAttendance -> calculateAttendance(events, ca) -> UPSERT attendances (tổng hợp ngày, calculation_snapshot)
   |     Giải trình: attendance_corrections -> hrm-request-transition: VOID events (voided_by_correction_id) + INSERT events mới (evidence.correctionId) -> recalculateAttendance
   v
[ĐƠN] leave_requests (+leave_request_days chụp ngày/paid_minutes lúc tạo/duyệt), ot_requests, business_trip_requests, shift_change_requests(-> employee_work_days),
   |     duyệt: DIRECT (hrm-approval-policy) hoặc PROCEDURE (procedure_links -> hrm-procedure-sync callback)
   v
[BẢNG CÔNG] POST timesheet-periods/:id/calculate -> hrm-timesheet-calculation.calculateTimesheet
   |     với mỗi NV (join_date..inactive_from) x ngày: resolvePolicy(ATTENDANCE) + dayContextForDate + work_calendar
   |       + ĐỌC LẠI attendance_events -> calculateAttendance (lần 2) ; leave_request_days(APPROVED) ; business_trip_requests(APPROVED) ; ot_requests(APPROVED)
   |     UPSERT timesheets (+calculation_snapshot) ; UPDATE ot_requests.actual/billable_minutes ; timesheet_periods.calculated_at
   |     khóa: POST .../lock (điều kiện kỳ đã hết, calculated_at, không ABNORMAL, không đơn PENDING)  -> status LOCKED
   v
[LƯƠNG] payroll_periods (1 kỳ lương = 1 kỳ công LOCKED, trùng from/to; hrm-payroll.controller createPeriod:196-240)
   |     payroll_runs (nhiều run/kỳ) -> POST calculate -> hrm-payroll-calculation.calculatePayroll
   |       đọc: timesheets (sống) + employee_salary_profiles (theo ngày) + policy PAYROLL (tại from & to) + payroll_employee_inputs
   |            + salary_advance_deductions(SCHEDULED) + leave_settlements(SCHEDULED) + employee_dependents + employee_directory(beneficiary)
   |       ghi: payroll_items (+calculation_snapshot), payroll_employee_totals (+beneficiary_snapshot); run -> CALCULATED
   |     điều chỉnh tay: payroll_items source_type='MANUAL_ADJUSTMENT' (hrm.payroll.adjust) -> run về DRAFT
   v
[CHỐT] POST finalize (hrm.payroll.finalize; SoD calc != finalize nếu bật) -> cập nhật tạm ứng (remaining/REPAID), leave_settlements DEDUCTED,
   |     payroll_periods LOCKED, payroll_runs FINALIZED   (KHÔNG có bước IN_REVIEW/APPROVED thực tế)
   v
[PHIẾU LƯƠNG] POST payslips/generate (hrm.payroll.publish; SoD finalize != publish) -> payslips (PUBLISHED, snapshot_json) + outbox 'hrm-payslip' -> notification
   v
[CHI TRẢ] POST payroll-totals/:id/record-payment (hrm.payroll.pay) -> payroll_employee_totals.payment_status PAID (+payment_reference, paid_at);
          khi mọi NV PAID -> payroll_periods.status PAID.   Xuất: GET payroll-runs/:id/export (hrm.payroll.export). Không có kết nối ngân hàng/kế toán.
```

## 3.2 Từng chặng: hàm tiêu thụ đầu ra chặng trước, COPY hay THAM CHIẾU

| Chặng | Hàm / file tiêu thụ | Sao chép (copy) | Tham chiếu (reference) | Nhận xét |
|---|---|---|---|---|
| NV+HĐ -> Lịch | Không có liên kết trực tiếp. Lịch khóa theo employee_id; ranh giới NV là join_date/inactive_from (hrm-timesheet-calculation.ts:41-46) | - | employee_id | Hợp đồng KHÔNG giới hạn lịch/công/lương; NV mới tạo không có lịch, không có hồ sơ lương -> timesheet NO_SHIFT/ABNORMAL, payroll lỗi 'Hồ sơ lương bị thiếu/trùng' (hrm-payroll-calculation.ts:147). Không có "onboarding checklist" tự động. |
| Lịch -> Chấm công | hrm-time.timeContext (chọn work_date theo cửa sổ ca hôm nay/hôm qua) -> shiftForDate -> resolveDay | attendances.calculation_snapshot.shift (cửa sổ ca) | shift_definitions HIỆN HÀNH | Rule định kỳ không materialize: mỗi lần chấm công/tính công gọi resolveDay (nhiều truy vấn/lần). |
| Chấm công -> Attendance tổng hợp | hrm-time.recalculateAttendance | attendances: check_in/out, worked/late/early, scheduled | attendance_events | Hai kết quả (attendances vs timesheets) sinh độc lập. |
| Events/Đơn -> Bảng công | hrm-timesheet-calculation.calculateTimesheet | timesheets.* số phút + calculation_snapshot (shift, anomalies, leaveIds, tripIds, otIds, weightedOtMinutes, policyVersionId) | attendance_id; leave_request_id (đơn đầu); business_trip_request_id; (ot_request_id không ghi) | Đọc attendance_events trực tiếp (không đọc attendances). Nghỉ phép: leave_request_days.paid_minutes (copy lúc duyệt) + nhánh legacy cho đơn không có days ('LEGACY_LEAVE_REQUIRES_REVIEW'). OT: đọc ot_requests APPROVED, tính billable = min(thực tế, approved_minutes), hệ số ot_rate_multiplier lưu trên đơn. Công tác: cả ngày = scheduled (paid = scheduled) nếu có đơn APPROVED, bất kể chấm công. |
| Bảng công -> Khóa | hrm-timesheet.controller.lockPeriod | - | timesheet_periods.status | Chỉ cờ trạng thái; chặn thay đổi nguồn qua assertOpenRange. |
| Bảng công -> Lương | hrm-payroll-calculation.calculatePayroll | payroll_items.calculation_snapshot.inputs (SCHEDULED_/PAID_/OT_/LATE_MINUTES, WORKDAY_UNITS, BASE_SALARY(gia quyền theo phút lịch), PRORATED_BASE_PAY...), payroll_employee_totals, beneficiary_snapshot | timesheet_period_id (payroll_periods), policy_version_id | Chỉ tính cho NV có dòng timesheets trong kỳ. Lương cơ bản tính TỪNG NGÀY theo hồ sơ lương hiệu lực ngày đó; chính sách lương lấy tại from và to rồi dùng (endPolicy || policy) cho cả kỳ. |
| Lương -> Chốt | hrm-payroll.controller.finalizeRun | cập nhật số dư tạm ứng và quyết toán phép | payroll_runs.status | Kiểm tra timesheet vẫn LOCKED; kiểm tra 1 run FINALIZED/kỳ (không có unique index ở DB: chỉ kiểm tra trong transaction). |
| Chốt -> Phiếu lương | generatePayslips | payslips.snapshot_json (period, total, items, salaryProfiles) | payroll_run_id | Idempotent theo (run, employee). |
| Chốt -> Chi trả | record-payment | payment_reference, paid_at | payroll_employee_totals | Ghi nhận thủ công, không có đối chiếu số tiền với ngân hàng. |

## 3.3 Phát hiện (thiếu liên kết, tính trùng, lưu trùng, rủi ro thay đổi ngầm)

Loại: L = thiếu liên kết, C = tính toán trùng, S = lưu trữ trùng, R = thay đổi thượng nguồn âm thầm đổi hạ nguồn.

| # | Loại | Mô tả | Bằng chứng | Mức |
|---|---|---|---|---|
| F1 | C+S | calculateAttendance chạy 2 lần cho cùng dữ liệu: recalculateAttendance (-> attendances) và calculateTimesheet (-> timesheets); timesheet không đọc attendances | hrm-time.ts recalculateAttendance; hrm-timesheet-calculation.ts (SELECT attendance_events) | Trung bình |
| F2 | C | "Loại ngày" (WORK/OFF/HOLIDAY) được suy ra ở nhiều nơi với quy tắc khác nhau: timesheet và dayKindOf dùng applyScheduleDayKind(effectiveDayKind(work_calendar, weeklyOffDays), employee_work_days.day_type); hrm-leave-operations/hrm-leave-day-preview dùng cùng tổ hợp (đã cập nhật trong working tree); hrm-overtime chỉ dùng work_calendar (không xét weeklyOffDays hay lịch từng ngày) để chọn WEEKDAY/WEEKEND/HOLIDAY và hệ số; hrm-leave-settlement.leaveDailyRate dùng work_calendar và mặc định CHỦ NHẬT nghỉ; scheduleDayTypeOf (dùng bởi dayKindOf, hrm-leave-operations, hrm-leave-day-preview) chỉ đọc employee_work_days, KHÔNG đọc lịch định kỳ (work_schedule_rules) trong khi timesheet dùng resolveDay (có cả rule) -> với NV chỉ có lịch định kỳ có ngày OFF (vd. T7/CN nghỉ theo rule, không khai weeklyOffDays/work_calendar), đơn nghỉ trải qua ngày đó không nhận ra OFF, gọi shiftForDate trả null và ném 'Chưa phân ca ngày ...; không thể xác định định mức phép' (hrm-leave-operations.ts:92-104). Cần kiểm thử thực tế để xác nhận (suy luận từ mã) | hrm-overtime.ts:56-60,100-108; hrm-leave-settlement.ts:175-184; hrm-time.ts:44-75; hrm-leave-operations.ts:72-104 | Cao: đơn OT ngày nghỉ theo lịch riêng bị gán hệ số ngày thường; đơn nghỉ qua ngày OFF-theo-rule có thể bị từ chối |
| F3 | C | Hai công thức "đơn giá ngày" cho lương: payroll dùng PRORATED_BASE_PAY = base x paid_minutes / standardMinutes; thu hồi phép dùng base / số ngày làm việc trong tháng (work_calendar, CN nghỉ) | hrm-payroll-calculation.ts; hrm-leave-settlement.ts leaveDailyRate | Trung bình |
| F4 | S | Lương lưu ở 4 nơi (contract.base_salary, employee_salary_profiles, personnel_decisions.to_base_salary, salary_grade_steps.base_salary); payroll chỉ đọc employee_salary_profiles; hợp đồng/quyết định ban hành không tự đồng bộ nếu nhập tay | xem 1.3 | Cao |
| F5 | L | Hợp đồng không ràng buộc công/lương: NV không còn HĐ ACTIVE vẫn có công và lương; contract expiry không tự động | hrm-timesheet-calculation (chỉ dùng join_date/inactive_from); status EXPIRED không ghi | Cao |
| F6 | L | Không có bước tạo hồ sơ lương/lịch khi tạo NV (createEmployee chỉ tạo core.employees + profile) -> lỗi ở hạ nguồn mới phát hiện | hrm-employee.controller.ts:378-424 | Trung bình |
| F7 | R | Lịch định kỳ tra động từ phân công Core + shift_definitions hiện hành; sửa phân công (PATCH Core) hoặc cắt/hủy rule làm đổi ca quá khứ ở kỳ chưa khóa; assertOpenRange chỉ bảo vệ kỳ KHÓA | hrm-work-schedule-resolve.ts; hrm-work-schedule-rules.ts:301-388 | Trung bình |
| F8 | R | Tính lại bảng công (kỳ mở lại) dùng ca/chính sách hiện hành; không so với snapshot đã khóa trước đó, dòng chỉnh tay chỉ bị đánh ABNORMAL nếu snapshot khác | hrm-timesheet-calculation.ts (upsert) | Trung bình |
| F9 | R | Payroll đọc timesheets sống: giữa lúc tính lương và chốt, bảng công có thể mở lại (đã chặn khi FINALIZED, và finalize kiểm tra lại LOCKED; run reset DRAFT khi mở lại) -> nhờ vậy không âm thầm nhưng thay đổi bảng công đã khóa sau khi tính lương luôn bắt tính lại | hrm-timesheet.controller.ts:372-400; finalize:480-486 | Thấp |
| F10 | R | Chính sách lương lấy tại from và to; nếu chính sách đổi giữa kỳ, công thức của NGÀY CUỐI kỳ áp cho cả kỳ (không chia đoạn như lương cơ bản) | hrm-payroll-calculation.ts: activePolicy = endPolicy || policy | Trung bình |
| F11 | R | Nghỉ phép đã duyệt (leave_request_days) chụp số phút/ngày; thay đổi lịch/ngày lễ sau đó không cập nhật đơn đã duyệt; timesheet ưu tiên đơn nghỉ (status LEAVE) | hrm-leave-operations.ts:72-120 | Trung bình |
| F12 | R | Nghỉ việc: end_date phân công = ngày chạy sự kiện (không phải inactive_from) và dòng công ngoài thời gian làm việc bị xóa khi tính lại; payroll chỉ tính NV có timesheets | org-hrm-bridge.consumer.ts; hrm-timesheet-calculation.ts:49-71 | Trung bình |
| F13 | S | Trạng thái tiến độ duyệt lưu hai nơi (7 bảng đơn + procedure_links); legacy workflow_instance_id không còn ghi | 0002, 0029 | Thấp |
| F14 | L | Phạm vi duyệt đơn (assertCanDecide) dùng Core (chức danh báo cáo/trưởng đơn vị qua HrmOrgScopePort) trong khi quyết định nhân sự/CHANGE_MANAGER chỉ ghi employee_reporting_lines: hai nguồn quản lý trực tiếp không đồng bộ | hrm-approval-policy.ts:150-170; hrm-personnel-decisions.ts | Cao |
| F15 | L | payroll_periods.timesheet_period_id không có unique index: nhiều kỳ lương có thể trỏ cùng kỳ công (chưa xác minh index khác); from/to lưu trùng ở hai bảng (đối chiếu bằng mã khi tạo kỳ lương) | 0001 payroll_periods; hrm-payroll.controller.ts:206-225 | Thấp |
| F16 | S | Hai kho nhật ký (audit_log, work_schedule_audit) + legacy notifications đóng băng; sự kiện outbox kép (trigger DB + ghi tay payslip) | 1.3 | Thấp |
| F17 | C | Tính công N+1: calculateTimesheet chạy ~7-8 truy vấn cho MỖI NV x ngày (resolvePolicy, dayContext (nhiều truy vấn: tra lịch + rule đệ quy), events, attendances, leaves, legacyLeaves, trips, ots + UPDATE ot) trong một transaction giữ khóa kỳ | hrm-timesheet-calculation.ts:73-200 | Hiệu năng (không phải đúng-sai) |
| F18 | L | Đơn công tác không kết nối hạ nguồn tiền (per_diem_policy_id không có logic tiêu thụ; phụ cấp công tác không vào lương) | grep per_diem_policy_id: chỉ request controller | Thấp |
| F19 | S | payroll_runs.calculation_version luôn ghi 'HRM_FORMULA_V1' trong khi cột mặc định 'VN_LABOR_LAW_2026' | hrm-payroll-calculation.ts cuối; 0001 | Thấp |
| F20 | L | Chuỗi duyệt lương thực tế: CALCULATED -> FINALIZED (APPROVED/IN_REVIEW/REJECTED có CHECK nhưng không có đường chuyển); phân tách nhiệm vụ nằm ở payroll_sod_settings | hrm-payroll.controller.ts:455-520; hrm-payroll-sod.ts | Thông tin |

## 3.4 Điểm đáng chú ý khác

- Kiến trúc: module HRM đọc/ghi thẳng core_schema trong cùng database tenant (employees, users, organization_*) và integration_schema/outbox; có spec ranh giới (hrm-architecture-boundary.spec.ts) nhưng tiền lệ truy cập chéo schema tồn tại ở nhiều file (hrm-work-schedule-resolve.ts, hrm-context.service.ts, org-hrm-bridge.consumer.ts).
- hrm-context.service.resolveEmployee TỰ TẠO employee_profiles (join_date = hôm nay, OFFICIAL, quốc tịch 'Việt Nam') khi tài khoản có core employee nhưng chưa có hồ sơ HRM (dòng 43-52): mọi truy cập self-service tạo hồ sơ nhân sự ngoài luồng và join_date sai có thể chặn tính công những ngày trước đó.

> Trạng thái: Part 1, 2, 3 hoàn tất. Part 4 bên dưới; phụ lục A liệt kê toàn bộ 267 route HRM kèm quyền.

---------------------------------------------------------------------

# PART 4 - MÔ HÌNH PHÂN QUYỀN

## 4.1 Danh sách hành động (HRM_PERMISSION_ACTIONS)

Nguồn: packages/contracts/identity/src/lib/tenant-authorization.ts (65 hành động `hrm.*`; TENANT_PERMISSION_ACTIONS gộp thêm inventory/maintenance/procedure/core/workspace).

| Nhóm | Hành động |
|---|---|
| Cá nhân (5) | hrm.self.read, hrm.self.profile.write, hrm.self.attendance, hrm.self.request, hrm.self.payslip |
| Nhân sự (6) | hrm.employee.read, hrm.employee.manage, hrm.employee.link-account, hrm.appointment.read, hrm.appointment.manage, hrm.appointment.approve |
| Báo cáo (1) | hrm.dashboard.read |
| Ca và công (14) | hrm.shift.read, hrm.shift.manage, hrm.schedule.read, hrm.schedule.manage, hrm.schedule.bulk, hrm.schedule.calendar, hrm.shift.approve, hrm.shift.approve.all, hrm.attendance.read, hrm.attendance.import, hrm.attendance.approve, hrm.attendance.approve.all, hrm.time.configure, hrm.device.manage |
| Phép và đơn (12) | hrm.leave.read, hrm.leave.manage, hrm.request.read, hrm.request.manage, hrm.leave.approve, hrm.leave.approve.all, hrm.ot.approve, hrm.ot.approve.all, hrm.trip.approve, hrm.trip.approve.all, hrm.profile.approve, hrm.profile.approve.all |
| Tạm ứng (4) | hrm.advance.read, hrm.advance.approve, hrm.advance.approve.all, hrm.advance.disburse |
| Bảng công (6) | hrm.timesheet.read, calculate, adjust, lock, reopen, export |
| Tiền lương (12) | hrm.salary.read, hrm.salary.manage, hrm.dependent.read, hrm.dependent.manage, hrm.payroll.read, configure, calculate, adjust, finalize, publish, pay, export |
| Vận hành (3) | hrm.automation.manage, hrm.integration.manage, hrm.audit.read |
| Truy cập / quản trị (2) | hrm.read ("Vào HRM"), hrm.manage ("Toàn quyền nghiệp vụ HRM trong tenant") |

(Tổng nhóm = 65, khớp HRM_PERMISSION_ACTIONS.length chạy thực tế trên nguồn.) Bảng đối chiếu tài liệu: docs/HRM-RBAC-actions.md đang có thay đổi chưa commit (git status M).

## 4.2 Mở rộng phụ thuộc (expandTenantActions) và quan hệ tenant-admin / hrm.manage

- tenant-admin: role hệ thống (key 'tenant-admin', role_modules '*'); resolve() trả permissions = ['tenant.manage', ...tất cả actionKeys] (tenant-authorization.ts packages/platform/identity:149-151). Không phụ thuộc bảng role_permissions.
- hrm.manage: expandTenantActions thêm TOÀN BỘ 65 hành động `hrm.*`. Đồng thời HrmContextService.has() coi `tenant.manage` hoặc `hrm.manage` thỏa MỌI hành động (hrm-context.service.ts:140-146), hrm-approval-policy.hasApproveAll và hrm-salary-visibility cũng vậy: hrm.manage tương đương quản trị HRM (bao gồm duyệt toàn tenant, xem lương).
- Quy tắc tự thêm (một lượt, không đệ quy): mọi hrm.* -> hrm.read; hrm.self.* -> hrm.self.read; manage -> read cùng domain (employee, appointment, shift, schedule, leave, salary, dependent); approve/approve.all -> read liên quan (request.read, leave.read, attendance.read, shift.read, advance.read); advance.disburse -> advance.read; schedule.bulk -> schedule.manage + read; hrm.timesheet.* -> timesheet.read; hrm.payroll.calculate -> timesheet.read; hrm.payroll.* (trừ configure) -> payroll.read.
- Hệ quả đáng chú ý: duyệt (approve) tự cấp hrm.request.read (xem đơn TOÀN TENANT) và (leave.approve) hrm.leave.read (xem quỹ/sổ phép TOÀN TENANT); (attendance.approve) hrm.attendance.read; hrm.payroll.configure KHÔNG kèm payroll.read.
- Cổng module: getContext -> PlatformIdentityService.decide: kiểm tra phiên tenant, membership, entitlement module 'hrm', role_modules chứa 'hrm' hoặc '*', và permission nằm trong modulePermissions['hrm'] (mọi hrm.* + 'module.access') và có trong access.permissions (hoặc là module.access) - packages/platform/identity tenant-authorization.ts allowsModule:190-210; platform-identity.service.ts:485-540. Cache quyền 30 giây theo revision (authorization_state.revision tăng bởi trigger khi đổi RBAC).
- Role mặc định: 'tenant-user' (Nhân viên mặc định, đổi tên từ legacy-tenant-user ở core 0007) không có hành động HRM nào được seed trong migration (chưa xác minh gán lúc cấp phát tenant). Role mẫu HRM do TenantAuthorizationService.seedHrmRoleTemplates tạo (idempotent, chỉ tenant admin; chưa xác minh được gọi tự động khi provisioning hay chỉ thủ công/ scripts/seed-hrm-roles.mjs).

## 4.3 Role template (hrm-role-templates.ts) - 9 mẫu

| Template | Hành động gán trực tiếp | Hành động mở rộng thêm |
|---|---|---|
| employee (HRM - Nhân viên) | self.read, self.profile.write, self.attendance, self.request, self.payslip | hrm.read |
| department-head | self.read, self.request, request.read, attendance.read, leave.approve, ot.approve, trip.approve, shift.approve | hrm.read, leave.read, shift.read |
| hr-profile | employee.read/manage/link-account, appointment.read/manage, profile.approve, profile.approve.all, dependent.read/manage | hrm.read, request.read |
| hr-head | employee.read, appointment.read, appointment.approve, salary.read | hrm.read |
| timekeeper | shift.read/manage, schedule.read/manage/bulk/calendar, time.configure, device.manage, attendance.read/import/approve/approve.all, leave.read/manage, timesheet.read/calculate/adjust/export | hrm.read, request.read |
| comp-ben | payroll.configure, salary.read/manage, employee.read, dependent.read, payroll.read/calculate/adjust | hrm.read, timesheet.read |
| payroll-approver | timesheet.read, timesheet.lock, payroll.read/finalize/publish | hrm.read |
| payroll-accountant | payroll.read/export/pay, advance.read, advance.disburse | hrm.read |
| hrm-admin | hrm.manage, hrm.audit.read | toàn bộ 65 |

Hành động KHÔNG được template phi-admin nào cấp (chỉ hrm.manage/tenant-admin có): hrm.dashboard.read, hrm.shift.approve.all, hrm.request.manage, hrm.leave.approve.all, hrm.ot.approve.all, hrm.trip.approve.all, hrm.advance.approve, hrm.advance.approve.all, hrm.timesheet.reopen, hrm.automation.manage, hrm.integration.manage, hrm.audit.read. Nghĩa là: duyệt TẠM ỨNG (DIRECT) và mở lại bảng công, xem nhật ký nghiệp vụ, cấu hình tích hợp/tự động, đơn thay mặt - chỉ admin; không có vai "trưởng bộ phận duyệt tạm ứng" (advance.approve không template nào).

Chính sách phạm vi duyệt (approval scope; hrm-approval-policy.ts):
1. Không tự duyệt đơn của mình (trừ khi approval_policy_settings.allow_self_approval); chủ đơn được rút (cancel).
2. Chỉ duyệt đơn của cấp dưới theo chuỗi "Báo cáo cho" của chức danh / cây đơn vị mình là trưởng (HrmOrgScopePort từ Platform).
3. hrm.<x>.approve.all / hrm.manage / tenant.manage duyệt toàn tenant (vẫn bị quy tắc 1).
4. Đơn đã có procedure_links: 409 PROCEDURE_IN_PROGRESS (và trigger hrm_workflow_guard).
Phạm vi này CHỈ áp cho hành động quyết định (assertCanDecide) và danh sách khi truyền forApproval=1; không áp cho đọc.

## 4.4 Ba lớp thực thi

### (a) Hiển thị menu (packages/features/hrm)

- Nguồn: hrmNavigationSections (hrm-navigation.ts, 20 mục) + hrmPagePermissions (hrm-permissions.tsx) -> filterHrmNavigation ẩn mục khi không có BẤT KỲ quyền nào trong danh sách của href (any). Cùng một bản đồ được dùng cho menu và cho kiểm tra trang (hrm-shell.tsx dòng 244-255 và 535) nên menu và trang nhất quán theo thiết kế.
- Quyền lấy từ GET /api/hrm/v1/capabilities (HrmCapabilitiesController, @HrmPublicRoute): actions = HRM_PERMISSION_ACTIONS lọc bằng ctx.has() (đã gồm wildcard hrm.manage/tenant.manage); làm mới mỗi 30 giây, khi focus và khi sự kiện invalidated.
- href không có trong bản đồ => luôn hiển thị (không có mục nào như vậy hiện tại: cả 20 href đều có).

### (b) Truy cập route/trang

- apps/hrm-web: 20 file page.tsx chỉ render component feature (ví dụ work-schedules/page.tsx -> WorkScheduleScreen); layout.tsx bọc HrmShell. KHÔNG có middleware.ts/proxy.ts trong apps/hrm-web (glob không thấy) và next.config.js chỉ có basePath '/modules/hrm' + rewrites '/api/hrm' và '/api/auth'. Không có kiểm tra phiên hay quyền phía máy chủ (SSR) cho trang HRM.
- apps/web/src/proxy.ts: chỉ chắn các route /platform, /dashboard, /organization, /applications, /users, /authorization, /account bằng sự hiện diện cookie ep_access (không verify JWT); KHÔNG bao gồm /modules/hrm (do nginx chuyển tới hrm-web: infrastructure/nginx/nginx.conf:164-168).
- Chặn trang ở client: HrmShellContent chỉ render children khi `permissions.any(pagePermissions)`; nếu đường dẫn không có trong hrmPagePermissions (ví dụ trang con mới) thì KHÔNG bị chặn. Trước khi quyền tải xong hiển thị "Đang tải quyền HRM"; nếu lỗi tải quyền hiển thị lỗi (không redirect đăng nhập).
- Kết luận: truy cập bằng URL trực tiếp vẫn tải được "vỏ" trang và JS của màn hình (bundle không phân quyền); dữ liệu chỉ bảo vệ bởi API. Việc ẩn là UX, không phải biện pháp bảo mật. Với người dùng chưa đăng nhập: các lệnh gọi API trả 401; chưa thấy redirect về đăng nhập trong shell (chưa xác minh toàn bộ hrm-api.ts xử lý 401).

### (c) Thực thi API

- Cổng chung: HrmContextService.getContext(request, permission): (1) CSRF double-submit cho phương thức ghi khi dùng cookie (bỏ qua nếu có Bearer), (2) JWT RS256 (JWKS) -> principal kind 'tenant-user', (3) identity.decide(permission) kiểm phiên/membership/entitlement/role_modules/permission, (4) trả pool DB tenant. Mọi handler HRM tự gọi getContext/scoped/getRequestContext (267 route; không có route nào bỏ qua ngoại trừ capabilities có chủ đích).
- Các biến thể: scoped(req, perm, employeeId) = có quyền toàn tenant thì xem mọi NV, ngược lại cần hrm.self.read và chỉ dữ liệu của chính mình; getRequestContext = chủ đơn dùng quyền self, người khác cần quyền quản lý (hrm.request.manage mặc định hoặc quyền chỉ định); assertCanDecide cho duyệt trong phạm vi.
- HrmAccessGuard (APP_GUARD, module-hrm.module.ts:68): chế độ lấy từ HRM_ACCESS_GUARD_MODE; MẶC ĐỊNH 'audit' (chỉ log WARN mỗi route một lần khi thiếu @RequirePermission, KHÔNG chặn). Biến này không được đặt ở bất kỳ file cấu hình nào trong repo (grep toàn repo chỉ thấy guard + spec) -> môi trường nào chưa đặt thì đang ở 'audit'. Ở 'enforce': route chưa khai báo bị 403 HRM_PERMISSION_NOT_DECLARED.
- Mức phủ @RequirePermission: 41/267 route (còn 226 chưa khai báo): hrm-work-schedule.controller (21), hrm-personnel-decision.controller (11), hrm-payroll.controller (3: calculate, finalize, payslips/generate), hrm-timesheet.controller (2: lock, reopen), hrm-payroll-sod (2), approval-scope (1), operations GET '' (1)... Nếu bật 'enforce' ngay, 226 route (toàn bộ nhân sự/phép/đơn/lương/cấu hình công...) sẽ bị chặn -> chưa thể bật. Khai báo hiện có đều khớp quyền handler dùng (đã đối chiếu từng route; lệch duy nhất: route schedule thường khai báo quyền tối thiểu `hrm.schedule.read/manage` và handler kiểm tra sâu hơn).
- Quyền kiểm tra trong handler: phần lớn đúng nghiệp vụ (ví dụ hrm.payroll.finalize cho chốt, hrm.timesheet.lock cho khóa, hrm.employee.manage cho ghi hồ sơ, hrm.salary.manage cho lương).

## 4.5 Ma trận: role template x mục menu (suy ra từ mã bằng cách chạy expandTenantActions + hrmPagePermissions trên nguồn)

Ký hiệu: X = thấy mục. Cột = href. (employee=Nhân viên; dept=Trưởng bộ phận; hrp=Nhân sự hồ sơ; hrh=Trưởng phòng NS; tk=Chấm công viên; cb=C&B; pa=Người chốt lương; pac=Kế toán chi trả; adm=Quản trị HRM / tenant-admin)

| Mục menu (href) | Quyền cần (any) | employee | dept | hrp | hrh | tk | cb | pa | pac | adm |
|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard (/) | self.read, dashboard.read | X | X | | | | | | | X |
| Lịch và thông báo (/calendar) | self.read | X | X | | | | | | | X |
| Chấm công (/attendance) | self.read | X | X | | | | | | | X |
| Đơn từ và yêu cầu (/requests) | self.read | X | X | | | | | | | X |
| Hồ sơ của tôi (/profile) | self.read | X | X | | | | | | | X |
| Phiếu lương (/payslips) | self.payslip | X | | | | | | | | X |
| Nhân sự và chức danh (/employees) | employee.read | | | X | X | | X | | | X |
| Người phụ thuộc (/dependents) | dependent.read | | | X | | | X | | | X |
| Quyết định nhân sự (/personnel-decisions) | appointment.read | | | X | X | | | | | X |
| Danh mục ca (/shifts) | shift.read, shift.manage | | X | | | X | | | | X |
| Phân ca làm việc (/work-schedules) | schedule.read | | | | | X | | | | X |
| Xử lý đơn từ (/approvals) | request.read, advance.read | | X | X | | X | | | X | X |
| Bảng công tổng hợp (/timesheets) | timesheet.read | | | | | X | X | X | | X |
| Tiền lương và chi trả (/payroll) | payroll.read | | | | | | X | X | X | X |
| Ứng và thu hồi lương (/payroll/advances) | advance.read | | | | | | | | X | X |
| Quỹ phép (/leave-settings) | leave.read | | X | | | X | | | | X |
| Cấu hình công và thiết bị (/policies) | time.configure, device.manage | | | | | X | | | | X |
| Cấu hình lương (/payroll/settings) | payroll.configure | | | | | | X | | | X |
| Vận hành và tích hợp (/operations) | automation.manage, integration.manage, audit.read | | | | | | | | | X |
| Danh mục quyền HRM (/permissions) | hrm.read | X | X | X | X | X | X | X | X | X |

Ghi chú: vai trò mẫu là gói quyền độc lập; thực tế một người thường được gán nhiều vai (ví dụ nhân viên + trưởng bộ phận). Tenant-user mặc định không có menu HRM nào (không có action; chưa xác minh gán lúc tạo tài khoản). Người chỉ có vai nghiệp vụ không kèm 'employee' (hrp, hrh, tk, cb, pa, pac) KHÔNG thấy menu cá nhân (self.read), dù ctx.getRequestContext cho phép chủ đơn dùng hrm.self.request.

## 4.6 Bảng ba lớp theo chức năng chính

| Chức năng / màn | Menu + trang (client) | API (handler) | RequirePermission (guard) | Nhận xét |
|---|---|---|---|---|
| Nhân sự (/employees) | employee.read | GET employees: employee.read; ghi: employee.manage; liên kết tài khoản: link-account | không | Khớp. Hồ sơ trả cả CCCD/MST/BHXH/ngân hàng cho mọi người có employee.read (mask chỉ cho trường lương qua hrm-salary-visibility); comp-ben và hr-head cũng có employee.read |
| Quyết định nhân sự | appointment.read | approve/reject/retry-apply: appointment.approve; tạo/sửa/hủy: appointment.manage | CÓ (11 route) | Khớp, lớp guard đầy đủ nhất |
| Danh mục ca (/shifts) | shift.read hoặc shift.manage | GET shifts: chỉ hrm.read; ghi: shift.manage; DELETE shift: kiểm tra trong helper | không | GET danh mục ca mở cho mọi người dùng HRM |
| Phân ca (/work-schedules) | schedule.read | schedule.read/manage/bulk/calendar tách theo hành động | CÓ (21 route) | Khớp; templates/:id/reapply cần bulk; hủy theo phạm vi cần calendar hoặc bulk |
| Chấm công cá nhân (/attendance) | self.read | check-in: kiểm tra self.attendance trong handler; my-attendance: self.read | không | Trang cần self.read nhưng ghi nhận chấm công cần self.attendance (quyền khác nhau) - người có self.read nhưng không self.attendance thấy trang và bị API từ chối |
| Chấm công toàn tenant | (không có menu riêng; màn trong dashboard/timesheets) | GET attendance, attendance-events, attendance/:id: attendance.read (tenant-wide, gồm cả danh sách sự kiện thô; nội dung trường evidence chưa xác minh) | không | department-head có attendance.read => thấy chấm công toàn tenant (không giới hạn đơn vị) |
| Đơn từ (/requests, /approvals) | self.read / request.read hoặc advance.read | list đơn: scoped(request.read) => người có request.read đọc đơn TOÀN TENANT; chỉ khi client gửi forApproval=1 mới lọc theo phạm vi duyệt; duyệt: <loại>.approve + assertCanDecide | không | Phạm vi đọc không bị ép ở máy chủ (xem G3) |
| Quỹ phép (/leave-settings) | leave.read | GET leave-balances/transactions: leave.read (tenant-wide); ghi: leave.manage; leave-types GET: hrm.read | không | leave.read được cấp ngầm cho mọi người có leave.approve (trưởng bộ phận) |
| Bảng công (/timesheets) | timesheet.read | tính: timesheet.calculate; điều chỉnh: adjust; khóa: lock; mở lại: reopen; xuất: export | CÓ cho lock/reopen | Khớp |
| Lương (/payroll) | payroll.read | tạo kỳ/run/hủy: payroll.calculate; tính: calculate; chốt: finalize; phát hành phiếu: publish; chi trả: pay; xuất: export; điều chỉnh: adjust | CÓ cho calculate/finalize/payslips-generate | record-payment ở hrm-payroll-settings.controller (payroll.pay) không có guard; đọc items/totals/payslips: payroll.read (tenant-wide) |
| Cấu hình lương (/payroll/settings) | payroll.configure | payroll-configuration, payroll-inputs, ot-configuration: payroll.configure; dry-run cần configure + payroll.read | không | Khớp |
| Cấu hình công (/policies) | time.configure / device.manage | time-settings: time.configure; thiết bị: device.manage; devices/register: self.attendance | không | Khớp |
| Vận hành (/operations) | automation.manage / integration.manage / audit.read | operations/audit: audit.read; automation: automation.manage; workflow-rules, field-mappings, retry: integration.manage | operations GET '' có | Khớp |
| Policy generic (/v1/policies) | KHÔNG có màn FE | tất cả hrm.manage | không | Endpoint không dùng bởi FE (0 tham chiếu), chỉ cho policy_type generic; quyền thô hơn các cửa cấu hình chi tiết |
| Quyền (/permissions) | hrm.read | capabilities (public cho module.access) | HrmPublicRoute | Mọi người dùng HRM xem danh mục |

## 4.7 Danh sách lỗ hổng/khoảng trống phân quyền

| # | Loại | Mô tả | Bằng chứng | Mức |
|---|---|---|---|---|
| G1 | Route/trang | Không có kiểm tra phía máy chủ cho trang HRM; chỉ ẩn bằng client (shell). Trang con hoặc đường dẫn mới không có trong hrmPagePermissions không bị chặn; dữ liệu chỉ bảo vệ ở API | apps/hrm-web (không middleware), hrm-shell.tsx:535 | Trung bình (do API là lớp thực thi) |
| G2 | Guard | HrmAccessGuard ở chế độ audit mặc định, 226/267 route chưa có @RequirePermission; không có cấu hình nào đặt HRM_ACCESS_GUARD_MODE=enforce | hrm-access.guard.ts; grep repo | Trung bình: an toàn nhờ handler, nhưng một handler mới quên getContext sẽ không bị guard bắt |
| G3 | Đọc quá rộng | request.read (cấp ngầm cho mọi *.approve, kể cả department-head) cho đọc đơn nghỉ/OT/công tác/đổi ca/giải trình/điều chỉnh hồ sơ của TOÀN TENANT; lọc phạm vi chỉ khi client truyền forApproval=1 | hrm-leave.controller.ts:1090-1130; hrm-request.controller.ts:140-170,451-470; hrm-attendance.controller.ts:426-440; hrm-profile-correction.controller.ts:48-60 | Cao |
| G4 | Đọc quá rộng | hrm.attendance.read (template department-head) = chấm công/sự kiện thô toàn tenant, không lọc đơn vị | hrm-attendance.controller.ts:158,194; template department-head | Cao |
| G5 | Đọc quá rộng | hrm.leave.read được cấp ngầm cho leave.approve: trưởng bộ phận thấy quỹ phép, sổ cái, quyết toán phép của toàn tenant (menu Quỹ phép hiện ra) | expandTenantActions 'hrm.leave.approve'; hrm-leave.controller.ts:171-193,386,555 | Trung bình |
| G6 | Đọc quá rộng | hrm.payroll.read: danh sách items/totals/payslips của toàn tenant (kể cả lương từng người) cho comp-ben, payroll-approver, payroll-accountant; hrm.salary.read: ngạch/bậc và lương NV | hrm-payroll.controller.ts (items, payslips), hrm-payroll-settings (totals) | Thấp (đúng vai trò) |
| G7 | Đọc PII | hrm.employee.read (hr-profile, hr-head, comp-ben) trả CCCD, mã số thuế, BHXH, tài khoản ngân hàng, địa chỉ; chỉ trường lương được mask | hrm-employee.controller.ts mapProfile; hrm-salary-visibility.ts | Trung bình (chưa xác minh mask từng trường) |
| G8 | Quyền yếu | POST requests/:kind/:id/actions chỉ yêu cầu hrm.read ở HRM; phân quyền thực sự ủy cho Procedure Engine (RACI) qua bridge, HRM chỉ chặn tự duyệt | hrm-request.controller.ts:933-966 | Trung bình |
| G9 | Quyền yếu | GET shifts, shifts/:id, leave-types, employee-options, request-workflows, payroll-period-options: chỉ hrm.read (mọi tài khoản HRM) - danh sách ca, loại nghỉ, danh sách nhân viên đang làm (mã + tên) mở cho mọi người dùng | hrm-shift.controller.ts; hrm-employee.controller.ts:71-91 | Thấp |
| G10 | Menu vs API | /permissions hiện cho mọi người; /payslips cần self.payslip nhưng /attendance cần self.read trong khi chấm công cần self.attendance (menu hiện, hành động bị từ chối) | hrm-permissions.tsx | Thấp |
| G11 | Template | 12 hành động không có template phi-admin: duyệt tạm ứng (advance.approve/.all), mở lại bảng công, dashboard.read, audit.read, automation/integration, request.manage, các approve.all (leave/ot/trip/shift) -> tạm ứng DIRECT chỉ admin duyệt được; dashboard tổng quan chỉ admin | hrm-role-templates.ts | Trung bình |
| G12 | Template | Vai nghiệp vụ (hr-profile, hr-head, timekeeper, comp-ben, pa, pac) không kèm hrm.self.* nên không thấy menu cá nhân; hr-head có salary.read nhưng không có menu lương riêng; payroll-approver có hrm.timesheet.lock nhưng không có calculate/export | ma trận 4.5 | Thấp |
| G13 | SoD | payroll_sod_settings: tenant mới mặc định BẬT (chống cùng người tính-chốt-phát hành), tenant có sẵn dữ liệu được seed FALSE (0026) nên admin (hrm.manage) có thể tính, chốt và phát hành cùng một người ở các tenant cũ | migrations 0026 | Trung bình |
| G14 | Thô | hrm-policy.controller dùng hrm.manage cho CRUD policy generic: nhánh quyền khác với các cửa cấu hình chi tiết (time.configure, payroll.configure) và không có UI | hrm-policy.controller.ts | Thấp |
| G15 | Ghi lương | POST employees/:id/salary-profiles chỉ cần hrm.salary.manage, không audit_log, không phê duyệt, cho hiệu lực lùi ngày trong kỳ chưa chốt (đối chiếu Part 2 #5) | hrm-salary.controller.ts:488-575 | Trung bình |
| G16 | Route nội bộ | POST internal/attendance/ingest có tiền tố 'internal' nhưng đi qua cùng API công khai, yêu cầu hrm.attendance.import | hrm-attendance.controller.ts | Thấp |
| G17 | Tự tạo hồ sơ | hrm-context.resolveEmployee tạo employee_profiles khi gọi API self-service (không cần hrm.employee.manage) | hrm-context.service.ts:43-52 | Trung bình |
| G18 | Cache | Quyền cache 30s phía identity và polling 30s ở FE: thu hồi quyền có độ trễ tối đa ~30-60s | tenant-authorization.ts resolve/cache; hrm-permissions.tsx | Thấp |
| G19 | Approval scope | Phạm vi duyệt dựa vào Core (reports_to/head), không dùng employee_reporting_lines; đổi quản lý bằng quyết định CHANGE_MANAGER không đổi phạm vi duyệt (xem F14); cảnh báo scopeStatus khi thiếu "Báo cáo cho" | hrm-approval-policy.ts | Cao |

## 4.8 Kết luận

- Điểm mạnh: kiểm tra quyền ở mọi handler qua getContext (có CSRF, JWT, entitlement, role_modules, cache theo revision); tách nhỏ 65 hành động; phân tách nhiệm vụ lương; chặn tự duyệt; wildcard hrm.manage/tenant.manage rõ ràng; module quyết định nhân sự và lịch làm việc đã có @RequirePermission theo hành động.
- Ưu tiên xử lý (đề xuất): (1) ép phạm vi đọc đơn/chấm công/phép ở máy chủ (G3-G5) hoặc tách quyền "đọc toàn tenant" khỏi "duyệt"; (2) hoàn thiện @RequirePermission cho 226 route rồi bật HRM_ACCESS_GUARD_MODE=enforce (G2); (3) thêm template cho duyệt tạm ứng và dashboard (G11); (4) audit_log cho tạo hồ sơ lương (G15); (5) hợp nhất nguồn quản lý trực tiếp cho phạm vi duyệt (G19); (6) thêm kiểm tra phiên/quyền SSR cho apps/hrm-web (G1).


---------------------------------------------------------------------

# PHỤ LỤC A - TOÀN BỘ ROUTE HRM VÀ QUYỀN (trích tự động từ mã nguồn; RP = @RequirePermission; sau dấu | cuối là các chuỗi hrm.* xuất hiện trong thân handler, theo thứ tự; trống = gọi helper nội bộ hoặc xem handler)

```

### hrm-approval-policy-settings  C('v1/approval-policy-settings')
GET   '' -> get | RP=- | hrm.integration.manage
PUT   '' -> put | RP=- | hrm.integration.manage

### hrm-approval-scope  C('v1/approval-scope')
GET   '' -> get | RP=hrm.read | hrm.read

### hrm-attachment  C('v1/attachments')
POST  '' -> create | RP=- | hrm.employee.manage,hrm.self.profile.write,hrm.read,hrm.employee.read,hrm.request.read,hrm.request.manage,hrm.self.read,hrm.self.request
POST  ':id/complete' -> complete | RP=- | 
GET   ':id/download' -> download | RP=- | hrm.employee.manage
DELETE':id' -> remove | RP=- | 

### hrm-attendance  C('v1')
POST  'attendance/check-in' -> checkIn | RP=- | 
POST  'attendance/check-out' -> checkOut | RP=- | hrm.self.attendance
GET   'my-attendance-context' -> myTimeContext | RP=- | hrm.self.read
GET   'my-attendance' -> myAttendance | RP=- | hrm.self.read
GET   'attendance' -> listAttendance | RP=- | hrm.attendance.read
GET   'attendance-events' -> listEvents | RP=- | hrm.attendance.read
GET   'attendance/:attendanceId' -> getAttendance | RP=- | hrm.attendance.read
POST  'internal/attendance/ingest' -> ingestAttendance | RP=- | hrm.attendance.import
POST  'attendance-corrections' -> createCorrection | RP=- | 
GET   'attendance-corrections' -> listCorrections | RP=- | hrm.request.read
POST  'attendance-corrections/:id/submit' -> submitCorrection | RP=- | hrm.attendance.approve
POST  'attendance-corrections/:id/approve' -> approveCorrection | RP=- | hrm.attendance.approve
POST  'attendance-corrections/:id/reject' -> rejectCorrection | RP=- | hrm.attendance.approve
POST  'attendance-corrections/:id/cancel' -> cancelCorrection | RP=- | hrm.attendance.approve

### hrm-capabilities  C('v1')
GET   'capabilities' -> get | RP=PUBLIC | module.access

### hrm-contract  C('v1')
PATCH 'contracts/:id' -> update | RP=- | hrm.employee.manage
DELETE'contracts/:id' -> remove | RP=- | hrm.employee.manage
POST  'contracts/:id/activate' -> activate | RP=- | hrm.employee.manage
POST  'contracts/:id/amendments' -> amend | RP=- | hrm.employee.manage
POST  'contracts/:id/terminate' -> terminate | RP=- | hrm.employee.manage

### hrm-dashboard  C('v1')
GET   'employees/:employeeId/overview' -> getEmployeeOverview | RP=- | hrm.employee.read,hrm.self.read
GET   'dashboard/overview' -> getDashboardOverview | RP=- | hrm.dashboard.read

### hrm-dependent  C('v1')
PATCH 'dependents/:id' -> update | RP=- | hrm.dependent.manage
GET   'dependents' -> list | RP=- | hrm.dependent.read
POST  'dependents' -> create | RP=- | hrm.dependent.manage
POST  'dependents/:id/end' -> end | RP=- | hrm.dependent.manage

### hrm-employee  C('v1')
GET   'employee-options' -> employeeOptions | RP=- | hrm.read
GET   'employees' -> listEmployees | RP=- | hrm.employee.read
GET   'employees/accounts' -> listUnlinkedAccounts | RP=- | hrm.employee.link-account
GET   'my-profile' -> getMyProfile | RP=- | hrm.self.read
GET   'my-profile/career-history' -> getMyCareerHistory | RP=- | hrm.self.read
POST  'employees/:employeeId/link-account' -> linkAccount | RP=- | hrm.employee.link-account
POST  'employees' -> createEmployee | RP=- | hrm.employee.manage
PATCH 'my-profile' -> updateMyProfile | RP=- | hrm.self.profile.write
GET   'employees/:employeeId/profile' -> getEmployeeProfile | RP=- | hrm.employee.read,hrm.self.read
GET   'employees/:employeeId/career-history' -> getCareerHistory | RP=- | hrm.employee.read,hrm.self.read
POST  'employees/:employeeId/profile' -> createEmployeeProfile | RP=- | hrm.employee.manage
PATCH 'employees/:employeeId/profile' -> updateEmployeeProfile | RP=- | hrm.employee.manage
POST  'employees/:employeeId/deactivate' -> deactivateEmployee | RP=- | hrm.employee.manage
GET   'positions/:positionId/profile' -> getPositionProfile | RP=- | hrm.employee.read
POST  'positions/:positionId/profile' -> createPositionProfile | RP=- | hrm.employee.manage
PATCH 'positions/:positionId/profile' -> updatePositionProfile | RP=- | hrm.employee.manage
GET   'positions' -> listPositions | RP=- | hrm.employee.read
DELETE'positions/:positionId/profile' -> deletePositionProfile | RP=- | hrm.employee.manage
GET   'my-dependents' -> getMyDependents | RP=- | hrm.self.read
POST  'my-dependents' -> createMyDependent | RP=- | hrm.self.profile.write
PATCH 'my-dependents/:id' -> updateMyDependent | RP=- | hrm.self.profile.write
DELETE'my-dependents/:id' -> deleteMyDependent | RP=- | hrm.self.profile.write
GET   'employees/:employeeId/dependents' -> getEmployeeDependents | RP=- | hrm.employee.read,hrm.self.read
POST  'employees/:employeeId/dependents' -> createEmployeeDependent | RP=- | hrm.employee.manage
PATCH 'employees/:employeeId/dependents/:id' -> updateEmployeeDependent | RP=- | hrm.employee.manage
DELETE'employees/:employeeId/dependents/:id' -> deleteEmployeeDependent | RP=- | hrm.employee.manage
GET   'employees/:employeeId/contracts' -> getEmployeeContracts | RP=- | hrm.employee.read,hrm.self.read
POST  'employees/:employeeId/contracts' -> createEmployeeContract | RP=- | hrm.employee.manage

### hrm-leave  C('v1')
POST  'leave-carryovers/run' -> carryover | RP=- | hrm.leave.manage
POST  'leave-carryovers/expire' -> expire | RP=- | hrm.leave.manage
POST  'leave-accruals/run' -> runAccrual | RP=- | hrm.leave.manage
POST  'leave-types/merge' -> mergeLeaveType | RP=- | hrm.leave.manage
GET   'leave-types/similar-names' -> similarLeaveTypes | RP=- | hrm.leave.read
GET   'leave-balances/reconcile' -> reconcileBalances | RP=- | hrm.leave.read
GET   'employees/:employeeId/leave-balance-at-date' -> employeeLeaveAtDate | RP=- | hrm.leave.read
GET   'leave-types' -> listLeaveTypes | RP=- | hrm.read
POST  'leave-types' -> createLeaveType | RP=- | hrm.leave.manage
PATCH 'leave-types/:id' -> updateLeaveType | RP=- | hrm.leave.manage
DELETE'leave-types/:id' -> deleteLeaveType | RP=- | 
GET   'leave-types/:leaveTypeId/accrual-schedules' -> listAccrualSchedules | RP=- | hrm.leave.read
POST  'leave-types/:leaveTypeId/accrual-schedules' -> createAccrualSchedule | RP=- | hrm.leave.manage
PATCH 'leave-types/:leaveTypeId/accrual-schedules/:id' -> updateAccrualSchedule | RP=- | 
DELETE'leave-types/:leaveTypeId/accrual-schedules/:id' -> deleteAccrualSchedule | RP=- | 
POST  'leave-types/:leaveTypeId/accrual-schedules/:id/version' -> versionAccrualSchedule | RP=- | 
POST  'leave-types/:leaveTypeId/accrual-schedules/:id/deactivate' -> deactivateAccrualSchedule | RP=- | hrm.leave.manage
GET   'leave-balances' -> listAllLeaveBalances | RP=- | hrm.leave.read
GET   'leave-transactions' -> listAllLeaveTransactions | RP=- | hrm.leave.read
POST  'leave-adjustments' -> adjustLeaveBalance | RP=- | hrm.leave.manage
POST  'leave-transactions/:id/reverse' -> reverseLeaveAdjustment | RP=- | hrm.leave.manage
GET   'leave-entitlements/preview' -> previewEntitlements | RP=- | hrm.leave.read
GET   'employees/:employeeId/leave-settlement-preview' -> previewSettlement | RP=- | hrm.leave.read
GET   'leave-settlements' -> listSettlements | RP=- | hrm.leave.read
POST  'leave-settlements/:id/schedule' -> scheduleLeaveSettlement | RP=- | hrm.leave.manage
POST  'leave-settlements/:id/waive' -> waiveLeaveSettlement | RP=- | hrm.leave.manage
GET   'employees/:employeeId/leave-balances' -> getEmployeeLeaveBalances | RP=- | hrm.leave.read,hrm.self.read
GET   'employees/:employeeId/leave-transactions' -> getEmployeeLeaveTransactions | RP=- | hrm.leave.read,hrm.self.read
POST  'leave-requests' -> createLeaveRequest | RP=- | 
GET   'leave-requests' -> listLeaveRequests | RP=- | hrm.request.read
POST  'leave-requests/:id/approve' -> approveLeaveRequest | RP=- | 
POST  'leave-requests/:id/reject' -> rejectLeaveRequest | RP=- | 
POST  'leave-requests/:id/cancel' -> cancelLeaveRequest | RP=- | hrm.read,hrm.leave.approve
POST  'leave-requests/:id/amend' -> amendLeaveRequest | RP=- | hrm.read,hrm.leave.approve

### hrm-operations  C('v1')
GET   'request-drafts' -> listDrafts | RP=- | 
POST  'request-drafts/:kind' -> createDraft | RP=- | 
PATCH 'request-drafts/:kind/:id' -> updateDraft | RP=- | 
DELETE'request-drafts/:kind/:id' -> deleteDraft | RP=- | hrm.read
POST  'requests/:kind/:id/withdraw' -> withdraw | RP=- | hrm.read
POST  'requests/:kind/:id/reverse' -> reverseRequest | RP=- | hrm.leave.approve,hrm.ot.approve,hrm.trip.approve,hrm.attendance.approve,hrm.advance.approve
GET   'request-workflows' -> requestWorkflows | RP=- | hrm.read,hrm.request.read,hrm.self.read
GET   'operations/audit' -> audit | RP=- | hrm.audit.read
GET   'operations' -> get | RP=- | hrm.read,hrm.automation.manage,hrm.integration.manage,hrm.audit.read
POST  'operations/automation' -> configure | RP=- | hrm.automation.manage
POST  'operations/automation/run' -> run | RP=- | hrm.automation.manage
GET   'operations/leave-year-end-checklist' -> leaveYearEndChecklist | RP=- | hrm.automation.manage
GET   'operations/subtype-catalog' -> subtypeCatalog | RP=- | hrm.integration.manage
GET   'operations/field-catalog' -> fieldCatalog | RP=- | hrm.integration.manage
GET   'operations/procedure-definitions/:definitionId/attributes' -> definitionAttributes | RP=- | hrm.integration.manage
GET   'operations/workflow-rules/:bindingId/field-mappings' -> fieldMappings | RP=- | hrm.integration.manage
PUT   'operations/workflow-rules/:bindingId/field-mappings' -> saveFieldMappings | RP=- | hrm.integration.manage
GET   'operations/procedure-definitions' -> definitions | RP=- | hrm.integration.manage
POST  'operations/workflow-rules' -> workflowRule | RP=- | hrm.integration.manage
POST  'operations/workflows/:id/retry' -> retry | RP=- | hrm.integration.manage
GET   'my-notifications' -> notifications | RP=- | hrm.self.read
POST  'my-notifications/:id/read' -> readNotification | RP=- | hrm.self.read
GET   'my-calendar' -> calendar | RP=- | hrm.self.read

### hrm-payroll-settings  C('v1')
GET   'payroll-period-options' -> periodOptions | RP=- | hrm.read,hrm.advance.disburse,hrm.payroll.calculate
GET   'payroll-configuration' -> get | RP=- | hrm.payroll.configure,hrm.payroll.read
GET   'payroll-dry-run/runs' -> dryRunRuns | RP=- | 
GET   'payroll-dry-run/runs/:id/employees' -> dryRunEmployees | RP=- | 
POST  'payroll-dry-run' -> dryRun | RP=- | 
POST  'payroll-configuration' -> save | RP=- | 
POST  'ot-configuration' -> overtime | RP=- | hrm.payroll.configure
PATCH 'payroll-configuration/:id' -> updateConfiguration | RP=- | hrm.payroll.configure
DELETE'payroll-configuration/:id' -> deleteConfiguration | RP=- | hrm.payroll.configure
POST  'payroll-configuration/:id/deactivate' -> deactivateConfiguration | RP=- | hrm.payroll.configure
GET   'employees/:employeeId/payroll-inputs' -> listInputs | RP=- | hrm.payroll.configure
PATCH 'employees/:employeeId/payroll-inputs/:date' -> undefined | RP=- | 
DELETE'employees/:employeeId/payroll-inputs/:date' -> undefined | RP=- | 
POST  'employees/:employeeId/payroll-inputs' -> inputs | RP=- | hrm.payroll.configure
GET   'payroll-periods/:id/runs' -> runs | RP=- | hrm.payroll.read
GET   'payroll-runs/:id/totals' -> totals | RP=- | hrm.payroll.read
POST  'payroll-totals/:id/record-payment' -> payment | RP=- | hrm.payroll.pay

### hrm-payroll-sod  C('v1')
GET   'payroll-sod-settings' -> get | RP=hrm.payroll.read | hrm.payroll.read
PUT   'payroll-sod-settings' -> put | RP=hrm.payroll.configure | hrm.payroll.configure

### hrm-payroll  C('v1')
GET   'payroll-runs/:runId/export' -> exportRun | RP=- | hrm.payroll.export
GET   'payroll-periods' -> listPeriods | RP=- | hrm.payroll.read
POST  'payroll-periods' -> createPeriod | RP=- | hrm.payroll.calculate
PATCH 'payroll-periods/:id' -> updatePeriod | RP=- | hrm.payroll.calculate
DELETE'payroll-periods/:id' -> deletePeriod | RP=- | hrm.payroll.calculate
POST  'payroll-runs/:runId/cancel' -> cancelRun | RP=- | hrm.payroll.calculate
POST  'payroll-periods/:periodId/runs' -> createRun | RP=- | hrm.payroll.calculate
GET   'payroll-runs/:runId' -> getRun | RP=- | hrm.payroll.read
POST  'payroll-runs/:runId/calculate' -> calculateRun | RP=hrm.payroll.calculate | hrm.payroll.calculate
POST  'payroll-runs/:runId/finalize' -> finalizeRun | RP=hrm.payroll.finalize | hrm.payroll.finalize
GET   'payroll-runs/:runId/items' -> listItems | RP=- | hrm.payroll.read
POST  'payroll-runs/:runId/adjustments' -> addAdjustment | RP=- | hrm.payroll.adjust
PATCH 'payroll-adjustments/:id' -> updateAdjustment | RP=- | 
DELETE'payroll-adjustments/:id' -> deleteAdjustment | RP=- | hrm.payroll.adjust
POST  'payroll-runs/:runId/payslips/generate' -> generatePayslips | RP=hrm.payroll.publish | hrm.payroll.publish
GET   'my-payslips' -> myPayslips | RP=- | hrm.self.payslip
GET   'payroll-runs/:runId/payslips' -> listPayslips | RP=- | hrm.payroll.read

### hrm-personnel-decision  C('v1')
GET   'personnel-decisions' -> list | RP=hrm.appointment.read | hrm.appointment.read
GET   'personnel-decisions/:id' -> get | RP=hrm.appointment.read | hrm.appointment.read
POST  'personnel-decisions' -> create | RP=hrm.appointment.manage | hrm.appointment.manage
PATCH 'personnel-decisions/:id' -> update | RP=hrm.appointment.manage | hrm.appointment.manage
POST  'personnel-decisions/:id/approve' -> approve | RP=hrm.appointment.approve | hrm.appointment.approve
POST  'personnel-decisions/:id/reject' -> reject | RP=hrm.appointment.approve | hrm.appointment.approve
POST  'personnel-decisions/:id/cancel' -> cancel | RP=hrm.appointment.manage | hrm.appointment.read,hrm.appointment.manage,hrm.appointment.approve
POST  'personnel-decisions/:id/retry-apply' -> retryApply | RP=hrm.appointment.approve | hrm.appointment.approve
GET   'employees/:employeeId/reporting-lines' -> reportingLines | RP=hrm.self.read | hrm.employee.read
GET   'employees/:employeeId/subordinates' -> subordinates | RP=hrm.appointment.read | hrm.appointment.read
GET   'employees/:employeeId/appointment-context' -> appointmentContext | RP=hrm.appointment.read | hrm.appointment.read

### hrm-policy  C('v1/policies')
GET   '' -> listPolicies | RP=- | hrm.manage
POST  '' -> createPolicy | RP=- | hrm.manage
GET   ':policyId' -> getPolicy | RP=- | hrm.manage
PATCH ':policyId' -> updatePolicy | RP=- | hrm.manage
GET   ':policyId/versions' -> listVersions | RP=- | hrm.manage
POST  ':policyId/versions' -> createVersion | RP=- | hrm.manage
POST  ':policyId/versions/:versionId/activate' -> activateVersion | RP=- | hrm.manage
POST  ':policyId/versions/:versionId/deactivate' -> deactivateVersion | RP=- | hrm.manage

### hrm-profile-correction  C('v1/profile-corrections')
GET   '' -> list | RP=- | hrm.request.read
POST  '' -> create | RP=- | hrm.self.request
POST  ':id/approve' -> approve | RP=- | hrm.profile.approve
POST  ':id/reject' -> reject | RP=- | hrm.profile.approve

### hrm-profile-document  C('v1')
GET   'employees/:employeeId/profile-documents' -> list | RP=- | hrm.employee.read
POST  'employees/:employeeId/profile-documents' -> apply | RP=- | hrm.employee.manage,hrm.self.profile.write

### hrm-request  C('v1')
GET   'procedure-definitions/binding' -> getBindingDefinition | RP=- | hrm.read
POST  'ot-requests' -> createOtRequest | RP=- | 
GET   'ot-requests' -> listOtRequests | RP=- | hrm.request.read
POST  'ot-requests/:id/approve' -> approveOtRequest | RP=- | hrm.ot.approve
POST  'ot-requests/:id/reject' -> rejectOtRequest | RP=- | hrm.ot.approve
GET   'work-references' -> workItems | RP=- | hrm.self.request
POST  'business-trip-requests' -> createBusinessTripRequest | RP=- | 
GET   'business-trip-requests' -> listBusinessTripRequests | RP=- | hrm.request.read
POST  'business-trip-requests/:id/approve' -> approveBusinessTrip | RP=- | hrm.trip.approve
POST  'business-trip-requests/:id/reject' -> rejectBusinessTrip | RP=- | hrm.trip.approve
POST  'business-trip-requests/:id/cancel' -> cancelBusinessTrip | RP=- | hrm.trip.approve
POST  'shift-change-requests' -> createShiftChangeRequest | RP=- | 
POST  'shift-change-requests/:id/peer-confirm' -> peerConfirmShiftChange | RP=- | hrm.self.request
GET   'shift-change-requests' -> listShiftChanges | RP=- | hrm.request.read
POST  'shift-change-requests/:id/approve' -> approveShiftChange | RP=- | hrm.shift.approve
POST  'shift-change-requests/:id/reject' -> rejectShiftChange | RP=- | hrm.shift.approve
POST  'requests/:kind/:id/actions' -> procedureAction | RP=- | hrm.read
GET   'procedure-progress/:procedureInstanceId' -> getProcedureProgress | RP=- | hrm.read,hrm.request.read,hrm.self.read
GET   'workspace-projects' -> listWorkspaceProjects | RP=- | hrm.read

### hrm-salary  C('v1')
GET   'salary-grades' -> listGrades | RP=- | hrm.salary.read
POST  'salary-grades' -> createGrade | RP=- | hrm.salary.manage
PATCH 'salary-grades/:id' -> updateGrade | RP=- | hrm.salary.manage
DELETE'salary-grades/:id' -> deleteGrade | RP=- | hrm.salary.manage
GET   'salary-grades/:gradeId/steps' -> listGradeSteps | RP=- | hrm.salary.read
POST  'salary-grades/:gradeId/steps' -> createGradeStep | RP=- | hrm.salary.manage
PATCH 'salary-grades/:gradeId/steps/:id' -> updateGradeStep | RP=- | hrm.salary.manage
DELETE'salary-grades/:gradeId/steps/:id' -> deleteGradeStep | RP=- | hrm.salary.manage
GET   'employees/:employeeId/salary-profiles' -> listEmployeeSalaryProfiles | RP=- | hrm.salary.read,hrm.self.read
GET   'employees/:employeeId/salary-profiles/current' -> getCurrentEmployeeSalaryProfile | RP=- | hrm.salary.read,hrm.self.read
POST  'employees/:employeeId/salary-profiles' -> createEmployeeSalaryProfile | RP=- | hrm.salary.manage
POST  'salary-advance-requests' -> createAdvanceRequest | RP=- | 
GET   'salary-advance-requests' -> listAdvanceRequests | RP=- | hrm.advance.read
POST  'salary-advance-requests/:id/approve' -> approveAdvance | RP=- | hrm.advance.approve
POST  'salary-advance-requests/:id/reject' -> rejectAdvance | RP=- | hrm.advance.approve
POST  'salary-advance-requests/:id/schedule' -> scheduleAdvance | RP=- | hrm.advance.disburse
PATCH 'salary-advance-deductions/:id' -> updateDeduction | RP=- | 
POST  'salary-advance-deductions/:id/cancel' -> cancelDeduction | RP=- | hrm.advance.disburse
POST  'salary-advance-requests/:id/disburse' -> disburseAdvance | RP=- | hrm.advance.disburse
GET   'salary-advance-requests/:id/deductions' -> listAdvanceDeductions | RP=- | hrm.advance.read

### hrm-shift  C('v1')
GET   'shifts' -> listShifts | RP=- | hrm.read
POST  'shifts' -> createShift | RP=- | hrm.shift.manage
GET   'shifts/:shiftId' -> getShift | RP=- | hrm.read
PATCH 'shifts/:shiftId' -> updateShift | RP=- | hrm.shift.manage
DELETE'shifts/:shiftId' -> deleteShift | RP=- | 

### hrm-time-settings  C('v1/time-settings')
GET   '' -> get | RP=- | hrm.read,hrm.time.configure,hrm.device.manage
POST  'policy' -> policy | RP=- | hrm.time.configure
GET   'calendar/holiday-draft' -> holidayDraft | RP=- | hrm.time.configure
POST  'calendar/holiday-draft/confirm' -> confirmHolidayDraft | RP=- | hrm.time.configure
POST  'calendar' -> calendar | RP=- | hrm.time.configure
POST  'sites' -> site | RP=- | hrm.time.configure
DELETE'calendar/:id' -> deleteCalendar | RP=- | hrm.time.configure
PATCH 'sites/:id' -> updateSite | RP=- | 
POST  'sites/:id/deactivate' -> deactivateSite | RP=- | hrm.time.configure
POST  'devices/register' -> register | RP=- | hrm.self.attendance
POST  'devices/:id/:action' -> deviceAction | RP=- | hrm.device.manage

### hrm-timesheet  C('v1')
GET   'timesheet-periods/:id/export' -> exportPeriod | RP=- | hrm.timesheet.export
GET   'timesheet-periods' -> listPeriods | RP=- | hrm.timesheet.read
POST  'timesheet-periods' -> createPeriod | RP=- | hrm.timesheet.calculate
GET   'timesheet-periods/:id' -> getPeriod | RP=- | hrm.timesheet.read
PATCH 'timesheet-periods/:id' -> updatePeriod | RP=- | hrm.timesheet.calculate
DELETE'timesheet-periods/:id' -> deletePeriod | RP=- | hrm.timesheet.calculate
POST  'timesheet-periods/:id/calculate' -> calculatePeriod | RP=- | hrm.timesheet.calculate
POST  'timesheet-periods/:id/lock' -> lockPeriod | RP=hrm.timesheet.lock | hrm.timesheet.lock
POST  'timesheet-periods/:id/reopen' -> reopenPeriod | RP=hrm.timesheet.reopen | hrm.timesheet.reopen
GET   'timesheets' -> listTimesheets | RP=- | hrm.timesheet.read
GET   'timesheets/:id' -> getTimesheet | RP=- | hrm.timesheet.read
POST  'timesheets/:id/adjust' -> adjustTimesheet | RP=- | hrm.timesheet.adjust

### hrm-work-schedule  C('v1')
GET   'shift-units' -> listUnits | RP=hrm.schedule.read | hrm.schedule.read
GET   'work-schedule-templates' -> listTemplates | RP=hrm.schedule.read | hrm.schedule.read
POST  'work-schedule-templates' -> createTemplate | RP=hrm.schedule.manage | hrm.schedule.manage
PATCH 'work-schedule-templates/:id' -> updateTemplate | RP=hrm.schedule.manage | hrm.schedule.manage
POST  'work-schedule-templates/:id/copy' -> copyTemplate | RP=hrm.schedule.manage | hrm.schedule.manage
POST  'work-schedule-templates/:id/deactivate' -> deactivateTemplate | RP=hrm.schedule.manage | hrm.schedule.manage
POST  'work-schedule-templates/:id/reapply' -> reapplyTemplate | RP=hrm.schedule.bulk | hrm.schedule.bulk
GET   'work-schedules/grid' -> grid | RP=hrm.schedule.read | hrm.schedule.read
GET   'work-schedules/list' -> list | RP=hrm.schedule.read | hrm.schedule.read
GET   'work-schedules/export' -> exportSchedule | RP=hrm.schedule.read | hrm.schedule.read
GET   'work-schedules/rules' -> rules | RP=hrm.schedule.read | hrm.schedule.read,hrm.schedule.manage,hrm.schedule.bulk
POST  'work-schedules/rules/:id/end' -> endRule | RP=hrm.schedule.manage | 
POST  'work-schedules/rules/:id/cancel' -> cancelRule | RP=hrm.schedule.manage | 
GET   'work-schedules/audit' -> audit | RP=hrm.schedule.read | hrm.schedule.read
POST  'work-schedules/preview' -> preview | RP=hrm.schedule.manage | 
POST  'work-schedules' -> apply | RP=hrm.schedule.manage | 
POST  'work-schedules/cancel' -> cancel | RP=hrm.schedule.manage | hrm.schedule.calendar
POST  'work-schedules/copy' -> copy | RP=hrm.schedule.bulk | hrm.schedule.bulk,hrm.schedule.calendar
GET   'work-schedule-holidays' -> listHolidays | RP=hrm.schedule.read | hrm.schedule.read
POST  'work-schedule-holidays' -> createHoliday | RP=hrm.schedule.calendar | hrm.schedule.calendar
POST  'work-schedule-holidays/:id/cancel' -> cancelHoliday | RP=hrm.schedule.calendar | hrm.schedule.calendar
TOTAL 267 DECLARED 41
```
