# Phân công Địa điểm Chấm công GPS Đa văn phòng (HRM)

Tài liệu ghi nhận thiết kế, hiện trạng triển khai và kế hoạch các bước tiếp theo cho tính năng phân công địa điểm chấm công GPS theo Đơn vị, Chức danh và Nhân viên.

---

## 1. Bài toán & Mục tiêu

- **Bối cảnh**: Doanh nghiệp có nhiều văn phòng/chi nhánh ở các vị trí địa lý khác nhau (ví dụ: Hội sở, Chi nhánh Miền Trung, Văn phòng Đại diện miền Nam, Nhà xưởng,...).
- **Yêu cầu nghiệp vụ**:
  - Mỗi nhân viên chỉ được chấm công GPS tại các địa điểm/văn phòng được chỉ định hoặc cho phép.
  - Hỗ trợ phân công linh hoạt theo nhiều cấp độ:
    1. **Toàn công ty** (`COMPANY`): Tất cả nhân viên đều được phép chấm công tại địa điểm này.
    2. **Đơn vị / Chi nhánh / Phòng ban** (`UNIT`): Tự động áp dụng cho tất cả nhân viên thuộc đơn vị đó và các phòng ban cấp con trực thuộc (theo cây tổ chức `core_schema.organization_nodes`).
    3. **Chức danh** (`POSITION`): Áp dụng cho nhân viên giữ chức danh cụ thể (ví dụ: Giám sát vùng, Sales thị trường có thể được chấm công ở nhiều chi nhánh).
    4. **Cá nhân** (`EMPLOYEE`): Gán ngoại lệ cho nhân viên cụ thể.
  - **Tương thích ngược (Backward Compatibility)**: Nếu một tenant chưa cấu hình phân công (bảng rỗng), hệ thống giữ nguyên cơ chế cũ (cho phép chấm công tại mọi địa điểm đang hoạt động).

---

## 2. Thiết kế Kỹ thuật (Technical Design)

### 2.1. Database Schema
Migration: [`migrations/tenant/hrm/0070-hrm-attendance-site-assignments.sql`](file:///d:/CRM/enterprise-platform/migrations/tenant/hrm/0070-hrm-attendance-site-assignments.sql)

```sql
CREATE TABLE IF NOT EXISTS hrm_schema.attendance_site_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  site_id UUID NOT NULL REFERENCES hrm_schema.attendance_sites(id) ON DELETE CASCADE,
  scope_type VARCHAR(32) NOT NULL, -- 'COMPANY', 'UNIT', 'POSITION', 'EMPLOYEE'
  scope_id UUID NOT NULL,          -- tenant_id nếu COMPANY; unit_id / position_id / employee_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by UUID,
  CONSTRAINT uq_site_assignment UNIQUE (tenant_id, site_id, scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_site_assign_lookup 
  ON hrm_schema.attendance_site_assignments (tenant_id, scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_site_assign_site 
  ON hrm_schema.attendance_site_assignments (tenant_id, site_id);
```

### 2.2. Contracts dùng chung
File: [`packages/contracts/hrm/src/lib/contracts-hrm.ts`](file:///d:/CRM/enterprise-platform/packages/contracts/hrm/src/lib/contracts-hrm.ts)

- **`AttendanceSiteScopeType`**: `'COMPANY' | 'UNIT' | 'POSITION' | 'EMPLOYEE'`
- **`AttendanceSiteAssignment`**: Bản ghi phân công gồm `id`, `siteId`, `scopeType`, `scopeId`, `scopeName` (hỗ trợ hiển thị tên phòng ban/chức danh/nhân viên).
- **`SetAttendanceSiteAssignmentsRequest`**: DTO gửi từ UI lên để gán danh sách phân công cho địa điểm:
  ```ts
  export interface SetAttendanceSiteAssignmentsRequest {
    assignments: Array<{
      scopeType: AttendanceSiteScopeType;
      scopeId: string;
    }>;
  }
  ```

### 2.3. Logic phân giải theo Cây tổ chức (Resolution Service)
File: [`packages/modules/hrm/src/lib/infrastructure/hrm-attendance-site-resolve.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/infrastructure/hrm-attendance-site-resolve.ts)
- Hàm `resolveAllowedAttendanceSites(db, tenantId, employeeId)`:
  - Sử dụng **Recursive CTE** leo ngược từ phòng ban của nhân viên lên các cấp tổ chức cha (`core_schema.organization_nodes`).
  - Hợp nhất các site được cấp theo 4 cấp độ: `COMPANY`, `UNIT` (bao gồm các cấp cha), `POSITION` (chức danh hiện tại), `EMPLOYEE` (chỉ định riêng).
  - Tự động bỏ qua các site đã bị vô hiệu hóa (`is_active = false`).
  - Đã có unit test bao phủ: [`hrm-attendance-site-resolve.spec.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/infrastructure/hrm-attendance-site-resolve.spec.ts).

### 2.4. Ingest & Kiểm tra GPS Chấm công
File: [`packages/modules/hrm/src/lib/infrastructure/hrm-attendance-ingest.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/infrastructure/hrm-attendance-ingest.ts)
- Khi nhân viên thực hiện chấm công di động/web bằng toạ độ GPS:
  - Hệ thống lấy danh sách `allowedSites` từ `resolveAllowedAttendanceSites`.
  - Chỉ kiểm tra khoảng cách với các địa điểm nhân viên được phép.
  - Nếu nằm ngoài bán kính, thông báo lỗi nêu rõ khoảng cách tới địa điểm gần nhất và liệt kê các văn phòng mà nhân viên được phân công.

### 2.5. APIs Quản trị Phân công
File: [`packages/modules/hrm/src/lib/presentation/hrm-time-settings.controller.ts`](file:///d:/CRM/enterprise-platform/packages/modules/hrm/src/lib/presentation/hrm-time-settings.controller.ts)
- `GET /api/hrm/v1/time-settings`: Trả về danh sách địa điểm kèm danh sách `assignments` (đã join tên hiển thị).
- `PUT /api/hrm/v1/time-settings/sites/:id/assignments`: Cập nhật cấu hình phân công cho địa điểm, ghi audit log `lifecycleAudit`.

---

## 3. Tiến độ Thực hiện

| Hạng mục | Chi tiết | Trạng thái |
|---|---|---|
| **DB Migration** | Migration 0070 tạo bảng, index, đăng ký vào `tenant-migrations.ts` | **Đã hoàn thành** (Đã chạy trên DB local `savina`) |
| **Contracts** | Định nghĩa Types, DTOs trong `contracts-hrm.ts` | **Đã hoàn thành** |
| **Resolution Service** | Hàm `resolveAllowedAttendanceSites` với Recursive CTE | **Đã hoàn thành** (Unit tests pass 100%) |
| **Ingest Logic** | So khớp toạ độ GPS theo địa điểm phân công tại `hrm-attendance-ingest.ts` | **Đã hoàn thành** |
| **APIs** | API `GET` & `PUT` cấu hình phân công tại `hrm-time-settings.controller.ts` | **Đã hoàn thành** |
| **Frontend UI** | Giao diện cấu hình phân công trong Modal địa điểm chấm công (`/modules/hrm/settings/attendance-sites`) | **Chưa thực hiện** |
| **E2E & Test thực tế** | Kiểm thử giao diện lưu phân công và test chấm công GPS thực tế | **Chưa thực hiện** |

---

## 4. Kế hoạch & Các bước tiếp theo

1. **Phát triển Frontend UI (`packages/features/hrm`)**:
   - Vị trí màn hình: `/modules/hrm/settings` (Tab Địa điểm chấm công).
   - Bổ sung vào Drawer/Modal Cài đặt địa điểm:
     - Nhóm chọn **Phạm vi áp dụng**:
       - Radio/Switch: *Áp dụng toàn công ty* (Mặc định) HOẶC *Áp dụng theo Đơn vị / Chức danh / Nhân viên*.
     - Khi chọn áp dụng có phạm vi:
       - Bộ chọn Đơn vị / Phòng ban (tích hợp Tree/SearchableSelect).
       - Bộ chọn Chức danh (SearchableSelect đa chọn).
       - Bộ chọn Nhân viên ngoại lệ (SearchableSelect đa chọn).
     - Hiển thị cột / tag tóm tắt phân công trên bảng danh sách địa điểm (ví dụ: badge "VP Đà Nẵng: Áp dụng 3 phòng ban, 2 chức danh").

2. **Kiểm thử tích hợp (Integration & UAT)**:
   - Thử nghiệm lưu cấu hình từ UI xuống API.
   - Dùng tài khoản nhân viên thuộc phòng ban được gán và không được gán để xác nhận thông báo chặn GPS chính xác.

3. **Mở rộng Đơn công tác (Tùy chọn)**:
   - Nếu nhân viên có **Đơn công tác** (`business_trip_requests`) đã được duyệt tại địa điểm/chi nhánh khác vào ngày hiện tại, tự động cấp quyền chấm công tạm thời tại văn phòng đó mà không cần cấu hình thủ công.
