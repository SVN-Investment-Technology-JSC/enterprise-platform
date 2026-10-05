# Báo cáo thực hiện triển khai và nghiệm thu kỹ thuật HRM_FIX_05

**Thời gian thực hiện**: 05/10/2026  
**Mục tiêu**: Hoàn tất 5 bước triển khai kỹ thuật cho HRM_FIX_05 (Migration, Build & Restart dịch vụ, Seed vai trò mẫu, Chạy Integration Spec trên DB thật, Sẵn sàng UAT).

---

## 1. Chạy Migrator cho các migration tenant HRM (0021 - 0030)
- **Lệnh thực hiện**: `pnpm db:provision` (`nx run migrator:serve:development --watch=false --inspect=false`)
- **Kết quả áp dụng trên các tenant active (`savina`, `qa03`)**:
  - `0027-hrm-default-direct-bindings.sql`: Tạo 7 cấu hình mặc định chế độ `DIRECT` cho các loại đơn nếu chưa có binding.
  - `0028-hrm-approval-policy.sql`: Tạo bảng `hrm_schema.approval_policy_settings` cấu hình chính sách duyệt (mặc định chặn tự duyệt).
  - `0029-hrm-procedure-step-progress.sql`: Bổ sung các cột lưu tiến độ bước quy trình (`current_step_name`, `current_assignee_name`, `workflow_status`, `procedure_instance_id`, `procedure_step_inbox`).
  - `0030-hrm-procedure-field-mappings.sql`: Bổ sung bảng ánh xạ trường `hrm_schema.request_procedure_field_mappings` và seed ánh xạ trường mặc định cho các binding `PROCEDURE`.
- **Trạng thái**: Áp dụng thành công, kết thúc mã `0`.

---

## 2. Build lại và Khởi động lại `procedure-api`, `hrm-api` và `worker`
- **Build bằng Nx**:
  - Lệnh: `pnpm nx run-many -t build -p procedure-api hrm-api worker`
  - Kết quả: Thành công 3/3 ứng dụng (đầy đủ các hợp đồng mới, cờ `autoCompleteInitiatorStep`, endpoint nội bộ `/v1/internal/*` của PE và handler tiêu thụ sự kiện `procedure.instance.step_changed` của worker).
- **Khởi động lại**:
  - Đã dừng các tiến trình chạy code cũ: `procedure-api` (port 3334), `hrm-api` (port 3339), `worker`.
  - Khởi động lại service bằng executor development/background.
  - Kiểm tra trạng thái sức khỏe qua `node tools/dev-health.mjs` và các endpoint `/health/live`:
    - `Procedure API · live`: HTTP 200 OK (port 3334).
    - `HRM API · live`: HTTP 200 OK (port 3339).
    - `Worker`: Đang lắng nghe hàng đợi `hrm.integrations.v1` với các binding sự kiện mới.

---

## 3. Tạo lại Bộ vai trò mẫu HRM có quyền duyệt toàn tenant
- **Thực hiện**: Chạy script tạo/cập nhật vai trò mẫu idempotently qua `scripts/seed-hrm-roles.mjs` (bám sát cấu hình `HRM_ROLE_TEMPLATES` từ `contracts-identity`).
- **Chi tiết các quyền duyệt toàn tenant bổ sung**:
  - `hrm.profile.approve.all` cho vai trò `HRM - Nhân sự (hồ sơ)` và `HRM - Trưởng phòng nhân sự`.
  - `hrm.attendance.approve.all` cho vai trò `HRM - Chấm công viên` và `HRM - Trưởng phòng nhân sự`.
  - `hrm.salary.advance.approve.all` cho vai trò `HRM - Người chốt lương` và `HRM - Trưởng phòng nhân sự`.
  - Toàn bộ 7 quyền `hrm.*.approve.all` cho vai trò `HRM - Trưởng phòng nhân sự`.
- **Kết quả áp dụng**:
  - Database `savina`: Cập nhật thành công 10 vai trò.
  - Database `qa03`: Cập nhật thành công 8 vai trò.

---

## 4. Chạy Toàn bộ Bộ kiểm thử Tích hợp với `HRM_TEST_ADMIN_URL`
- **Cấu hình môi trường**:
  ```bash
  $env:HRM_TEST_ADMIN_URL='postgresql://tenant:tenant@localhost:55436/postgres'
  ```
- **Các điểm lệch trên SQL/DB thật đã được phát hiện và xử lý**:
  1. [`hrm-procedure-links.integration.spec.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/infrastructure/hrm-procedure-links.integration.spec.ts):
     - Bổ sung chuỗi migration còn thiếu trong `beforeAll` (`0015-hrm-procedure-sync.sql` đến `0028-hrm-approval-policy.sql`) để bảng `procedure_links` và các cột mới tồn tại trước khi chạy test.
     - Xử lý khôi phục an toàn `fetchSpy?.mockRestore?.()`.
  2. [`hrm-operations.integration.spec.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-operations.integration.spec.ts):
     - Bổ sung phương thức `procedureAvailable: async () => true` vào mock `HrmContextService` để đáp ứng controller `GET /operations`.
  3. [`hrm-request-lifecycle.integration.spec.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-request-lifecycle.integration.spec.ts):
     - Cập nhật test case sửa đổi đơn (`amendLeaveRequest`): Trước đây test kỳ vọng lỗi khi không có binding, nay hệ thống mặc định về `DIRECT`. Đã cập nhật tạo cấu hình `CONFLICT` để kiểm tra đúng hành vi từ chối `409` khi cấu hình xung đột.
  4. [`hrm-employee.controller.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-employee.controller.ts):
     - Sửa lỗi truy vấn cột `e.employee_code` thành `ep.employee_code` trong câu SELECT phụ trợ `getMyProfile` (cột `employee_code` thuộc bảng `hrm_schema.employee_profiles`, không nằm trong `core_schema.employees`).
  5. [`hrm-employee.integration.spec.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-employee.integration.spec.ts):
     - Gán `user_id` khi tạo employee trong test luồng lương/tạm ứng để kích hoạt đúng điều kiện chặn tự duyệt `SELF_APPROVAL_FORBIDDEN`.
  6. [`hrm-time-lifecycle.integration.spec.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-time-lifecycle.integration.spec.ts):
     - Bổ sung trường bắt buộc `reason` trong 2 lời gọi `settings.policy(...)` theo đúng validation quy định mới.

- **Kết quả kiểm thử toàn diện**:
  - Lệnh: `pnpm --filter @enterprise-platform/module-hrm exec jest --testPathPatterns="integration"`
  - **10/10 test suites PASS**, **105/105 tests PASS** 100%:
    - `hrm-procedure-links.integration.spec.ts`: PASS
    - `hrm-operations.integration.spec.ts`: PASS
    - `hrm-request-lifecycle.integration.spec.ts`: PASS
    - `hrm-employee.integration.spec.ts`: PASS
    - `hrm-time-lifecycle.integration.spec.ts`: PASS
    - `hrm-timesheet-lifecycle.integration.spec.ts`: PASS
    - `hrm-payroll-lifecycle.integration.spec.ts`: PASS
    - `hrm-catalog-lifecycle.integration.spec.ts`: PASS
    - `hrm-family-contract.integration.spec.ts`: PASS
    - `hrm-migrations.integration.spec.ts`: PASS

---

## 5. Sẵn sàng thực hiện UAT và Tài liệu Tham chiếu
Hệ thống hiện tại đã ở trạng thái ổn định và sẵn sàng cho đợt nghiệm thu theo tài liệu:
1. **Kịch bản UAT chi tiết**: [`docs/hrm-fix-plan/HRM_FIX_05_UAT.md`](file:///d:/CRM/enterprise-platform/docs/hrm-fix-plan/HRM_FIX_05_UAT.md)
   - 17 kịch bản chính cho 7 loại đơn ở cả 2 chế độ `DIRECT` và `PROCEDURE`.
   - 6 điểm kiểm tra bắt buộc cho chế độ PROCEDURE (K1 - K6).
   - 9 kịch bản lỗi và kiểm soát (E1 - E9: tự duyệt, ngoài phạm vi, PE gián đoạn, thiếu thuộc tính bước S...).
2. **Hướng dẫn quản trị**: [`docs/hrm-fix-plan/HRM_FIX_05_ADMIN_GUIDE.md`](file:///d:/CRM/enterprise-platform/docs/hrm-fix-plan/HRM_FIX_05_ADMIN_GUIDE.md)
   - Cấu hình binding quy trình và ánh xạ trường cho từng loại đơn.
   - Quản lý trạng thái liên kết và xử lý cảnh báo/mã lỗi.
