# Audit B3 - Backend Lương (HRM payroll) - READ-ONLY

Phạm vi: `packages/modules/hrm/src/lib/presentation/{hrm-payroll,hrm-payroll-settings,hrm-payroll-sod,hrm-salary}.controller.ts`, logic `infrastructure/hrm-payroll-{calculation,lifecycle,sod}.ts`, `domain/payroll-{formula,dry-run}.ts`, `hrm-request-transition.ts` (approveSalaryAdvance), migrations `migrations/tenant/hrm/{0001,0006,0011,0013,0020,0026}*.sql`. Route thực tế: `/api/hrm/v1/...`. Tổng cộng 56 endpoint (17 + 17 + 2 + 20).
Nguyên tắc: chỉ kết luận từ code đã đọc; không đọc được thì ghi "chưa xác minh". Đường dẫn file ngắn gọn: PC = hrm-payroll.controller.ts, PS = hrm-payroll-settings.controller.ts, SOD = hrm-payroll-sod.controller.ts, SAL = hrm-salary.controller.ts, CALC = infrastructure/hrm-payroll-calculation.ts.
Frontend = `packages/features/hrm/src/lib/...` (PAY = screens/payroll-screen.tsx, SET = screens/payroll-settings-screen.tsx, ADV = screens/advances-screen.tsx, EMP = screens/employees-screen.tsx).

Ghi chú chung về quyền: mọi handler tự gọi `ctx.getContext(req, '<action>')` (gọi Core `identity.decide`), `@RequirePermission` chỉ có trên calculate, finalize, payslips/generate và 2 route SOD (HrmAccessGuard mặc định chế độ `audit`: chỉ cảnh báo, không chặn; `HRM_ACCESS_GUARD_MODE=enforce` KHÔNG thấy được set trong repo -> môi trường chạy thật chưa xác minh). Nếu bật `enforce`, mọi route lương/lương-ứng không có decorator sẽ bị 403 `HRM_PERMISSION_NOT_DECLARED` (hrm-access.guard.ts:62-68) - rủi ro vận hành. `expandTenantActions` (tenant-authorization.ts:489-500) tự cộng `hrm.payroll.read` cho mọi `hrm.payroll.*` trừ `configure`, và `hrm.timesheet.read` cho `calculate`. `hrm.manage`/`tenant.manage` qua `ctx.has` luôn thỏa.

---------------------------------------------------------------------
## (A) Bảng endpoint

Cột: mã | METHOD path | file:dòng | hành vi thực | quyền | bảng | FE gọi? | trạng thái | ghi chú

### A1. hrm-payroll.controller.ts (kỳ lương, lần tính, điều chỉnh, phiếu lương, xuất)

| Mã | Endpoint | File:dòng | Hành vi thực | Quyền | Bảng đọc/ghi | FE | Trạng thái | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| B3-01 | GET /payroll-runs/:runId/export?kind=payments\|reconciliation | PC:52 | Chỉ khi run FINALIZED. payments: CSV chi trả từ `beneficiary_snapshot`, 400 nếu BẤT KỲ nhân viên thiếu ngân hàng/số TK. reconciliation: CSV từng payroll_item. Có chống CSV-injection (`hrmCsv`). Ghi audit PAYROLL_EXPORT | `hrm.payroll.export` | R: payroll_runs, payroll_periods, payroll_employee_totals, payroll_items; W: audit_log | PAY:600,614 (`downloadHrmExport`) | hoàn chỉnh (có lỗ hổng, xem C-09) | Thông báo lỗi bảo "tính lại trước khi chốt" nhưng run đã FINALIZED không tính lại được |
| B3-02 | GET /payroll-periods | PC:172 | Liệt kê mọi kỳ lương của tenant | `hrm.payroll.read` | R: payroll_periods | PAY:178, dashboard-screen:99, ui/leave-settlements:50 | hoàn chỉnh | Không phân trang |
| B3-03 | POST /payroll-periods | PC:191 | Tạo kỳ OPEN; bắt buộc `timesheetPeriodId`, kỳ công phải LOCKED và trùng đúng from/to | `hrm.payroll.calculate` | R: timesheet_periods; W: payroll_periods | PAY:367 | hoàn chỉnh một phần | KHÔNG transaction, KHÔNG audit; không có unique/kiểm tra chồng lấn theo `timesheet_period_id` (chỉ FK ở 0001-hrm.sql:492; unique chỉ (tenant,period_code)) |
| B3-04 | PATCH /payroll-periods/:id | PC:251 | Sửa mã kỳ + ngày trả, chỉ khi kỳ OPEN và chưa có run/lịch thu hồi (`lockEmptyPayrollPeriod`), khóa lạc quan `expectedUpdatedAt`, bắt buộc lý do | `hrm.payroll.calculate` | R/W: payroll_periods; R: payroll_runs, salary_advance_deductions; W: audit_log (PAYROLL_PERIOD_UPDATED) | PAY:267 | hoàn chỉnh | Không đổi được from/to/liên kết kỳ công |
| B3-05 | DELETE /payroll-periods/:id | PC:307 | Xóa cứng kỳ trống (cùng điều kiện B3-04) | `hrm.payroll.calculate` | W: payroll_periods, audit_log (PAYROLL_PERIOD_DELETED) | PAY:267 | hoàn chỉnh | |
| B3-06 | POST /payroll-runs/:runId/cancel | PC:341 | Hủy run (CANCELLED) nếu chưa FINALIZED/CANCELLED và kỳ chưa LOCKED/PAID; idempotent nếu cùng lý do | `hrm.payroll.calculate` | R/W: payroll_runs; R: payroll_periods; W: audit_log (PAYROLL_RUN_CANCELLED) | PAY:480 | hoàn chỉnh | Giữ nguyên items/totals của run bị hủy |
| B3-07 | POST /payroll-periods/:periodId/runs | PC:386 | Tạo run DRAFT, `run_no`=max+1, `calculation_version`='HRM_FORMULA_V1'; từ chối kỳ LOCKED/PAID | `hrm.payroll.calculate` | R: payroll_periods(FOR UPDATE); W: payroll_runs | PAY:521 | hoàn chỉnh | Không audit, không kiểm tra kỳ công khóa (để bước calculate kiểm) |
| B3-08 | GET /payroll-runs/:runId | PC:411 | Đọc 1 run | `hrm.payroll.read` | R: payroll_runs | không thấy nơi gọi | hoàn chỉnh | Không validate uuid -> lỗi DB nếu sai định dạng (chưa xác minh bộ lọc lỗi toàn cục) |
| B3-09 | POST /payroll-runs/:runId/calculate | PC:434 | Gọi `calculatePayroll` (CALC:61) trong 1 transaction rồi `recordPayrollActor('calculated_by')`; xem mục (3) | `hrm.payroll.calculate` (+decorator) | R: payroll_runs, payroll_periods, timesheet_periods, timesheets, employee_profiles, policy_versions/policies, payroll_employee_inputs, employee_salary_profiles, salary_advance_deductions/requests, payroll_items(MANUAL), leave_settlements, employee_dependents, employee_directory; W: payroll_items, payroll_employee_totals, payroll_runs | PAY:534 | hoàn chỉnh (all-or-nothing) | KHÔNG audit; lỗi 1 nhân viên làm hỏng cả run (thông báo dùng employeeId thô) |
| B3-10 | POST /payroll-runs/:runId/finalize | PC:454 | Chốt: yêu cầu CALCULATED/APPROVED, SoD finalize, kỳ chưa có run FINALIZED khác, kỳ công vẫn LOCKED; trừ nợ ứng lương theo lịch SCHEDULED của kỳ; chuyển leave_settlements SCHEDULED->DEDUCTED nếu có item LEAVE_RECOVERY; khóa kỳ (LOCKED); run->FINALIZED | `hrm.payroll.finalize` (+decorator) | R/W: payroll_runs, payroll_periods, salary_advance_requests, salary_advance_deductions, leave_settlements; R: timesheet_periods, payroll_items | PAY:546 | hoàn chỉnh về luồng, thiếu audit và có lỗi lô-gic (C-03) | Idempotent nếu đã FINALIZED. Không audit (chỉ lưu finalized_by) |
| B3-11 | GET /payroll-runs/:runId/items | PC:530 | Mọi payroll_items của run (kèm calculation_snapshot) | `hrm.payroll.read` | R: payroll_items | PAY:205 | hoàn chỉnh | Lộ lương/biến công của mọi nhân viên cho ai có payroll.read, không cần `hrm.salary.read` |
| B3-12 | POST /payroll-runs/:runId/adjustments | PC:549 | Thêm khoản MANUAL_ADJUSTMENT (EARNING hoặc OTHER_DEDUCTION, số tiền >=0); idempotent theo `operationId`; run->DRAFT, `calculated_at=NULL` | `hrm.payroll.adjust` | R: payroll_runs, payroll_periods, employee_profiles; W: payroll_items, payroll_runs | PAY:752 | hoàn chỉnh một phần | KHÔNG audit; không kiểm tra NV có nằm trong bảng công/run (C-05) |
| B3-13 | PATCH /payroll-adjustments/:id | PC:636 | Sửa số tiền/lý do khoản thủ công (chỉ MANUAL_ADJUSTMENT, run chưa APPROVED/FINALIZED/CANCELLED, kỳ chưa khóa); run->DRAFT | `hrm.payroll.adjust` | R/W: payroll_items, payroll_runs; W: audit_log (PAYROLL_ADJUSTMENT_UPDATED, lưu before/after) | PAY:295 | hoàn chỉnh | |
| B3-14 | DELETE /payroll-adjustments/:id | PC:647 | Xóa cứng khoản thủ công, run->DRAFT | `hrm.payroll.adjust` | như B3-13 (PAYROLL_ADJUSTMENT_DELETED) | PAY:295 | hoàn chỉnh | |
| B3-15 | POST /payroll-runs/:runId/payslips/generate | PC:736 | Chỉ run FINALIZED; SoD publish; ghi `published_by`; với mỗi total chưa có payslip tạo `payslips` PUBLISHED với `snapshot_json` {period, total, salaryProfiles, items}; phát outbox `hrm.payslip.published` nếu NV có user | `hrm.payroll.publish` (+decorator) | R: payroll_runs, payroll_periods, payroll_employee_totals, employee_directory, payroll_items, employee_salary_profiles; W: payslips, payroll_runs.published_by, integration_schema.outbox_events | PAY:564 | hoàn chỉnh (idempotent theo NV) | KHÔNG audit; không có thu hồi/hủy phát hành; `payslip_no`=`PS-<uuid>`; trả `count`=số total chứ không phải số phiếu mới |
| B3-16 | GET /my-payslips | PC:864 | Phiếu lương của chính NV (PUBLISHED/VIEWED/DOWNLOADED), trả nguyên `snapshot_json` | `hrm.self.payslip` | R: payslips (+ resolveEmployee) | payslips-screen:40 | hoàn chỉnh | Snapshot chứa `total` -> gồm `beneficiary_snapshot` (số TK ngân hàng) và toàn bộ `calculation_snapshot` các item |
| B3-17 | GET /payroll-runs/:runId/payslips | PC:882 | Mọi phiếu của run (kèm snapshot) | `hrm.payroll.read` | R: payslips | không thấy nơi gọi | hoàn chỉnh | Quản lý xem được nội dung phiếu từng người chỉ với payroll.read |

### A2. hrm-payroll-settings.controller.ts (cấu hình, tham số NV, tính thử, tổng hợp run, ghi nhận chi trả)

| Mã | Endpoint | File:dòng | Hành vi thực | Quyền | Bảng | FE | Trạng thái | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| B3-18 | GET /payroll-period-options | PS:137 | Kỳ chưa LOCKED/PAID để chọn lập lịch thu hồi | `hrm.read`, rồi `hrm.advance.disburse` nếu có, ngược lại `hrm.payroll.calculate` | R: payroll_periods | ADV:85 | hoàn chỉnh | Gọi getContext 2 lần |
| B3-19 | GET /payroll-configuration | PS:155 | Mọi phiên bản policy PAYROLL và OT kèm cờ `used`/`used_by_finalized` | `hrm.payroll.configure` | R: policy_versions, policies, payroll_items, ot_requests, leave_accrual_schedules, payroll_runs | SET:215 | hoàn chỉnh | |
| B3-20 | GET /payroll-dry-run/runs | PS:188 | 36 run CALCULATED/APPROVED/FINALIZED gần nhất | `hrm.payroll.configure` + `hrm.payroll.read` | R: payroll_runs, payroll_periods | ui/payroll-dry-run-panel:59 | hoàn chỉnh | |
| B3-21 | GET /payroll-dry-run/runs/:id/employees | PS:200 | NV có total trong run | như B3-20 | R: payroll_employee_totals, employee_directory | panel:69 | hoàn chỉnh | |
| B3-22 | POST /payroll-dry-run | PS:213 | Tính thử 1-3 NV: lấy biến hệ thống từ `calculation_snapshot->'inputs'` của run đã tính + công thức/tham số thử của body; `dryRunPayroll` thuần, KHÔNG ghi DB | như B3-20 | R: payroll_items, employee_directory, payroll_employee_inputs | panel:78 | hoàn chỉnh | Không audit dù đọc dữ liệu lương thật |
| B3-23 | POST /payroll-configuration | PS:295 | Xuất bản phiên bản PAYROLL mới (components, inputs, salaryType, standardMinutes) có hiệu lực từ ngày; chặn nếu có kỳ LOCKED/PAID sau ngày đó; đưa mọi run chưa chốt về DRAFT | `hrm.payroll.configure` | R/W: policies, policy_versions, payroll_runs; R: payroll_periods; W: audit_log (POLICY_VERSION_PUBLISHED) | SET:715 | hoàn chỉnh | Cấu hình toàn tenant (không scope theo NV) |
| B3-24 | POST /ot-configuration | PS:314 | Xuất bản phiên bản OT (hệ số, trần, khung đêm) | `hrm.payroll.configure` | như B3-23 + assertOpenRange | ui/payroll-ot-dialog:107 | hoàn chỉnh | Thuộc cấu hình chấm công nhưng đặt trong controller lương |
| B3-25 | PATCH /payroll-configuration/:id | PS:450 | Sửa phiên bản CHƯA dùng bởi payroll_items/ot_requests/leave schedules và không có bản mới hơn; giữ nguyên ngày hiệu lực; lý do + khóa lạc quan | `hrm.payroll.configure` | R/W: policy_versions; W: audit_log (PAYROLL_CONFIGURATION_UPDATED) | SET:714; ot-dialog:107 | hoàn chỉnh | |
| B3-26 | DELETE /payroll-configuration/:id | PS:502 | Xóa phiên bản chưa dùng, mới nhất và chưa có hiệu lực; mở lại bản trước | `hrm.payroll.configure` | W: policy_versions, audit_log (PAYROLL_CONFIGURATION_DELETED) | SET:303 | hoàn chỉnh | |
| B3-27 | POST /payroll-configuration/:id/deactivate | PS:549 | Đặt `effective_to`, status SUPERSEDED, vô hiệu hóa run chưa chốt từ ngày sau | `hrm.payroll.configure` | W: policy_versions, payroll_runs, audit_log (PAYROLL_CONFIGURATION_ENDED) | SET:303 | hoàn chỉnh | Nhãn `PAYROLL_CONFIGURATION_ENDED` KHÔNG có trong bảng nhãn hrm-audit-trail.ts (chỉ có UPDATED/DELETED) |
| B3-28 | GET /employees/:employeeId/payroll-inputs | PS:598 | Danh sách bộ tham số theo hiệu lực của NV | `hrm.payroll.configure` | R: payroll_employee_inputs | ui/payroll-inputs-panel:35 | hoàn chỉnh | |
| B3-29 | PATCH /employees/:employeeId/payroll-inputs/:date | PS:681 | Sửa bộ tham số (cần expectedUpdatedAt, lý do), `invalidatePayrollRange` | `hrm.payroll.configure` | R/W: payroll_employee_inputs, payroll_runs; W: audit_log (PAYROLL_INPUT_UPDATED) | panel:85 | hoàn chỉnh | |
| B3-30 | DELETE /employees/:employeeId/payroll-inputs/:date | PS:695 | Xóa bộ tham số | `hrm.payroll.configure` | như B3-29 (PAYROLL_INPUT_DELETED) | panel:85 | hoàn chỉnh | |
| B3-31 | POST /employees/:employeeId/payroll-inputs | PS:705 | Thêm bộ tham số mới (hiệu lực phải sau bộ đã lưu; chặn kỳ LOCKED/PAID; run chưa chốt->DRAFT) | `hrm.payroll.configure` | W: payroll_employee_inputs, payroll_runs | panel:96 | hoàn chỉnh một phần | KHÔNG audit tạo mới (sửa/xóa có) |
| B3-32 | GET /payroll-periods/:id/runs | PS:760 | Danh sách run của kỳ (id, run_no, status, updated_at) | `hrm.payroll.read` | R: payroll_runs | PAY:193 | hoàn chỉnh | Trả cột rút gọn, không cùng DTO với `mapRun` |
| B3-33 | GET /payroll-runs/:id/totals | PS:775 | Tổng hợp từng NV (`t.*` gồm beneficiary_snapshot, payment_status...) + tên/mã | `hrm.payroll.read` | R: payroll_employee_totals, employee_directory | PAY:204 | hoàn chỉnh | Lộ số TK ngân hàng cho ai có payroll.read; join directory làm biến mất NV đã xóa |
| B3-34 | POST /payroll-totals/:id/record-payment | PS:790 | Ghi nhận chi trả 1 NV: payment_status=PAID + reference + paid_at; chỉ khi run FINALIZED; khi tất cả total PAID thì kỳ -> PAID; advisory lock theo tenant; idempotent cùng reference | `hrm.payroll.pay` | R/W: payroll_employee_totals, payroll_periods(R:payroll_runs); W: audit_log (PAYROLL_PAYMENT_RECORDED) | PAY:706 | hoàn chỉnh một phần | KHÔNG gọi `assertPayrollSod(...,'pay')` (C-01); không cần phiếu đã phát hành/đã xuất; không có hoàn tác; không kiểm tra thông tin ngân hàng |

### A3. hrm-payroll-sod.controller.ts

| Mã | Endpoint | File:dòng | Hành vi thực | Quyền | Bảng | FE | Trạng thái | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| B3-35 | GET /payroll-sod-settings | SOD:17 | Trả `separateCalcFinalize`/`separateFinalizePublish`; nếu migration 0026 chưa chạy trả false + `enforced:false`; tenant chưa có dòng = BẬT cả hai | `hrm.payroll.read` | R: payroll_sod_settings | không thấy nơi gọi | hoàn chỉnh | Không có UI cấu hình SoD nào |
| B3-36 | PUT /payroll-sod-settings | SOD:36 | Upsert cấu hình SoD, ghi audit PAYROLL_SOD_CONFIGURED | `hrm.payroll.configure` | W: payroll_sod_settings, audit_log | không thấy nơi gọi | hoàn chỉnh | Người có `configure` tự tắt được SoD (có audit, không cần người thứ hai) |

### A4. hrm-salary.controller.ts (ngạch/bậc, hồ sơ lương, ứng lương)

| Mã | Endpoint | File:dòng | Hành vi thực | Quyền | Bảng | FE | Trạng thái | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| B3-37 | GET /salary-grades | SAL:68 | Ngạch chưa xóa mềm | `hrm.salary.read` | R: salary_grades | EMP:229; ui/personnel-decision-dialog:148 | hoàn chỉnh | |
| B3-38 | POST /salary-grades | SAL:87 | Tạo ngạch (code unique theo tenant, kể cả đã xóa mềm) | `hrm.salary.manage` | W: salary_grades, audit_log (SALARY_GRADE_CREATED) | EMP:368 | hoàn chỉnh | |
| B3-39 | PATCH /salary-grades/:id | SAL:135 | Sửa tên/mô tả/status, khóa lạc quan | `hrm.salary.manage` | W: salary_grades, audit_log | EMP:341; ui/hrm-lifecycle-actions:558 | hoàn chỉnh | |
| B3-40 | DELETE /salary-grades/:id | SAL:179 | Xóa mềm nếu không có bậc/hồ sơ lương/position_profiles tham chiếu | `hrm.salary.manage` | R: salary_grade_steps, employee_salary_profiles, position_profiles; W: salary_grades, audit_log | ui/hrm-lifecycle-actions:565 | hoàn chỉnh | |
| B3-41 | GET /salary-grades/:gradeId/steps | SAL:221 | Bậc chưa xóa của ngạch | `hrm.salary.read` | R: salary_grade_steps | EMP:244; personnel-decision-dialog:174 | hoàn chỉnh | |
| B3-42 | POST /salary-grades/:gradeId/steps | SAL:240 | Tạo bậc (min<=mid<=max, base trong khoảng, ngày hiệu lực) | `hrm.salary.manage` | W: salary_grade_steps | EMP:437 | hoàn chỉnh một phần | KHÔNG audit tạo bậc; trùng step_no -> vi phạm unique DB (không xử lý riêng) |
| B3-43 | PATCH /salary-grades/:gradeId/steps/:id | SAL:285 | Sửa bậc; nếu đã được hồ sơ lương dùng chỉ cho đổi status | `hrm.salary.manage` | W: salary_grade_steps, audit_log (SALARY_STEP_UPDATED); R: employee_salary_profiles | ui/hrm-lifecycle-actions:391 | hoàn chỉnh | |
| B3-44 | DELETE /salary-grades/:gradeId/steps/:id | SAL:354 | Xóa mềm bậc chưa dùng | `hrm.salary.manage` | như B3-43 (SALARY_STEP_DELETED) | hrm-lifecycle-actions:391 | hoàn chỉnh | |
| B3-45 | GET /employees/:employeeId/salary-profiles | SAL:432 | Lịch sử hồ sơ lương NV | `getRequestContext(..., 'hrm.salary.read','hrm.self.read')`: người có salary.read hoặc chính NV | R: employee_salary_profiles | không thấy nơi gọi | hoàn chỉnh | |
| B3-46 | GET /employees/:employeeId/salary-profiles/current | SAL:458 | Hồ sơ ACTIVE mới nhất (không xét ngày hiệu lực hôm nay) | như B3-45 | R: employee_salary_profiles | không thấy nơi gọi | hoàn chỉnh | Có thể trả hồ sơ tương lai |
| B3-47 | POST /employees/:employeeId/salary-profiles | SAL:487 | Tạo hồ sơ lương hiệu lực từ ngày X: chặn kỳ LOCKED/PAID có `to_date>=X`; đưa run chưa chốt về DRAFT; X phải sau mọi hồ sơ chưa CANCELLED; hồ sơ ACTIVE cũ -> SUPERSEDED, `effective_to=X-1`; chèn hồ sơ mới ACTIVE | `hrm.salary.manage` | R/W: employee_salary_profiles, payroll_runs; R: payroll_periods, salary_grades, salary_grade_steps | EMP:489; SET:671 | hoàn chỉnh một phần | KHÔNG audit, KHÔNG `approved_by`, không duyệt hai người; không đối chiếu `base_salary` với bậc; không có sửa/hủy hồ sơ (status CANCELLED không có đường ghi) |
| B3-48 | POST /salary-advance-requests | SAL:581 | Tạo đơn ứng PENDING (số tiền>0, 1-60 kỳ) qua `submitHrmRequest` (có thể kèm Procedure Engine) | `getRequestContext` (mặc định: hrm.request.manage cho đơn hộ, hoặc hrm.self.request) | W: salary_advance_requests, procedure_links (qua bridge), request drafts | ui/requests-screen:2506 | hoàn chỉnh | Không kiểm tra hạn mức/ nợ ứng hiện hữu/ nhân viên có lương |
| B3-49 | GET /salary-advance-requests | SAL:665 | Danh sách (lọc employee/status/forApproval/assignee/step); người không có `hrm.advance.read` chỉ thấy của mình | `ctx.scoped('hrm.advance.read')` | R: salary_advance_requests, employee_directory, procedure_links | ADV:83; requests-screen:1181; approvals-screen (path `salary-advance-requests`) | hoàn chỉnh | |
| B3-50 | POST /salary-advance-requests/:id/approve | SAL:725 | Duyệt (PENDING->APPROVED, `approved_amount`<=đề nghị), qua `approvals.assertCanDecide` (không tự duyệt, đúng phạm vi đơn vị, từ chối nếu đơn đang chạy Procedure) | `hrm.advance.approve` (+ phạm vi) | R/W: salary_advance_requests | approvals-screen (đường dẫn dựng `/${source.path}/${id}/approve`, dòng 366-371) | hoàn chỉnh | Không audit riêng |
| B3-51 | POST /salary-advance-requests/:id/reject | SAL:746 | PENDING->REJECTED | `hrm.advance.approve` + assertCanDecide | W: salary_advance_requests | approvals-screen (như trên) | hoàn chỉnh một phần | Bắt buộc `reason` nhưng KHÔNG lưu lý do (UPDATE không có cột lý do), không transaction, không audit, không cập nhật updated_at |
| B3-52 | POST /salary-advance-requests/:id/disburse | SAL:942 | Ghi nhận giải ngân: APPROVED->DISBURSED, `disbursed_amount`<=`approved_amount`, `remaining_balance`=số giải ngân | `hrm.advance.disburse` | W: salary_advance_requests | ADV:384 | hoàn chỉnh một phần | Chỉ ghi nhận số liệu (UI nói rõ không chuyển tiền); không audit, không mã chứng từ, không SoD với người duyệt/chủ đơn |
| B3-53 | POST /salary-advance-requests/:id/schedule | SAL:771 | Lập 1 đợt thu hồi vào 1 kỳ lương chưa khóa: yêu cầu DISBURSED, không trùng kỳ, không vượt số kỳ/dư nợ chưa dành; run chưa chốt của kỳ->DRAFT | `hrm.advance.disburse` | W: salary_advance_deductions, payroll_runs, audit_log (ADVANCE_RECOVERY_SCHEDULED) | ADV:422 | hoàn chỉnh | Lập thủ công từng đợt; không tự sinh lịch theo số kỳ |
| B3-54 | PATCH /salary-advance-deductions/:id | SAL:836 | Sửa số tiền đợt SCHEDULED của khoản đã DISBURSED, kỳ chưa khóa | `hrm.advance.disburse` | W: salary_advance_deductions, payroll_runs, audit_log (ADVANCE_RECOVERY_UPDATED) | ADV:143 | hoàn chỉnh | |
| B3-55 | POST /salary-advance-deductions/:id/cancel | SAL:847 | Hủy đợt SCHEDULED (dư nợ giữ nguyên) | `hrm.advance.disburse` | như B3-54 (ADVANCE_RECOVERY_CANCELLED) | ADV:143 | hoàn chỉnh | |
| B3-56 | GET /salary-advance-requests/:id/deductions | SAL:977 | Các đợt thu hồi của 1 đơn (kèm mã kỳ) | `ctx.scoped('hrm.advance.read')` | R: salary_advance_deductions, salary_advance_requests, payroll_periods | ADV:101 | hoàn chỉnh | |

Không có endpoint: approve/review/reject/reopen run lương, hủy phát hành phiếu lương, hoàn tác chi trả, sửa/hủy hồ sơ lương, hủy/xóa nợ ứng đã giải ngân, báo cáo lương tổng hợp. Tuyến liên quan nằm ngoài phạm vi nhưng ảnh hưởng lương: `POST /timesheet-periods/:id/lock|reopen` (hrm-timesheet.controller.ts:287,347), `dependents` (hrm-dependent.controller.ts), `leave-settlements` (hrm-leave-settlement.ts), personnel decisions (hrm-personnel-decisions.ts `applySalaryStep`), handler withdraw đơn (hrm-operations.controller.ts:195; đơn ứng chỉ rút được khi PENDING/PEER_CONFIRMED; method/path chưa đọc).

---------------------------------------------------------------------
## (B) Phân tích

### B1. Cấu hình lương vs tính lương

Cấu hình (PS + SAL + bảng policy):
- Công thức/tham số chung: `policy_versions.config_json` của policy_type 'PAYROLL' (components [{code,type,name,formula}], `inputs`, `salaryType` NET|GROSS, `standardMinutes`). Có phiên bản theo ngày hiệu lực, khóa lạc quan, chặn sửa/xóa phiên bản đã được payroll_items tham chiếu (PS:412-449 `assertUnusedConfiguration`), chặn đổi trong kỳ LOCKED/PAID (PS:359). Mỗi lần xuất bản/sửa/kết thúc cấu hình đều đưa run chưa chốt về DRAFT (PS:364; `invalidatePayrollRange`).
- OT: policy_type 'OT' (`POST /ot-configuration`), dùng ở bảng công; payroll chỉ nhận `OT_MINUTES`, `WEIGHTED_OT_MINUTES` từ timesheets.
- Tham số theo nhân viên: `payroll_employee_inputs(tenant, employee, effective_from, inputs)`. Không được trùng 16 biến hệ thống `payrollSystemInputs` (CALC:42-59; PS:47-63).
- Ngạch/bậc: `salary_grades`, `salary_grade_steps` (min/mid/max/base). Chỉ là danh mục tham chiếu: công thức và tính lương KHÔNG đọc bảng ngạch/bậc; mức lương thực tế lấy từ `employee_salary_profiles.base_salary`. Hồ sơ lương chỉ kiểm tra ngạch/bậc tồn tại và khớp nhau (SAL:531-546), không ép `base_salary` nằm trong khoảng min-max hay bằng `base_salary` của bậc. Ngạch còn gắn vào `position_profiles.salary_grade_id` (view employee_directory, 0002-employee-identity.sql:35-40): liên kết ngạch thứ hai (cấp chức danh) không tham gia tính lương.
- Thuế/bảo hiểm: KHÔNG có bảng thuế suất/bảo hiểm riêng; hoàn toàn là thành phần công thức kiểu STATUTORY_DEDUCTION/TAX_DEDUCTION do người dùng nhập (mẫu ở frontend hrm-payroll-config.ts, tất cả mức/tỷ lệ mặc định 0). `payroll_employee_totals.taxable_income` không bao giờ được ghi (INSERT ở CALC:324 không có cột này, luôn 0). Biến liên quan thuế do hệ thống cấp: `REGISTERED_DEPENDENT_COUNT`.
- Bộ máy công thức: `domain/payroll-formula.ts` (bộ phân tích riêng, fixed-point 6 chữ số, hàm MIN/MAX/ROUND/IF, phát hiện vòng tham chiếu và biến lạ kể cả nhánh IF không chạy). Dùng chung cho lưu cấu hình (validate với mọi biến hệ thống = 1), tính lương thật, và tính thử.

Tính lương (PC + CALC): sở hữu `payroll_periods`, `payroll_runs`, `payroll_items`, `payroll_employee_totals`, `payslips`; đọc cấu hình ở trên tại thời điểm tính. Tính thử (`POST /payroll-dry-run`) dùng cùng `evaluatePayroll` nhưng chỉ trên biến hệ thống đã snapshot của run đã tính, không ghi gì; kiểm tra NET_PAY, âm, ADVANCE_DUE giống bước thật (payroll-dry-run.ts:41-58).

### B2. Vòng đời lương như đã cài đặt

Trạng thái run theo code (PC, CALC):
```
 POST payroll-periods/:id/runs
        |
     [DRAFT] <---------------------------------------------+
        | POST calculate (calculatePayroll)                 |
        v                                                    |
   [CALCULATED] --(bất kỳ thay đổi đầu vào: adjustments,     |
        |          cấu hình, tham số NV, hồ sơ lương,        |
        |          phụ thuộc, lịch thu hồi ứng, reopen kỳ    |
        |          công, quyết định nhân sự áp lương)--------+
        | POST finalize (SoD: người chốt != người tính nếu bật)
        v
   [FINALIZED] -- (không có đường thoát: không hủy, không tính lại, không mở lại)
        | POST payslips/generate (SoD: người phát hành != người chốt nếu bật)
        v
   payslips PUBLISHED + outbox hrm.payslip.published
        | POST payroll-totals/:id/record-payment (từng NV; KHÔNG SoD)
        v
   total.payment_status=PAID ... tất cả PAID => payroll_periods.status='PAID'

   [DRAFT|CALCULATED] --POST runs/:id/cancel--> [CANCELLED]  (kỳ chưa LOCKED/PAID)
```
Trạng thái kỳ: `OPEN` -> `LOCKED` (khi finalize, PC:511) -> `PAID` (khi mọi total PAID, PS:826). `PROCESSING` có trong CHECK (0001-hrm.sql:494) nhưng không có đường ghi trong code đã đọc (chỉ được đọc ở hrm-leave-settlement.ts:383). UPDATE kỳ ở finalize/payment không cập nhật `updated_at`.

Chỉ có trong CHECK constraint/DTO, KHÔNG có code đặt: run `IN_REVIEW`, `APPROVED`, `REJECTED`; cột `reviewer_id`, `reviewed_at`, `review_notes`, `approved_by`, `approved_at`, `rejected_by`, `rejection_reason` (chỉ `mapRun` PC:917-937 đọc ra). Nhưng code vẫn có nhánh cho APPROVED: finalize chấp nhận `CALCULATED|APPROVED` (PC:469), calculate/adjust chặn APPROVED, UI `editable` loại APPROVED (PAY:~169), dry-run liệt kê APPROVED. Kết luận: bước "duyệt/rà soát" KHÔNG tồn tại; luồng thực tế = tính -> chốt -> phát hành -> chi trả. Payslip `GENERATED`, `VIEWED`, `DOWNLOADED` và `file_id`: không có code ghi (chỉ PUBLISHED); không có đánh dấu "đã xem" hay PDF. Total `payment_status='PAYMENT_QUEUED'`: không có code ghi. Advance deduction `SKIPPED`: không có code ghi. Advance request `CANCELLED`: chỉ qua rút đơn khi PENDING (hrm-operations.controller.ts:195-260).

Ai được làm bước nào (quyền + SoD):
| Bước | Quyền | SoD |
|---|---|---|
| Tạo/sửa/xóa kỳ, tạo run, tính, hủy run | `hrm.payroll.calculate` | không |
| Điều chỉnh khoản thủ công | `hrm.payroll.adjust` | không (người điều chỉnh không được ghi vào SoD) |
| Chốt | `hrm.payroll.finalize` | `separateCalcFinalize`: `finalized_by` phải khác `calculated_by` (người tính LẦN CUỐI; hrm-payroll-sod.ts:55-61) |
| Phát hành phiếu | `hrm.payroll.publish` | `separateFinalizePublish`: khác `finalized_by` (sod.ts:62-70) |
| Xuất CSV chi trả/đối soát | `hrm.payroll.export` | không |
| Ghi nhận chi trả | `hrm.payroll.pay` | KHÔNG gọi `assertPayrollSod(...,'pay')`: chỉ có 2 lời gọi, finalize (PC:473) và publish (PC:757). Bước 'pay' có định nghĩa + thông báo + unit test (hrm-payroll-sod.spec.ts) nhưng không nối vào endpoint |
| Cấu hình SoD | `hrm.payroll.configure` (PUT), `hrm.payroll.read` (GET) | không |

Quy tắc SoD: tenant chưa có dòng cấu hình = BẬT cả hai; tenant có dữ liệu trước migration 0026 được gán FALSE (0026-payroll-segregation-of-duties.sql). Nếu bảng/cột chưa tồn tại thì bỏ qua hoàn toàn (`payrollSodReady` truy vấn information_schema ở mọi lần gọi). Dữ liệu cũ thiếu `calculated_by`/`finalized_by` thì không chặn. Mẫu vai trò (hrm-role-templates.ts:96-133): `comp-ben` có calculate+adjust+configure; `payroll-approver` có finalize+publish (cùng một vai trò nhưng SoD vẫn tách theo người); `payroll-accountant` có export+pay+advance.disburse. Đường vòng: `hrm.manage`/`tenant.manage` bao hết mọi quyền (chỉ SoD theo danh tính chặn được); tenant chỉ có 1 người sẽ không chốt được khi SoD bật (phải tắt qua PUT).

### B3. Đầu vào từ chấm công/nghỉ phép/OT và từ lương

Điều kiện kỳ công: tạo kỳ lương yêu cầu `timesheet_periods.status='LOCKED'` và `from_date/to_date` trùng khớp (PC:205-225); `calculate` yêu cầu kỳ công LOCKED (CALC:76); `finalize` kiểm tra lại LOCKED (PC:480-487). Mở lại kỳ công (hrm-timesheet.controller.ts:347-410) bị chặn nếu có run FINALIZED, còn lại đưa mọi run không CANCELLED về DRAFT (không xóa `calculated_at`). Khóa kỳ công (hrm-timesheet.controller.ts:287-345) yêu cầu kỳ đã kết thúc, có dữ liệu, đã tính, không còn dòng ABNORMAL, không còn đơn PENDING trong kỳ; bản thân payroll không lọc theo trạng thái dòng công (CALC:130-133).

Tập nhân viên được tính: `SELECT DISTINCT employee_id FROM timesheets WHERE period_id=...` (CALC:80-83), không xét trạng thái nhân sự; NV không có dòng công trong kỳ bị bỏ qua im lặng. NV vào giữa kỳ (`join_date > from`) yêu cầu `config.standardMinutes`.

Trường lấy từ `hrm_schema.timesheets` (tổng theo kỳ, CALC:138-236): `scheduled_minutes` (->SCHEDULED_MINUTES, mẫu số trọng số lương; =0 thì lỗi), `paid_minutes` (->PAID_MINUTES; dùng trong PRORATED_BASE_PAY), `worked_minutes`, `ot_minutes`, `calculation_snapshot.weightedOtMinutes` (->WEIGHTED_OT_MINUTES), `late_minutes`, `early_leave_minutes` (->LATE_MINUTES/EARLY_MINUTES), `workday_units` (->WORKDAY_UNITS). Nghỉ phép có lương nằm trong `paid_minutes` do bước tính bảng công (hrm-timesheet-calculation.ts:104,154 lấy `leave_request_days.paid_minutes`); payroll không đọc trực tiếp leave_requests hay ot_requests. Hệ số OT đã nằm trong `weightedOtMinutes` (timesheet-calculation:150). Đi muộn/về sớm chỉ là biến; việc trừ tiền do công thức quyết định.

Trường lấy từ nguồn khác: `BASE_SALARY` (bình quân lương theo trọng số `scheduled_minutes` từng ngày), `PRORATED_BASE_PAY` (tổng `base_salary_ngày * paid_minutes_ngày / standardMinutes`, `standardMinutes` = config hoặc tổng scheduled) - CALC:152-178; `ADVANCE_DUE` (lịch thu hồi SCHEDULED của kỳ, CALC:179-182); `MANUAL_EARNINGS/MANUAL_DEDUCTIONS` (payroll_items MANUAL_ADJUSTMENT của chính run, CALC:183-186, 238-245); `LEAVE_RECOVERY_DUE` (leave_settlements SCHEDULED của kỳ, cộng thêm vào MANUAL_DEDUCTIONS, CALC:188-198); `REGISTERED_DEPENDENT_COUNT` (employee_dependents hiệu lực tại `to_date`, CALC:205-208).

Lương có hiệu lực theo thời gian? CÓ: `employee_salary_profiles` (effective_from/effective_to, status ACTIVE/SUPERSEDED/CANCELLED). Tạo hồ sơ mới không ghi đè mà đóng hồ sơ ACTIVE cũ (`effective_to = X-1`, SUPERSEDED) và chèn dòng mới (SAL:547-569); X phải sau mọi hồ sơ chưa CANCELLED và không rơi vào kỳ LOCKED/PAID (SAL:513-530). Thay đổi giữa kỳ: tính theo NGÀY - mỗi ngày công có `scheduled_minutes>0` phải khớp ĐÚNG 1 hồ sơ (0 hoặc >1 -> lỗi "Hồ sơ lương bị thiếu/trùng", CALC:160-163), đồng thời kiểm tra currency='VND' và `salaryType` hồ sơ == `config.salaryType`. Lương mỗi ngày là của hồ sơ hiệu lực ngày đó nên đổi lương giữa kỳ được chia đúng. Không có đường sửa/hủy hồ sơ lương sai (không PATCH/DELETE; CANCELLED không được ghi). Còn có `employment_contracts.base_salary` (hrm-contracts.ts) là nguồn lương thứ hai KHÔNG được payroll dùng. Đường thay đổi lương thứ hai: quyết định nhân sự (hrm-personnel-decisions.ts `applySalaryStep`, ghi `approved_by`), cùng guard kỳ khóa.

Chính sách tại thời điểm tính: `resolvePolicy('PAYROLL', from)` và `(…, to)`; dùng bản của NGÀY CUỐI kỳ (`endPolicy || policy`, CALC:102) cho cả kỳ - không chia kỳ theo 2 phiên bản. Tham số cá nhân lấy bộ có `effective_from <= from` (đầu kỳ, CALC:116-119): thay đổi giữa kỳ chỉ có hiệu lực từ kỳ sau.

Snapshot để kỳ đã chốt không đổi:
- `payroll_items.calculation_snapshot` (nguồn FORMULA): `formula`, toàn bộ `inputs` (biến hệ thống + tham số chung + tham số cá nhân), `components` đã tính, `dependentIds`, `dependentCutoff`; `policy_version_id` = phiên bản dùng (CALC:286-306). Phiên bản đã được tham chiếu không sửa/xóa được (PS:412-431).
- `payroll_employee_totals.beneficiary_snapshot`: mã NV, tên, ngân hàng/chi nhánh/số TK tại thời điểm tính (CALC:209-214, 337).
- `payslips.snapshot_json`: bản sao `total` + `items` + `salaryProfiles` giao với kỳ + thông tin kỳ, tạo lúc phát hành (PC:802-833).
- Dòng công không được snapshot nhưng bị khóa gián tiếp: kỳ công không mở lại được khi có run FINALIZED. Hồ sơ lương/chính sách/tham số/phụ thuộc/lịch thu hồi bị chặn thay đổi khi kỳ LOCKED/PAID hoặc run FINALIZED (SAL:517, PS:359/724, hrm-payroll-lifecycle.ts:21-27, hrm-dependent.controller.ts:34-37, SAL:782-789). Không có trigger DB bảo vệ dữ liệu đã chốt (grep migrations: không trigger trên payroll_*); khóa hoàn toàn ở tầng ứng dụng.
- Thiếu: tên/mã NV trên payslip lấy từ directory tại lúc phát hành chứ không phải lúc tính (beneficiary_snapshot có tên nhưng payslip dùng bản `total` kèm `full_name` join lúc phát hành, PC:765-772).

### B4. Ứng lương đầu-cuối

1. Đề nghị: `POST /salary-advance-requests` (PENDING, `approved_amount=0`, `remaining_balance=0`), có thể đi theo Procedure Engine (procedure_links).
2. Duyệt: `POST .../approve` -> `approveSalaryAdvance` (hrm-request-transition.ts:226-261): PENDING->APPROVED, `approved_amount`<=`requested_amount`; hoặc PE đồng bộ kết quả qua `applyHrmRequestResult` (cùng hàm). Từ chối: `.../reject`: lý do không được lưu, không audit. Chính sách duyệt: không tự duyệt, đúng phạm vi đơn vị (hrm-approval-policy.ts:110-152).
3. Giải ngân: `POST .../disburse` (`hrm.advance.disburse`): APPROVED->DISBURSED, `disbursed_amount`, `remaining_balance=disbursed_amount`. Chỉ ghi nhận sổ; không chứng từ/bank ref, không audit, không transaction; không SoD (người có disburse giải ngân được đơn của chính mình hoặc đơn mình duyệt).
4. Lập lịch thu hồi: `POST .../schedule` (DISBURSED; một đợt/kỳ; số đợt <= `number_of_installments`; tổng đang dành <= `remaining_balance`) -> `salary_advance_deductions` SCHEDULED; run chưa chốt của kỳ về DRAFT; sửa/hủy đợt: B3-54/55.
5. Vào bảng lương: `calculatePayroll` đọc tổng SCHEDULED của NV trong kỳ -> `ADVANCE_DUE`; bắt buộc tổng thành phần `ADVANCE_DEDUCTION` trong công thức == `ADVANCE_DUE` (CALC:280-285), không thành phần nào âm (CALC:255-264).
6. Ghi nợ: chỉ ở `finalize` (PC:488-503): trừ `remaining_balance`, cộng `total_deducted_amount`, đặt `REPAID` khi hết nợ (chỉ khi `remaining_balance == số trừ`), deduction -> DEDUCTED (`actual_deducted_amount = scheduled_amount`, `payroll_run_id`, `deducted_at`).
7. Chi trả lương ròng: net đã trừ ứng; không có liên kết giữa giải ngân ứng và lương (không sổ/đối soát).
Lỗ hổng: (a) finalize xử lý TẤT CẢ lịch SCHEDULED của kỳ (query theo `payroll_period_id`, không theo NV có trong run), trong khi calculate chỉ gồm NV có dòng công, nên NV không có bảng công vẫn bị đánh DEDUCTED/giảm nợ dù không có khoản trừ nào trong lương (PC:488-491 so với CALC:80-83); (b) không có đường hủy/xóa nợ cho NV nghỉ việc hoặc ngưng thu hồi khoản DISBURSED; (c) `REPAID` so khớp số tiền chính xác.

### B5. Phiếu lương (self-service) vs màn hình quản lý lương

Cùng dữ liệu, tên khác: quản lý xem `payroll_employee_totals` (`GET /payroll-runs/:id/totals`) + `payroll_items` (`GET .../items`) trực tiếp (sống); NV xem `payslips.snapshot_json` (`GET /my-payslips`) là bản sao đóng băng của đúng hai bảng đó ở thời điểm phát hành, thêm thông tin kỳ và `salaryProfiles`. Sau khi chốt hai bên giống nhau vì run FINALIZED bất biến. Quản lý cũng có `GET /payroll-runs/:runId/payslips` (không UI gọi). Lưu ý: snapshot gửi cho NV chứa nguyên `total` (kể cả `beneficiary_snapshot` với số TK) và `calculation_snapshot` (toàn bộ biến và công thức) của từng khoản; toàn bộ chi tiết đó cũng lộ cho người chỉ có `hrm.payroll.read`. Excel `exportPayrollToExcel` ở frontend (PAY:54-122) tạo phía trình duyệt từ dữ liệu totals/items: quyền xuất chỉ chặn ở UI (backend chỉ cần payroll.read), không audit, và gán nhãn "Khấu trừ" cho mọi loại khác EARNING (ALLOWANCE/OVERTIME/NET_PAY).
Phiếu không thu hồi/sửa được; phát hành lại chỉ bù NV chưa có phiếu (PC:783-787); không có UNIQUE(payroll_run_id, employee_id) trong DB (0001-hrm.sql:564-578), chỉ dựa vào khóa dòng run.

### B6. Điều chỉnh, tính lại sau chốt, mở lại

- Điều chỉnh thủ công: chỉ EARNING hoặc OTHER_DEDUCTION, >=0, trên run chưa APPROVED/FINALIZED/CANCELLED và kỳ chưa khóa; đặt run về DRAFT (phải tính lại); sửa/xóa có audit before/after, thêm mới không audit (PC:549-634). `operationId` chống trùng. Số điều chỉnh vào `MANUAL_EARNINGS/DEDUCTIONS`; công thức NET_PAY phải tham chiếu chúng, nếu không `gross - deduction != net` thì tính lỗi (CALC:276-279). Khoản thủ công của NV không có trong bảng công không bao giờ được tính (C-05).
- Sau khi chốt: KHÔNG có tính lại, mở lại, bù lương hay run bổ sung: calculate/adjust/cancel đều chặn FINALIZED (CALC:72; PC:599, 685, 362); reopen kỳ công bị chặn (hrm-timesheet.controller.ts:370-378); thay đổi chính sách/lương/tham số/phụ thuộc/lịch thu hồi trong kỳ khóa bị từ chối kèm thông điệp "ghi nhận thay đổi ở kỳ sau" (hrm-payroll-lifecycle.ts:21-27). Cách sửa sai duy nhất: nhập khoản điều chỉnh thủ công vào run kỳ sau; không có liên kết khoản điều chỉnh với kỳ gốc.
- Trước chốt, mọi đầu vào thay đổi đều đưa run về DRAFT: cấu hình, tham số NV, hồ sơ lương, phụ thuộc, lịch thu hồi ứng, mở lại kỳ công, quyết định nhân sự. Ngoại lệ: `scheduleSettlement`/`waiveSettlement` (hrm-leave-settlement.ts:360-430) KHÔNG đưa run về DRAFT (C-04).
- Locking: calculate/finalize/adjust/cancel dùng `FOR UPDATE` trên kỳ và run cùng thứ tự (kỳ trước, run sau); lập lịch thu hồi cũng khóa kỳ trước. Run khác của cùng kỳ (tạo trước khi chốt) vẫn tính lại được sau khi kỳ LOCKED vì calculate không kiểm tra trạng thái kỳ (CALC:72-77), nhưng không finalize được vì đã có run FINALIZED (PC:474-479): thành run mồ côi.

### B7. Báo cáo/xuất

Không có endpoint báo cáo lương tổng hợp riêng. Có: `GET /payroll-runs/:runId/export?kind=payments|reconciliation` (CSV, chỉ run đã chốt, audit PAYROLL_EXPORT, chống CSV injection), `GET /payroll-runs/:id/totals` + `/items` (dữ liệu UI), Excel xuất phía frontend, và dashboard `currentPayrollPeriod` (hrm-dashboard.controller.ts:208; hrm-employee.controller.ts:208 cũng đọc kỳ lương mới nhất - ngoài phạm vi). Không có bảng kê tổng hợp cho kế toán (BHXH/thuế) và không có bảng kê giải ngân ứng.

---------------------------------------------------------------------
## (C) Vấn đề / rủi ro (mức: C=cao, T=trung bình, Th=thấp)

| Mã | Mức | Vấn đề | Bằng chứng |
|---|---|---|---|
| C-01 | C | SoD không áp cho bước chi trả: người chốt có thể tự ghi nhận chi trả dù thông báo/cấu hình mô tả "ghi nhận chi trả phải khác người chốt"; chi trả cũng không đòi phiếu đã phát hành | PS:790-832 không gọi `assertPayrollSod`; sod.ts:62-70 có nhánh 'pay' nhưng chỉ PC:473, PC:757 gọi |
| C-02 | C | Không có bước duyệt/rà soát: `IN_REVIEW/APPROVED/REJECTED` và 7 cột reviewer/approver chỉ có trong schema/DTO; chốt chỉ cần CALCULATED và 1 người khác người tính | 0020-payroll-lifecycle.sql:7, 0001-hrm.sql:501-520; không UPDATE nào đặt các trạng thái này; PC:917-937 chỉ đọc |
| C-03 | C | Finalize trừ nợ ứng cho mọi lịch SCHEDULED của kỳ, kể cả NV không nằm trong run; `actual_deducted_amount` luôn = scheduled, không đối chiếu khoản thực trừ trong payroll_items | PC:488-503 vs CALC:80-83 |
| C-04 | T | Đổi/miễn quyết toán phép sau khi run CALCULATED không vô hiệu hóa run: khoản đã vào payroll_items vẫn bị trừ dù miễn sau; khoản thêm sau không có trong lương | hrm-leave-settlement.ts:360-430 (không UPDATE payroll_runs) so với PC:505-510 |
| C-05 | T | Điều chỉnh thủ công chỉ cần NV tồn tại trong employee_profiles, không cần có trong run; khoản của NV ngoài run nằm ở payroll_items (hiện ở xuất đối soát) nhưng không vào totals/phiếu | PC:602-607 vs CALC:80-83, PC:788 |
| C-06 | T | Thiếu audit ở thao tác trọng yếu: tạo kỳ, tạo run, calculate, finalize, phát hành phiếu, thêm điều chỉnh, tạo tham số NV, tạo bậc lương, tạo hồ sơ lương, giải ngân ứng, duyệt/từ chối ứng (reject còn mất lý do) | PC:191-245, 386-409, 434-452, 454-524, 549-634, 736-862; PS:705-759; SAL:240-283, 487-575, 725-770, 942-975 |
| C-07 | T | Hồ sơ lương đổi trực tiếp bởi 1 người có `hrm.salary.manage`, không duyệt, `approved_by` không ghi, không audit; đường quyết định nhân sự mới có duyệt. Không sửa/hủy được hồ sơ sai; `base_salary` không ràng buộc với bậc | SAL:487-575; hrm-personnel-decisions.ts `applySalaryStep` |
| C-08 | T | `hrm.payroll.read` xem được lương/biến/số TK ngân hàng/nội dung phiếu của mọi NV (items, totals, payslips) không cần `hrm.salary.read`; mọi `hrm.payroll.*` tự kéo theo payroll.read | PC:530-547, 882-899; PS:775-789; tenant-authorization.ts:499-500 |
| C-09 | T | Xuất chi trả bị khóa vĩnh viễn nếu 1 NV thiếu thông tin ngân hàng trong snapshot, vì run FINALIZED không tính lại được dù thông báo nói "tính lại trước khi chốt"; chốt không kiểm tra điều kiện này | PC:85-94, CALC:72, PC:469 |
| C-10 | T | Không ràng buộc 1 kỳ công <-> 1 kỳ lương, không chống chồng lấn ngày giữa các kỳ lương (chỉ unique mã kỳ); nguy cơ chi trả/thu hồi ứng đôi | PC:227-240; 0001-hrm.sql:486-499 (FK + unique(tenant,code)); không migration bổ sung |
| C-11 | T | Cấu hình dùng bản của ngày CUỐI kỳ cho cả kỳ; tham số cá nhân theo đầu kỳ | CALC:96-102, 116-119 |
| C-12 | T | Tính lương all-or-nothing; lỗi thiếu định mức/hồ sơ lương dùng employeeId thô; NV không có dòng công bị loại im lặng, không cảnh báo | CALC:141-144, 160-163, 80-84 |
| C-13 | T | Ứng lương: không SoD (người duyệt/chủ đơn/người giải ngân), giải ngân không audit/không mã chứng từ/không transaction; không hạn mức hay kiểm tra dư nợ hiện hữu; không có đường hủy nợ cho NV nghỉ việc; `reject` mất lý do | SAL:581-663, 746-770, 942-975 |
| C-14 | Th | `taxable_income` không bao giờ được ghi; `PROCESSING`, `PAYMENT_QUEUED`, `SKIPPED`, payslip `VIEWED/DOWNLOADED/GENERATED`, `file_id` không có code ghi | CALC:324; 0001-hrm.sql:494,552-554,576 |
| C-15 | Th | Nhãn audit `PAYROLL_CONFIGURATION_ENDED` không có trong bảng nhãn; `payroll_periods.updated_at` không cập nhật khi LOCKED/PAID; `calculated_at` không xóa khi reopen kỳ công | hrm-audit-trail.ts:95-99; PC:511; hrm-timesheet.controller.ts:393 |
| C-16 | Th | `HrmAccessGuard` mặc định `audit`: nếu bật `enforce`, các route lương không có `@RequirePermission` (hầu hết) sẽ 403; hiện phân quyền dựa hoàn toàn vào `getContext` trong từng handler | hrm-access.guard.ts:62-68; PS, SAL và 14/17 route PC không có decorator |
| C-17 | Th | `resolveEmployee` tự tạo `employee_profiles` với `join_date=CURRENT_DATE` khi thiếu hồ sơ (kể cả khi gọi `GET /my-payslips`), có thể tạo NV "vào giữa kỳ" làm tính lương đòi `standardMinutes` | hrm-context.service.ts:44-65 |
| C-18 | Th | Frontend: Excel xuất ở trình duyệt không qua endpoint xuất/audit; gán nhãn "Khấu trừ" sai cho ALLOWANCE/OVERTIME/NET_PAY; SoD không có UI | PAY:54-122; grep 'sod' trong features/hrm/src không có kết quả |
| C-19 | Th | `payrollSodReady` truy vấn information_schema ở mỗi lần gọi finalize/publish/GET SoD; list không phân trang | hrm-payroll-sod.ts:23-29; PC:172-189 |
| C-20 | Th | Endpoint không thấy nơi gọi (không kết luận là mã chết): B3-08, B3-17, B3-35, B3-36, B3-45, B3-46 | grep `packages/features/hrm/src` và `apps/` |

Lưu ý chưa xác minh: bộ lọc lỗi DB toàn cục (vi phạm unique -> mã HTTP), cấu hình `HRM_ACCESS_GUARD_MODE` ở nơi triển khai, việc tenant thực tế đã bật SoD hay chưa, hành vi chi tiết của `hrm-request-reversal.ts:74` (chỉ đọc truy vấn chặn kỳ khóa), method/path handler withdraw. Không chạy test/DB/build theo yêu cầu.

---------------------------------------------------------------------
## (D) Bảng dữ liệu liên quan (hrm_schema, trừ khi ghi khác)

| Bảng | Vai trò | Ghi bởi | Ghi chú |
|---|---|---|---|
| policies, policy_versions | Cấu hình công thức PAYROLL/OT (config_json, hiệu lực) | PS (save/patch/delete/deactivate) | `used` kiểm bằng payroll_items.policy_version_id |
| payroll_employee_inputs | Tham số lương theo NV theo ngày hiệu lực | PS inputs endpoints | PK (tenant, employee, effective_from) |
| salary_grades, salary_grade_steps | Danh mục ngạch/bậc (xóa mềm) | SAL | Không tham gia tính lương |
| employee_salary_profiles | Lương theo ngày hiệu lực (NET/GROSS, VND) | SAL:487; personnel decisions | Nguồn lương duy nhất của payroll |
| employment_contracts.base_salary | Lương theo hợp đồng | contract controller (ngoài phạm vi) | Payroll không dùng |
| payroll_periods | Kỳ lương OPEN/LOCKED/PAID, liên kết `timesheet_period_id` | PC, PS:826 | unique (tenant, period_code) |
| payroll_runs | Lần tính; calculated_by/published_by/finalized_by, cancel_*; reviewer/approver chưa dùng | PC, CALC, invalidators | unique (period, run_no) |
| payroll_items | Từng khoản (FORMULA/MANUAL_ADJUSTMENT/LEAVE_RECOVERY), calculation_snapshot, policy_version_id | CALC, PC | Không unique (run, employee, item_code) |
| payroll_employee_totals | Tổng/NV, beneficiary_snapshot, payment_status/reference/paid_at | CALC, PS:790 | `taxable_income` luôn 0 |
| payslips | Phiếu lương (snapshot_json) | PC:736 | Không unique (run, employee) |
| payroll_sod_settings | Cấu hình SoD theo tenant | SOD | migration 0026 |
| salary_advance_requests, salary_advance_deductions | Đơn ứng, dư nợ, lịch thu hồi | SAL, PC:488-503, hrm-request-transition.ts | CHECK trạng thái 0011 |
| leave_settlements | Thu hồi phép dùng vượt (SCHEDULED->DEDUCTED) | hrm-leave-settlement.ts, PC:505 | 0033 |
| employee_dependents | Người phụ thuộc cho thuế | hrm-dependent.controller.ts | Chỉ đếm vào REGISTERED_DEPENDENT_COUNT |
| timesheet_periods, timesheets | Đầu vào chấm công | timesheet controller | Đọc bởi CALC |
| employee_profiles, employee_directory (view) | Tồn tại NV, join_date, ngân hàng | employee controller | |
| audit_log | Nhật ký PAYROLL_*, SALARY_*, ADVANCE_RECOVERY_* | lifecycleAudit và INSERT trực tiếp | entity_type chỉ dùng ở export |
| integration_schema.outbox_events | Sự kiện `hrm.payslip.published` | PC:845 | |

Tệp chính đã đọc: hrm-payroll.controller.ts, hrm-payroll-settings.controller.ts, hrm-payroll-sod.controller.ts, hrm-salary.controller.ts, hrm-payroll-calculation.ts, hrm-payroll-lifecycle.ts, hrm-payroll-sod.ts, payroll-formula.ts, payroll-dry-run.ts, hrm-request-transition.ts (226-340), hrm-lifecycle.ts, hrm-access.guard.ts, hrm-context.service.ts, hrm-approval-policy.ts (1-170), hrm-policy-versions.ts (220-400), hrm-timesheet.controller.ts (287-420), hrm-leave-settlement.ts (355-440), hrm-personnel-decisions.ts (925-980), migrations 0001/0003/0006/0011/0013/0016/0020/0026, hrm-role-templates.ts, tenant-authorization.ts; frontend payroll-screen, payroll-settings-screen, advances-screen, payslips-screen, approvals-screen, hrm-payroll-config.ts.
