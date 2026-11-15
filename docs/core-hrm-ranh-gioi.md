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

## Nghỉ việc (ISS-BE-020)

HRM không ghi `core_schema.users` hay `core_schema.organization_node_assignments` khi nhân viên nghỉ việc.

1. HRM chuyển hồ sơ sang RESIGNED hoặc TERMINATED; trigger `hrm_schema.record_employee_offboarded_event` ghi
   `hrm.employee.offboarded` (payload `employeeId`, `employmentStatus`, `effectiveDate`) vào outbox trong cùng
   transaction. Tên loại sự kiện giữ nguyên. `effectiveDate` là `inactive_from` của hồ sơ (ngày người dùng nhập ở
   `POST /employees/:id/deactivate`, ngày đầu tiên không còn làm việc; migration hrm/0077), không phải ngày ghi sự
   kiện. API chỉ nhận ngày từ ngày vào làm đến hôm nay, nên hiện không có nghỉ việc ở ngày tương lai.
2. Relay của worker phát sự kiện lên RabbitMQ (loại này đã bỏ khỏi `OUTBOX_INTERNALLY_CONSUMED_TYPES`;
   `org-hrm-bridge.consumer.ts` không còn đọc nó).
3. Core nhận ở hàng đợi `identity.integrations.v1` (`packages/platform/identity/src/lib/employee-offboarding.consumer.ts`,
   đăng ký trong `apps/worker/src/main.ts`). Trong một transaction của DB tenant, chung với dòng
   `integration_schema.inbox_messages` (consumer `identity.integrations.v1`) để nhận trùng chỉ xử lý một lần:
   - tra tài khoản từ `core_schema.employees.user_id` (dữ liệu của Core, không đọc schema HRM);
   - đóng bổ nhiệm còn hiệu lực như Core: `end_date` là ngày làm việc cuối (`effectiveDate - 1`, không trước ngày bắt
     đầu, ngày kết thúc đã đặt sớm hơn thì giữ), bỏ cờ chức danh chính, `status = 'ended'` khi ngày nghỉ đã tới; ngày
     tương lai (HRM chưa cho nhập) chỉ đặt `end_date`, bổ nhiệm còn hiệu lực đến hết ngày đó như Core, còn tài khoản
     vẫn bị khoá ngay;
   - khoá tài khoản (`status = 'disabled'`, `is_active = false`); trigger của Core tăng revision và ghi
     `core.authorization.changed`; audit `user.status.change`, người thao tác là hệ thống
     (`00000000-0000-0000-0000-000000000000`), kèm nguồn sự kiện;
   - người nghỉ là quản trị tenant cuối cùng hoặc Tenant Admin chính: KHÔNG khoá, ghi cảnh báo log và audit
     `user.offboard.admin-kept`; quản trị tenant gán quản trị viên khác rồi khoá bằng tay;
   - thu hồi `identity_schema.tenant_auth_sessions` ở DB platform và phát `identity.session.revoked` cho từng phiên,
     chạy trước khi transaction tenant commit (platform lỗi thì tenant huỷ và sự kiện được thử lại).

## Gắn nhân viên cho bổ nhiệm (E-01)

HRM không ghi `core_schema.organization_node_assignments.employee_id`. Trước đây org-hrm-bridge của HRM nghe
`core.org.assignment.created` rồi tự `UPDATE` cột này; nay Core tự làm bằng trigger trong
`migrations/tenant/core/0021-assignment-employee-link.sql`, vì `employee_id` suy ra được hoàn toàn từ dữ liệu Core
(`user_id` của bổ nhiệm khớp `core_schema.employees.user_id`, duy nhất trong tenant):

- bổ nhiệm mới hoặc đổi `user_id` mà chưa có `employee_id`: trigger BEFORE điền từ dòng liên kết còn hiệu lực;
- dòng liên kết được tạo (HRM khởi tạo hồ sơ, nạp từ Core) hoặc được gắn tài khoản sau khi đã có bổ nhiệm: trigger
  AFTER trên `core_schema.employees` điền cho các bổ nhiệm còn thiếu của tài khoản đó, trong cùng transaction;
- không ghi đè `employee_id` đã có (ví dụ bổ nhiệm do quyết định nhân sự tạo).

`core.org.assignment.created` không còn trong `OUTBOX_INTERNALLY_CONSUMED_TYPES`: relay phát nó lên RabbitMQ như
`core.org.assignment.updated` (hiện chưa hàng đợi nào bind). org-hrm-bridge chỉ còn đọc `core.org.assignment.ended`
(chỉ đọc Core, ghi log) và `core.org.position.deleted` (ghi `hrm_schema.position_profiles`).

## Còn lại, ngoài phạm vi

- Liên kết tài khoản cho nhân sự cũ chưa có tài khoản (`link-account`) vẫn ở HRM.
- Họ tên hiển thị trong HRM là bản sao tại dòng liên kết, cập nhật khi bấm "Cập nhật từ Core". Muốn tự động cần thay đổi ở Core hoặc view dùng chung, nằm ngoài ranh giới module.
