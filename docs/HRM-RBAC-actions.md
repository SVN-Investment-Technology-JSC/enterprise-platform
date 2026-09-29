# Danh mục quyền HRM trong RBAC động

Cập nhật **29/09/2026**. Nguồn quyền: `packages/contracts/identity/src/lib/tenant-authorization.ts`; navigation HRM dùng định nghĩa chung trong `packages/features/hrm/src/lib/hrm-navigation.ts`.

Tenant cần entitlement HRM hoạt động; tài khoản cần quyền truy cập module và các hành động phù hợp. `hrm.manage` bao gồm toàn bộ quyền HRM; không cấp tự động cho vai trò tùy chỉnh. Nhóm cá nhân giới hạn hồ sơ nhân viên liên kết với tài khoản. Quyền nghiệp vụ quản trị có phạm vi toàn tenant, chưa chia theo phòng ban/pháp nhân.

| Nhóm | Mã hành động | Đầu ra được phép |
|---|---|---|
| HRM · Cá nhân | `hrm.self.read` | Xem hồ sơ, công và đơn của bản thân |
| HRM · Cá nhân | `hrm.self.profile.write` | Cập nhật thông tin cá nhân cho phép |
| HRM · Cá nhân | `hrm.self.attendance` | Chấm công và đăng ký trình duyệt cá nhân |
| HRM · Cá nhân | `hrm.self.request` | Gửi, sửa và rút đơn cá nhân |
| HRM · Cá nhân | `hrm.self.payslip` | Xem phiếu lương của bản thân |
| HRM · Nhân sự | `hrm.employee.read` | Xem hồ sơ nhân viên toàn tenant |
| HRM · Nhân sự | `hrm.employee.manage` | Tạo và sửa hồ sơ, chức danh |
| HRM · Nhân sự | `hrm.employee.link-account` | Liên kết nhân viên với tài khoản |
| HRM · Báo cáo | `hrm.dashboard.read` | Xem tổng quan nhân sự toàn tenant |
| HRM · Ca và công | `hrm.shift.read` | Xem lịch phân ca toàn tenant |
| HRM · Ca và công | `hrm.shift.manage` | Cấu hình ca và phân ca |
| HRM · Ca và công | `hrm.shift.approve` | Duyệt đổi ca |
| HRM · Ca và công | `hrm.attendance.read` | Xem công toàn tenant |
| HRM · Ca và công | `hrm.attendance.import` | Nhập sự kiện từ máy chấm công |
| HRM · Ca và công | `hrm.attendance.approve` | Duyệt và xử lý giải trình công |
| HRM · Ca và công | `hrm.time.configure` | Cấu hình công, IP, GPS, lịch nghỉ |
| HRM · Ca và công | `hrm.device.manage` | Duyệt và thu hồi trình duyệt chấm công |
| HRM · Phép và đơn | `hrm.leave.read` | Xem quỹ phép và sổ phép toàn tenant |
| HRM · Phép và đơn | `hrm.leave.manage` | Cấu hình, tích, chuyển và điều chỉnh quỹ phép |
| HRM · Phép và đơn | `hrm.request.read` | Xem đơn nghiệp vụ toàn tenant |
| HRM · Phép và đơn | `hrm.request.manage` | Tạo đơn thay nhân viên |
| HRM · Phép và đơn | `hrm.leave.approve` | Duyệt, từ chối và đảo đơn nghỉ |
| HRM · Phép và đơn | `hrm.ot.approve` | Duyệt và xử lý tăng ca |
| HRM · Phép và đơn | `hrm.trip.approve` | Duyệt và xử lý công tác |
| HRM · Phép và đơn | `hrm.profile.approve` | Duyệt thay đổi hồ sơ |
| HRM · Tạm ứng | `hrm.advance.read` | Xem tạm ứng toàn tenant |
| HRM · Tạm ứng | `hrm.advance.approve` | Duyệt tạm ứng |
| HRM · Tạm ứng | `hrm.advance.disburse` | Giải ngân và lập lịch thu hồi ứng |
| HRM · Bảng công | `hrm.timesheet.read` | Xem bảng công tổng hợp |
| HRM · Bảng công | `hrm.timesheet.calculate` | Tạo kỳ và tính bảng công |
| HRM · Bảng công | `hrm.timesheet.adjust` | Điều chỉnh bảng công |
| HRM · Bảng công | `hrm.timesheet.lock` | Khóa bảng công |
| HRM · Bảng công | `hrm.timesheet.reopen` | Mở lại bảng công |
| HRM · Bảng công | `hrm.timesheet.export` | Xuất bảng công |
| HRM · Tiền lương | `hrm.salary.read` | Xem ngạch bậc và mức lương nhân viên |
| HRM · Tiền lương | `hrm.salary.manage` | Quản lý mức lương và ngạch bậc |
| HRM · Tiền lương | `hrm.dependent.read` | Xem hồ sơ người phụ thuộc toàn tenant |
| HRM · Tiền lương | `hrm.dependent.manage` | Ghi nhận và kết thúc đăng ký người phụ thuộc |
| HRM · Tiền lương | `hrm.payroll.read` | Xem bảng lương toàn tenant |
| HRM · Tiền lương | `hrm.payroll.configure` | Cấu hình công thức, thuế, bảo hiểm và tham số |
| HRM · Tiền lương | `hrm.payroll.calculate` | Tạo kỳ và tính lương |
| HRM · Tiền lương | `hrm.payroll.adjust` | Điều chỉnh thu nhập và khấu trừ |
| HRM · Tiền lương | `hrm.payroll.finalize` | Chốt lương và thu hồi tạm ứng |
| HRM · Tiền lương | `hrm.payroll.publish` | Phát hành phiếu lương |
| HRM · Tiền lương | `hrm.payroll.pay` | Ghi nhận chi trả |
| HRM · Tiền lương | `hrm.payroll.export` | Xuất dữ liệu thanh toán và đối soát |
| HRM · Vận hành HRM | `hrm.automation.manage` | Cấu hình lịch chạy tích phép |
| HRM · Vận hành HRM | `hrm.integration.manage` | Cấu hình kết nối và theo dõi tích hợp |
| HRM · Vận hành HRM | `hrm.audit.read` | Xem nhật ký nghiệp vụ |
| HRM · Truy cập | `hrm.read` | Vào HRM và xem danh mục dùng chung |
| HRM · Quản trị | `hrm.manage` | Toàn quyền nghiệp vụ HRM trong tenant |

Quyền ghi bổ sung quyền đọc liên quan theo dependency trong nguồn RBAC. Tính lương không mặc nhiên cấp quyền chốt, phát hành hay ghi nhận chi trả. API kiểm tra quyền hiện tại cho mỗi yêu cầu; UI làm mới quyền khi lấy lại tiêu điểm/theo chu kỳ và phản ứng với 403 để không tiếp tục hiển thị thao tác dựa trên quyền cũ. Menu desktop/mobile và route active dùng cùng nguồn định nghĩa navigation để tránh lệch quyền giữa các shell.

Task 14 đã chạy lint 8 app thành công. Browser UAT thu hồi quyền trực tiếp vẫn chưa được đánh dấu đạt vì local `db:provision` đang vướng checksum migration core và fixture đăng nhập hiện không hợp lệ; xem [biên bản ERP-114](ERP-114-implementation-and-UAT.md) để biết blocker cụ thể.

Hướng dẫn cấu hình vai trò, luồng thao tác và nghiệm thu: [HRM ERP-114](HRM-ERP114-chuc-nang-va-huong-dan.md).
