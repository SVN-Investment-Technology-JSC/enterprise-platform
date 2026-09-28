# Thiết kế hợp nhất HRM sau rebase — ERP-114

Ngày: 28/09/2026. Trạng thái: **Người dùng đã duyệt thiết kế bằng lời nhắn “Duyệt thiết kế”; chưa triển khai và nghiệm thu bản hợp nhất**.

## 1. Mục tiêu và quyết định đã có

- Giữ cơ chế Procedure của Hải: chọn quy trình theo loại đơn, biểu mẫu động gồm thuộc tính bước S, khởi tạo instance qua API và hiển thị tiến độ.
- Thiết kế lại đồng bộ kết quả duyệt sang HRM; giữ các kiểm soát công, phép, lương và RBAC đã bổ sung trên nhánh Tài.
- Rà soát CRUD theo vòng đời nghiệp vụ; mỗi màn hình có route và quyền rõ ràng, không có hai menu cùng active.
- Làm tại thư mục chính. Kiểm thử trên ERP qua gateway; được tạo dữ liệu giả, không gắn nhãn HRM-UAT. Chưa cập nhật Jira hoặc đánh dấu Done khi chưa kiểm chứng.

## 2. Hiện trạng đã xác minh từ mã nguồn

| Phát hiện | Bằng chứng | Hệ quả cần xử lý |
|---|---|---|
| Hai đường khởi tạo Procedure | `hrm-procedure-bridge.service.ts` và `hrm-workflow.ts`, trigger migration 0012 | Một đơn có thể tạo hai instance nếu cùng bật cấu hình |
| Bridge ghi trực tiếp trạng thái Procedure | `handleProcedureAction`, ghi `runtime_state` | Có thể kết thúc quy trình trước khi đủ bước/điều kiện |
| Xem tiến độ có ghi nghiệp vụ | `getProcedureProgress` gọi `syncProcedureStatus` | Kết quả công/phép phụ thuộc việc mở màn hình |
| Hai cấu trúc người phụ thuộc không tương thích | Employee controller của Hải và migration 0013 | Tự khai hồ sơ gia đình và đăng ký giảm trừ đang dùng cùng tên bảng nhưng khác cột/quy tắc |
| Thiếu schema trong cây migration đang ghép | Chưa tìm thấy DDL `employment_contracts` và các cột hồ sơ như `marital_status` | Cần migration bổ sung; chưa kết luận trạng thái mọi DB tenant |
| Registry đang thiếu hai migration của Hải | `tenant-migrations.ts` không đăng ký `0002-hrm-procedure-integration.sql`, `0003-hrm-requests-enhancement.sql` | Có file SQL nhưng provisioning chưa chạy chúng |
| Decorator tạo đơn nghỉ bị comment ở bản Hải | `hrm-leave.controller.ts`, `@Post('leave-requests')` nằm cuối dòng comment | Cần test metadata route và khôi phục endpoint khi hợp nhất |
| Menu trùng active | Hai href `/policies`; match prefix khiến `/payroll` active cùng `/payroll/settings` | Duy nhất một menu lá active theo route cụ thể |
| Mã loại đơn khác nhau giữa hai cơ chế | Bridge/contracts dùng `leave`, `ot`, `correction`; workflow cũ dùng `LEAVE`, `OT`, `ATTENDANCE` | Ánh xạ tường minh khi chuyển cấu hình và dữ liệu, không chỉ đổi chữ hoa/thường |
| Đọc cột đồng bộ chưa tồn tại | `syncProcedureStatus` SELECT `applied_at` cho cả OT, công tác, tạm ứng; cây migration không tạo cột này cho ba bảng | Theo dõi hiệu lực đồng bộ trong liên kết/inbox thống nhất, không giả định mọi bảng đơn có cùng cột |
| Tác nhân hệ thống không đúng kiểu dữ liệu | Bridge fallback `system-procedure`, nhưng `approved_by` là UUID | Dùng định danh hệ thống hợp lệ; lưu riêng người duyệt thực tế, không giả lập người duyệt |
| Loại đơn khai báo nhưng chưa có nhánh đồng bộ | Contracts có `profile_correction`, bridge chưa xử lý loại này | Khai báo rõ chế độ duyệt; không cho cấu hình Procedure khi handler chưa hỗ trợ |

Phần lớn phát hiện dựa trên kiểm tra tĩnh. Đã chạy `pnpm nx run platform-entitlement:test --skipNxCache` ngày 28/09/2026: **4 đạt, 1 thất bại**, test bao phủ registry báo thiếu đúng hai migration Hải nêu trên. Các dependency contracts-tenancy/adapter-database build được trong lượt chạy này. Chưa có build/test/UAT toàn bộ bản hợp nhất; không dùng kết quả trước rebase để kết luận bản hợp nhất đạt.

## 3. Phương án đồng bộ được đề xuất

So sánh: giữ cả hai cơ chế dễ trùng instance; chỉ dùng worker khởi tạo sẽ đổi cơ chế Hải mà người dùng muốn giữ. Chọn giữ bridge khởi tạo của Hải, bổ sung một đường đồng bộ kết quả có lưu trạng thái và thử lại.

### 3.1. Một nơi cấu hình và một instance cho mỗi lần gửi

- Dùng `request_procedure_bindings` làm cấu hình chuẩn. Chuyển cấu hình `workflow_rules` cũ sang cấu hình này, báo xung đột nếu cùng loại đơn có hai quy trình khác nhau; không tự chọn ngẫu nhiên.
- Chuẩn hóa theo mã contracts của Hải: `LEAVE → leave`, `OT → ot`, `SHIFT_CHANGE → shift_change`, `BUSINESS_TRIP → business_trip`, `ATTENDANCE → correction`, `ADVANCE → advance`, `PROFILE → profile_correction`. Giữ bộ đọc tương thích sự kiện cũ; không sửa dữ liệu lịch sử bằng đổi chữ hoa/thường hàng loạt.
- Chọn binding rõ ràng theo loại đơn/loại con; không tìm quy trình bằng tên gần giống hoặc chọn bất kỳ quy trình HR đã publish.
- Cấu hình mỗi loại đơn là duyệt trực tiếp hoặc qua Procedure. Chế độ Procedure bắt buộc có binding hợp lệ; không âm thầm chuyển sang duyệt trực tiếp khi lỗi.
- Khi gửi đơn, lưu đơn và liên kết ở trạng thái chờ khởi tạo trong transaction. Sau commit, bridge gọi Procedure API ngay với khóa chống trùng ổn định theo tenant, loại đơn, ID và lần gửi.
- Nếu timeout: hiện “Chờ khởi tạo quy trình”, giữ thông tin lỗi và cho thử lại đúng khóa cũ. Bộ xử lý phục hồi gọi cùng bridge; không có cơ chế thứ hai tự tạo instance độc lập.
- Biểu mẫu động được kiểm tra và truyền vào API khởi tạo trước khi Procedure đánh giá bước/nhánh đầu tiên. Không ghi trực tiếp snapshot hay `runtime_state` từ HRM.
- Tách `employeeId` của đối tượng nhân sự khỏi `userId` của người thao tác; kiểm tra liên kết và tenant tại backend.

### 3.2. Duyệt qua Procedure, ghi nhận hiệu lực tại HRM

- Nút xử lý đơn gọi action API của Procedure bằng danh tính người thao tác. Procedure kiểm tra bước hiện tại, người phụ trách và điều kiện chuyển nhánh.
- Một bước được duyệt chưa đồng nghĩa toàn bộ đơn được duyệt. Chỉ kết quả kết thúc hợp lệ của instance mới làm phát sinh hiệu lực HRM.
- Lưu sự kiện kết quả trước khi xử lý, đối chiếu tenant + instance + đơn + lần gửi. Dùng ràng buộc duy nhất và khóa dòng để sự kiện gửi lặp chỉ tạo hiệu lực một lần.
- Áp dụng thay đổi HRM và đánh dấu đã đồng bộ trong cùng transaction. Khi lỗi, rollback hiệu lực; giữ lỗi để thử lại.
- Giữ các hàm nghiệp vụ hiện có cho nghỉ phép, OT, đổi ca. Bổ sung cùng cơ chế cho công tác, điều chỉnh công, tạm ứng; không duy trì hai bộ quy tắc tính toán.
- Đơn điều chỉnh hồ sơ hiện duyệt trực tiếp bằng kiểm tra dữ liệu trước/sau. Giữ hành vi này khi chuyển tiếp; để hỗ trợ cấu hình Procedure phải thêm handler dùng cùng kiểm tra xung đột và quyền. UI không quảng bá khả năng chưa có handler.
- Phân biệt người duyệt cuối cùng với tác nhân kỹ thuật áp dụng kết quả. Người duyệt lấy từ kết quả Procedure đã xác thực; tác nhân kỹ thuật dùng định danh hệ thống hợp lệ. Không đưa chuỗi `system-procedure` vào cột UUID hoặc gán nhầm hệ thống thành người duyệt.
- Từ chối và hủy là hai trạng thái riêng. Thu hồi hiệu lực đã duyệt phải là nghiệp vụ đảo/điều chỉnh có quyền và lý do; không xóa lịch sử.
- Kỳ công/lương đã khóa: không cập nhật ngầm. Hiện kết quả quy trình đã kết thúc nhưng đồng bộ đang bị chặn, yêu cầu mở kỳ hoặc điều chỉnh theo quyền.
- GET tiến độ chỉ đọc. Job đối soát định kỳ bổ sung kết quả bị bỏ lỡ qua cùng bộ xử lý; UI có trạng thái đồng bộ, lỗi và nút thử lại theo quyền.

### 3.3. Chuyển tiếp dữ liệu

- Viết migration mới; không sửa checksum hoặc nội dung migration đã chạy. Đăng ký đủ migration Hải và kiểm tra thứ tự phụ thuộc.
- Ngừng đường trigger/worker cũ tạo mới đối với đơn đã chuyển sang bridge. Giữ liên kết instance đang chạy, không tạo lại hoặc hủy instance cũ tự động.
- Hai instance cho cùng đơn: đưa vào danh sách cần đối soát, chặn áp dụng kép; không tự đoán instance đúng. Các đơn chỉ có một liên kết được chuyển tiếp tự động.
- Tách hồ sơ người thân tự khai khỏi hồ sơ giảm trừ đã xác minh. Dữ liệu giảm trừ hiện hữu giữ ngày hiệu lực, chứng từ và người xác minh; tự khai không tự tăng khoản giảm trừ.
- Bổ sung schema hợp đồng/hồ sơ còn thiếu, ánh xạ thống nhất về `core.employees`; không mặc định employee ID là account ID.

## 4. Ma trận CRUD và đầu ra nghiệp vụ

Các mục dưới là phạm vi cần đối chiếu/bổ sung sau khi duyệt, không phải danh sách đã hoàn thành. “Xóa” được quyết định theo trạng thái và tham chiếu.

| Nghiệp vụ | Hiện trạng đáng chú ý | Hành vi/đầu ra đề xuất |
|---|---|---|
| Hồ sơ nhân viên | Có tạo/xem/sửa; cần vòng đời ngừng hoạt động | Sửa thông tin có quyền; nghỉ việc/ngừng hoạt động giữ lịch sử công/lương, không xóa nhân viên có giao dịch |
| Chức danh, ngạch/bậc lương | Có nhiều thao tác CRUD; bậc lương cần rà soát sửa/ngừng | Danh mục có hiệu lực, ngừng sử dụng khi đã tham chiếu; lịch sử lương theo thời gian |
| Hồ sơ người thân và giảm trừ | Hai mô hình hiện xung đột | Tự khai tạo/sửa/xóa mềm; HR xác minh giảm trừ, chỉnh thông tin hoặc kết thúc hiệu lực có audit |
| Hợp đồng | Bản Hải có đọc/tạo, thiếu schema tương ứng | Tạo/sửa/xóa bản nháp; ban hành, gia hạn/phụ lục, kết thúc; không sửa mất lịch sử hợp đồng có hiệu lực |
| Ca và phân ca | Danh mục ca có CRUD; phân ca thiếu thao tác sửa/hủy rõ ràng | Điều chỉnh/hủy phân ca kỳ mở, kiểm tra trùng và ca qua đêm; chặn ảnh hưởng kỳ khóa |
| Loại nghỉ và lịch cộng phép | Loại nghỉ có API sửa/xóa nhưng UI chủ yếu thêm; lịch cộng chủ yếu tạo/xem | Sửa/ngừng loại nghỉ; sửa lịch chưa áp dụng hoặc tạo phiên bản có hiệu lực; không cộng phép lặp |
| Quỹ phép | Ledger, cộng/chuyển phép đã có nền tảng | Điều chỉnh tăng/giảm và bút toán đảo có lý do; không sửa/xóa trực tiếp ledger |
| Quy định công, lịch nghỉ, địa điểm | Có cấu hình nhưng thiếu vòng đời đồng nhất | Sửa theo hiệu lực; sửa/xóa lịch kỳ mở; sửa/ngừng địa điểm giữ chứng cứ chấm công lịch sử |
| Thiết bị | Có đăng ký/duyệt/thu hồi | Theo dõi thiết bị hoạt động và thu hồi; đổi thiết bị theo quyền, không xóa lịch sử xác thực |
| Đơn từ | Các loại đơn chưa đồng nhất sửa/rút/hủy | Nháp được sửa/xóa; đã gửi được rút theo trạng thái Procedure; đơn có hiệu lực dùng nghiệp vụ điều chỉnh/đảo |
| Bảng công | Có tính/khóa/mở/điều chỉnh | Sửa hoặc xóa kỳ nháp rỗng; tính lại kỳ mở; giữ lịch sử điều chỉnh và nguyên nhân bất thường |
| Chính sách và dữ liệu lương | Có tạo phiên bản/cấu hình/input | Sửa nháp, ngừng theo hiệu lực; sửa/xóa input chưa chốt; kiểm tra công thức trước áp dụng |
| Kỳ và bảng lương | Có tính/chốt/phiếu lương | Sửa/xóa nháp rỗng, hủy lần tính nháp; bảng đã chốt chỉ điều chỉnh có truy vết; phiếu đã phát hành giữ bản đã phát |
| Tạm ứng | Đang đặt chung màn hình phép | Duyệt, ghi nhận chi, khấu trừ/đối soát tại tiền lương; chặn khấu trừ hai lần |
| Chứng từ | Có tải lên/tải xuống | Gỡ chứng từ nháp theo quyền; chứng từ đã dùng trong duyệt giữ lịch sử và phiên bản |
| Binding, tự động hóa, thông báo | Có cấu hình/chạy lại/đánh dấu đã đọc | Binding sửa cho lần gửi mới; instance đang chạy giữ cấu hình; job chạy lại an toàn; audit không CRUD thông thường |

Tất cả thao tác phải có API, UI, kiểm tra quyền backend, phạm vi tenant và trạng thái nghiệp vụ. Không chỉ thêm nút sửa/xóa.

## 5. Menu và giao diện

| Nhóm | Màn hình lá / route đề xuất |
|---|---|
| Tổng quan | Bàn làm việc `/`, lịch và thông báo `/calendar` |
| Cá nhân | Hồ sơ `/profile`, chấm công `/attendance`, đơn của tôi `/requests`, phiếu lương `/payslips` |
| Nhân sự | Nhân viên/chức danh `/employees`, người phụ thuộc `/dependents` |
| Công và phép | Ca/phân ca `/shifts`, bảng công `/timesheets`, phép và loại nghỉ `/leave-settings` |
| Tiền lương | Bảng lương `/payroll`, cấu hình `/payroll/settings`, tạm ứng `/payroll/advances` |
| Duyệt và vận hành | Hộp duyệt `/approvals`, quy trình/tự động hóa `/operations` |
| Cấu hình | Cấu hình chấm công `/policies`, danh mục quyền `/permissions` |

- Gộp “Chính sách nhân sự” và “Thiết bị & Tích hợp” vào **Cấu hình chấm công**, có tab Quy định, Lịch nghỉ, Địa điểm/IP/GPS, Thiết bị. Tab lưu trên URL để truy cập lại đúng ngữ cảnh.
- Nhóm cha chỉ mở/đóng; chỉ một menu lá active. `/payroll/settings` không làm `/payroll` active.
- Chuyển phần tạm ứng khỏi quỹ phép sang route riêng nêu trên. Hồ sơ hợp đồng nằm trong chi tiết nhân viên, không tạo thêm menu rời.
- Quyền theo từng tab/hành động; chuyển route không vượt quyền. Tìm kiếm, lọc và phân trang phù hợp màn hình dữ liệu dày.
- Theo UI chung: SearchableSelect, bảng antd khi phức tạp, Dialog cho form, Drawer cho chi tiết/lịch sử, Popconfirm cho thao tác ảnh hưởng dữ liệu. Không dùng emoji.

## 6. Thứ tự triển khai và điều kiện nghiệm thu

1. Hợp nhất source và schema: giữ phần riêng của cả hai, xử lý identity/migration, khôi phục route mất decorator. Build được các ứng dụng liên quan.
2. Thống nhất bridge/sync: test quy trình nhiều bước, điều kiện động ngay khi khởi tạo, quyền người duyệt, timeout/thử lại, sự kiện lặp/sai tenant, sự kiện đến sớm, kỳ khóa, hủy và đơn cũ.
3. Sửa menu và CRUD theo ma trận: test route active, quyền, vòng đời sửa/xóa, xung đột cập nhật và các tác động công/phép/lương.
4. Chạy ERP qua gateway và thao tác trình duyệt: nhân viên giả, ca ngày/đêm/OFF/lễ, nhiều lần vào-ra, nghỉ/OT/công tác/đổi ca/điều chỉnh/tạm ứng, chốt công rồi tính lương. Lưu ID dữ liệu thử để đối soát, không xóa dữ liệu sẵn có.
5. Báo cáo từng chức năng: API + UI, đầu ra thực tế, ca đạt/chưa đạt, hướng dẫn thao tác. Chỉ đánh dấu hoàn thành khi có bằng chứng tương ứng; cập nhật Jira sau khi chốt với người dùng.

Mỗi lỗi: lưu bước tái hiện, tạo test thất bại đúng nguyên nhân, sửa, chạy lại test và kiểm tra luồng ảnh hưởng. Kiểm tra migration cả tenant mới và tenant đã có dữ liệu; kiểm tra chạy provisioning lại không tạo dữ liệu trùng.

Ca kiểm thử bổ sung từ lượt rà soát: kết thúc Procedure cho từng loại đơn, đặc biệt OT/công tác/tạm ứng không lỗi thiếu cột; thiếu actor hợp lệ không gây lỗi ép kiểu UUID; ánh xạ mã loại đơn cũ khớp binding mới; điều chỉnh hồ sơ không ghi đè thay đổi phát sinh trong lúc chờ duyệt. Các ca này chưa chạy, không được đánh dấu đạt từ test registry.

## 7. Phân định đóng góp sơ bộ

- **Hải:** bridge Procedure, biểu mẫu động/thuộc tính bước S, tiến độ xử lý đơn; mở rộng các màn hình chấm công/phân ca, lọc đơn, công tác liên kết dự án và hồ sơ nhân sự.
- **Nhánh Tài:** nhân viên tách tài khoản, RBAC động/HRM, chính sách chấm công và thiết bị, ledger/cộng/chuyển phép, bảng công, công thức lương và kiểm soát chốt kỳ, vận hành tự động và các kiểm soát chống ghi trùng.
- Nhánh remote còn chứa thay đổi Procedure/cơ cấu tổ chức của **Khánh** và các merge chung. Không quy tất cả thay đổi remote cho Hải. Danh sách cuối cùng sẽ đối chiếu theo commit và mã giữ lại sau rebase.

## 8. Trạng thái Git tại thời điểm lập đề xuất

- Đã commit toàn bộ thay đổi trước rebase: `1fbc9da`.
- Nhánh dự phòng: `codex/hrm-before-hai-rebase-20260928`.
- Đang rebase lên `origin/hai_2_rebased_clean` tại `b39f7f9`; còn 12 tệp xung đột, chưa hoàn thành.
- Tài liệu này không khẳng định mã đã sửa hoặc hệ thống chạy được. Chưa khởi động dev/test trình duyệt khi các xung đột chưa giải quyết.
