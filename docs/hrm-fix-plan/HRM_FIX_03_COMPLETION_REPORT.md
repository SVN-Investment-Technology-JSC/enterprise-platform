# Báo Cáo Tổng Hợp Xử Lý Lỗi Hệ Thống & Chuẩn Bị UAT (HRM_FIX_03)

**Ngày thực hiện:** 05/10/2026  
**Môi trường:** Tenant `savina` (Local Development)

---

## I. Xử lý sự cố kỹ thuật (502 Bad Gateway & ECONNREFUSED)

### 1. Hiện tượng ban đầu
- Trình duyệt gặp lỗi khi gọi API:
  `POST http://localhost:8080/api/auth/v1/login 502 (Bad Gateway)`.
- Terminal chạy `pnpm dev` gặp hàng loạt lỗi `ECONNREFUSED` tại cổng `3333` (`Platform API`) và `3339` (`HRM API`).

### 2. Nguyên nhân gốc
- **Lỗi TypeScript TS6133 (`noUnusedLocals`)**:
  - Tại file [`hrm-payroll-settings.controller.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-payroll-settings.controller.ts): File bị xung đột code/merge dở dang khiến xuất hiện khai báo thừa không sử dụng.
  - Tại file [`module-shell.tsx`](file:///d:/CRM/enterprise-platform/packages/features/module-shell/src/lib/module-shell.tsx): Hàm `getInitials` được khai báo nhưng không còn sử dụng sau khi UI avatar chuyển sang SVG.
- Quá trình chạy `pnpm dev` biên dịch song song tất cả các service. Khi `module-shell` và `hrm-payroll-settings` gặp lỗi TypeScript, tiến trình build thất bại khiến NestJS server (`api` port 3333 và `hrm-api` port 3339) không khởi động được.
- Gateway Nginx tại port `8080` không thể kết nối tới backend nên trả về **502 Bad Gateway**.

### 3. Đã khắc phục
1. Khôi phục trạng thái chuẩn của [`hrm-payroll-settings.controller.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-payroll-settings.controller.ts).
2. Xóa hàm thừa `getInitials` trong [`module-shell.tsx`](file:///d:/CRM/enterprise-platform/packages/features/module-shell/src/lib/module-shell.tsx).
3. Đã chạy xác minh typecheck thành công:
   - `pnpm nx run module-hrm:typecheck` ✅
   - `pnpm nx run feature-module-shell:typecheck` ✅
   - `pnpm nx run worker:typecheck` ✅
   - `pnpm nx run hrm-api:typecheck` ✅

---

## II. Thực hiện kế hoạch chuẩn bị UAT (HRM_FIX_03)

### Bước 1: Sao lưu Cơ sở dữ liệu Tenant `savina`
- Đã thực hiện xuất bản sao lưu dạng nén nhị phân PostgreSQL (`pg_dump -Fc`):
  - **Tệp sao lưu:** [`savina_backup_before_c08.dump`](file:///d:/CRM/enterprise-platform/savina_backup_before_c08.dump)
  - **Dung lượng:** ~835 KB.

### Bước 2: Dọn dẹp dữ liệu kiểm thử QA03 & Mở lại phiên bản lương v1
- Đã thực thi kịch bản [`docs/hrm-fix-plan/HRM_FIX_03_CLEANUP.sql`](file:///d:/CRM/enterprise-platform/docs/hrm-fix-plan/HRM_FIX_03_CLEANUP.sql) trên DB tenant `savina`:
  - Xóa 2 bản ghi `work_calendar` tiền tố `QA03%`.
  - Dọn dẹp / ngừng kích hoạt các `attendance_sites`, `attendance_devices`, `shift_definitions`, `leave_types`, `salary_grades` liên quan `QA03%`.
  - Xóa ràng buộc quy trình `request_procedure_bindings` của `QA03%`.
  - Mở lại phiên bản công thức lương v1 (`c9a1dc83-755b-4c27-9013-6f90cc8a4461`) về trạng thái `ACTIVE`, không giới hạn ngày kết thúc (`effective_to = NULL`).

### Bước 3: Gộp 2 bản ghi chính sách ATTENDANCE
- **Vấn đề trước khi gộp:** 
  - Bảng `hrm_schema.policies` tồn tại song song 2 bản ghi `ATTENDANCE`: `POL-ATT-2026` (bản seed từ 01/01/2026) và `ATTENDANCE_DEFAULT` (tạo từ 03/10/2026).
  - Hai bản ghi này gây xung đột bao phủ ngày hiệu lực trong `resolvePolicy()`, dẫn đến lỗi `409 Conflict` và banner cảnh báo trên giao diện chấm công.
- **Hành động:**
  - Tạo tệp script lưu trữ: [`docs/hrm-fix-plan/HRM_FIX_03_MERGE_ATTENDANCE_POLICIES.sql`](file:///d:/CRM/enterprise-platform/docs/hrm-fix-plan/HRM_FIX_03_MERGE_ATTENDANCE_POLICIES.sql).
  - Đóng phiên bản v1 (`POL-ATT-2026`) vào ngày `2026-10-02` (`SUPERSEDED`).
  - Gộp phiên bản mới hiệu lực từ `2026-10-03` vào `POL-ATT-2026` dưới dạng `version_no = 2` (`ACTIVE`), hợp nhất cấu hình thừa kế (`break_minutes`, `grace_late_minutes`, `workday_standard_minutes`, `timezone`, `requireGps`,...).
  - Xóa bản ghi thừa `ATTENDANCE_DEFAULT`.
  - **Kết quả:** Tenant `savina` hiện chỉ còn duy nhất 1 bản ghi chính sách `ATTENDANCE` (`POL-ATT-2026`) với lịch sử 2 phiên bản liên tục không có khoảng trống.

### Bước 4: Chạy Migration (`migrator:hrm-migrate`)
- Chạy lệnh: `pnpm nx run migrator:hrm-migrate`
- Đã áp dụng thành công các migration:
  - `0021-hrm-offboarding-event.sql`
  - `0022-hrm-policy-single-owner.sql`
  - `0024-leave-type-merge.sql`
  - `0026-payroll-segregation-of-duties.sql`
- **Tạo Unique Index:** Do dữ liệu đã được dọn và gộp sạch ở Bước 3, migration `0022` đã tự động khởi tạo thành công index duy nhất:
  `hrm_schema.ux_hrm_policies_one_active_per_type` trên `(tenant_id, policy_type)` cho các loại `ATTENDANCE`, `PAYROLL`, `OT`.
- **Cấu hình SoD:** Đã kích hoạt 2 cờ phân tách nhiệm vụ tính/chốt lương theo yêu cầu UAT:
  ```sql
  UPDATE hrm_schema.payroll_sod_settings 
     SET separate_calc_finalize = true, separate_finalize_publish = true 
   WHERE tenant_id = 'c0195fb2-3073-445c-9768-b6d3aabaa7a8';
  ```

### Bước 5: Build lại Service
- Đã hoàn tất build production/development bundle cho:
  - `pnpm nx run hrm-api:build` ✅
  - `pnpm nx run worker:build` ✅

---

## III. Bảng Kiểm Tra Điều Kiện Tiên Quyết UAT ([HRM_FIX_03_UAT.md](file:///d:/CRM/enterprise-platform/docs/hrm-fix-plan/HRM_FIX_03_UAT.md))

| # | Điều kiện tiên quyết | Trạng thái | Chi tiết kiểm chứng |
|---|---|:---:|---|
| 1 | Sao lưu DB tenant & chạy migration 0021, 0022, 0024, 0026 | **ĐẠT** | File backup `savina_backup_before_c08.dump` đã tạo; migrator áp dụng đủ 4 migration. |
| 2 | Chỉ còn 1 bản ghi chính sách ATTENDANCE ACTIVE | **ĐẠT** | Chỉ còn `POL-ATT-2026`; index `ux_hrm_policies_one_active_per_type` đã được tạo và kích hoạt. |
| 3 | Công thức lương v1 đang ACTIVE, timeline liên tục | **ĐẠT** | Version `c9a1dc83-755b-4c27-9013-6f90cc8a4461` trạng thái `ACTIVE`, `effective_to = NULL`. |
| 4 | Dữ liệu QA03 đã được dọn | **ĐẠT** | Các bảng `work_calendar`, `attendance_sites`, `shift_definitions`, `leave_types`, `salary_grades` không còn bản ghi `QA03%` active. |
| 5 | SoD lương BẬT | **ĐẠT** | `separate_calc_finalize = true`, `separate_finalize_publish = true`. |

---

## IV. Hướng dẫn tiếp theo cho người dùng
Hệ thống và cơ sở dữ liệu đã sẵn sàng 100%. Bạn chỉ cần:
1. Chạy lại terminal với lệnh:
   ```bash
   pnpm dev
   ```
2. Truy cập hệ thống tại `http://localhost:8080` và tiến hành các bước kịch bản theo tài liệu [`docs/hrm-fix-plan/HRM_FIX_03_UAT.md`](file:///d:/CRM/enterprise-platform/docs/hrm-fix-plan/HRM_FIX_03_UAT.md).
