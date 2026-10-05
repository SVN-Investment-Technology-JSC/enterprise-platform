# Quyết định nhân sự: bổ nhiệm kèm người quản lý trực tiếp và lương

Một quyết định nhân sự (QĐ) gộp chức danh mới, người quản lý trực tiếp mới và thay đổi lương
dưới cùng một số quyết định và một ngày hiệu lực.

## Phạm vi đã làm
- Loại QĐ: `APPOINT`, `PROMOTE`, `TRANSFER`, `CONCURRENT`, `DISMISS`, `CHANGE_MANAGER`.
- Luồng: `DRAFT -> APPROVED -> APPLIED`. Lỗi giữa chừng chuyển `APPLY_PENDING` và thử lại được.
  Có `REJECTED` và `CANCELLED`.
- Duyệt trực tiếp trong HRM. **Chưa liên kết quy trình (PE)**, sẽ bổ sung sau.
- Người lập hoặc người được bổ nhiệm không tự duyệt, trừ khi tenant bật ngoại lệ tự duyệt
  (`approval_policy_settings.allow_self_approval`).

## Dữ liệu
- `hrm_schema.personnel_decisions` (migration HRM `0032`): QĐ, ảnh chụp trước/sau, tiến độ áp dụng `applied_steps`.
- `hrm_schema.employee_reporting_lines` (cùng migration): nhân viên báo cáo cho nhân viên,
  có hiệu lực theo ngày, độc lập với sơ đồ tổ chức Core. Mỗi nhân viên có tối đa một dòng `DIRECT` đang mở.
- `core_schema.organization_node_assignments.source_decision_id` (migration Core `0009`):
  dấu vết QĐ và khóa idempotent.

## Áp dụng QĐ (idempotent, theo từng bước)
1. **Core**: `POST /api/platform/internal/v1/organization-contexts/:tenantId/appointments`
   (xác thực `x-service-token`). HRM không ghi trực tiếp phân công của Core.
   `ASSIGN` giao chức danh; `endCurrent` kết thúc phân công chính cũ đến hết ngày trước hiệu lực.
   `END` miễn nhiệm. `decisionId` làm khóa idempotent.
2. **Người quản lý**: đóng dòng báo cáo cũ, mở dòng mới (`SET`) hoặc chỉ đóng (`CLEAR`). Chặn vòng lặp báo cáo.
3. **Cấp dưới**: chuyển toàn bộ cấp dưới trực tiếp sang người nhận (`REASSIGN`).
4. **Lương**: hồ sơ lương mới ngay trong form QĐ (trường thông tin), cùng ràng buộc với
   `POST salary-profiles` (không sửa kỳ lương đã chốt).

QĐ có ngày hiệu lực tương lai do worker áp dụng khi đến hạn (`applyDueDecisions`).

## API HRM (`/api/hrm/v1`)
| Phương thức | Đường dẫn | Quyền |
|---|---|---|
| GET, POST | `personnel-decisions` | `hrm.appointment.read` / `.manage` |
| GET, PATCH | `personnel-decisions/:id` | `.read` / `.manage` (chỉ bản nháp, kiểm `version`) |
| POST | `personnel-decisions/:id/approve`, `/reject`, `/retry-apply` | `.approve` |
| POST | `personnel-decisions/:id/cancel` | `.manage` hoặc `.approve` |
| GET | `employees/:id/reporting-lines`, `/subordinates`, `/appointment-context` | `employee.read` hoặc chính mình / `.read` |

Vai trò mẫu mới: "HRM - Trưởng phòng nhân sự" (`hrm.appointment.approve`); "HRM - Nhân sự (hồ sơ)" có `.read` và `.manage`.

## Giao diện
Mục "Quyết định nhân sự" dưới "Nhân sự & Hồ sơ" (`/modules/hrm/personnel-decisions`): danh sách, bộ lọc,
Drawer chi tiết, Dialog tạo/sửa có bảng Trước/Sau và bảng tác động cấp dưới. Màn Nhân sự có nút
"Tạo quyết định" và "Lịch sử báo cáo". Hồ sơ cá nhân hiển thị người quản lý và số QĐ gần nhất.

## Giới hạn hiện tại
- Nhân viên phải liên kết tài khoản mới bổ nhiệm vào chức danh Core (Core gắn phân công theo `user_id`).
- Mỗi nhân viên chỉ có một QĐ chưa hoàn tất tại một thời điểm.
- Chưa có `DOTTED`, phạm vi theo loại đơn, người duyệt thay, gán hàng loạt, liên kết PE.
- Worker phải chạy thì QĐ hẹn ngày mới tự áp dụng.
