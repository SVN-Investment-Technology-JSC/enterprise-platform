# Ranh giới dữ liệu Core và HRM

Nguyên tắc: Core là nguồn gốc của tài khoản, họ tên, email và cơ cấu tổ chức. HRM là một module: toàn bộ thay đổi nằm trong phân hệ HRM, **không sửa Core chung hay module khác**. HRM chỉ đọc dữ liệu Core và giữ nghiệp vụ nhân sự đặc thù.

## Ai sở hữu gì

| Dữ liệu | Chủ sở hữu | Bảng | Nơi tạo / sửa | HRM làm gì |
|---|---|---|---|---|
| Tài khoản đăng nhập (họ tên, email) | Core | `core_schema.users` | Core, màn Người dùng | Chỉ đọc |
| Đơn vị, chức danh, quan hệ báo cáo | Core | `core_schema.organization_nodes` | Core, Sơ đồ tổ chức | Chỉ đọc qua view `hrm_schema.employee_directory` |
| Bổ nhiệm (ai giữ chức danh nào) | Core | `core_schema.organization_node_assignments` | Core, hoặc HRM qua cổng `HrmOrgAppointmentPort` khi ban hành quyết định nhân sự (đã có từ trước) | Không đổi |
| Dòng liên kết nhân sự | Cầu nối | `core_schema.employees` | HRM tạo khi khởi tạo hồ sơ, **sao chép** họ tên và email từ tài khoản Core | Khóa ngoại bắt buộc của mọi bảng HRM; bấm "Cập nhật từ Core" để đồng bộ lại |
| Hồ sơ nghiệp vụ nhân sự (mã NV, ngày vào làm, trạng thái, CCCD, MST, BHXH, ngân hàng...) | HRM | `hrm_schema.employee_profiles` | HRM | Sở hữu |
| Hợp đồng, người phụ thuộc, quyết định nhân sự, công, phép, lương | HRM | `hrm_schema.*` | HRM | Sở hữu |

Dòng liên kết `core_schema.employees` đã tồn tại từ trước và HRM luôn ghi vào nó. Lần này HRM vẫn chỉ ghi dòng này, không ghi thêm bảng Core nào và không thêm API hay màn hình vào Core.

## Luồng

1. Core: tạo tài khoản và gán chức danh ở Sơ đồ tổ chức (như hiện nay, không đổi).
2. HRM, Nhân sự, **"Nạp nhân sự từ Core"**: chọn nhiều người đã có ở Core, đặt ngày vào làm chung, mã nhân viên tự sinh (sửa được từng dòng), nạp trong một lần, tất cả hoặc không. Họ tên, email, đơn vị, chức danh lấy từ Core.
3. Core đổi họ tên hoặc email: HRM, Nhân sự, **"Cập nhật từ Core"**. Đơn vị và chức danh luôn đọc trực tiếp từ Core nên tự đúng.
4. HRM không nhận họ tên hoặc email: gửi giá trị khác với dữ liệu hiện có trả lỗi `HRM_CORE_OWNED_FIELD`. Họ tên không còn nằm trong đơn đính chính hồ sơ.
5. HRM không còn tự tạo hồ sơ giả (mã `EMP-xxxx`, ngày vào làm là hôm nay). Người chưa có hồ sơ HRM nhận lỗi `HRM_PROFILE_NOT_INITIALIZED` đến khi được nạp.

## Reset HRM và nạp lại từ Core

Dùng khi dữ liệu HRM hiện có là dữ liệu thử.

1. Sao lưu CSDL của tenant (`pg_dump`). Xóa không hoàn tác được.
2. Xem trước: `node tools/reset-hrm-data.mjs --tenant=<slug>`. Chỉ đọc: liệt kê từng bảng sẽ xóa hoặc giữ kèm số dòng, số bổ nhiệm Core do quyết định nhân sự HRM sinh ra, và các dòng liên kết "mồ côi" (không tài khoản, không bổ nhiệm).
3. Xóa thật: `node tools/reset-hrm-data.mjs --tenant=<slug> --apply --confirm=<slug>`. Một giao dịch, lỗi thì không đổi gì. Thêm `--prune-core-orphans` để xóa mềm các dòng liên kết mồ côi (do HRM tạo trước đây).
4. Rà Sơ đồ tổ chức ở Core: chức danh và bổ nhiệm phải đúng, vì HRM đọc thẳng từ đó.
5. HRM, Nhân sự, "Nạp nhân sự từ Core".

Script xóa dữ liệu nghiệp vụ gắn với nhân viên (hồ sơ, hợp đồng, người phụ thuộc, chấm công, bảng công, phép, đơn từ, lương, phiếu lương, lịch phân ca, quyết định nhân sự, nhật ký HRM...). Script giữ cấu hình và danh mục (ca, loại nghỉ, chính sách, công thức và ngạch lương, lịch làm việc mẫu, ngày lễ, quy trình duyệt) và toàn bộ dữ liệu Core. Tệp đính kèm đã tải lên kho đối tượng không bị xóa, chỉ xóa dòng siêu dữ liệu.

## Còn lại, ngoài phạm vi

- Khi nghỉ việc, HRM vô hiệu hóa tài khoản và đóng bổ nhiệm qua sự kiện (`org-hrm-bridge.consumer.ts`, có từ trước).
- Liên kết tài khoản cho nhân sự cũ chưa có tài khoản (`link-account`) vẫn ở HRM.
- Họ tên hiển thị trong HRM là bản sao tại dòng liên kết, cập nhật khi bấm "Cập nhật từ Core". Muốn tự động cần thay đổi ở Core hoặc view dùng chung, nằm ngoài ranh giới module.
