# HRM ERP-114 — Chức năng, đầu ra và hướng dẫn vận hành

Cập nhật 27/09/2026. Thực hiện trên thư mục chính, nhánh `ngtantai/tenant-dynamic-rbac`. Chưa cập nhật Jira, chưa commit/push. Tài liệu này bổ sung và thay thế phần trạng thái khoảng trống tương ứng trong báo cáo bàn giao trước.

## 1. Phạm vi đã bổ sung trong đợt này

| Chức năng | Đầu ra nghiệp vụ | Màn hình dưới `/modules/hrm` |
|---|---|---|
| Danh mục 51 hành động HRM trong RBAC động | Bộ quyền cấu thành theo nghiệp vụ; tách xem, cấu hình, duyệt, chốt và chi trả; API kiểm tra quyền hiện hành và entitlement | `/permissions`; cấp quyền tại `/authorization` của ERP |
| Phân quyền dữ liệu cá nhân | Người chỉ có quyền cá nhân xem đúng hồ sơ/công/đơn đã liên kết; không đổi employee ID để xem người khác | `/profile`, `/attendance`, `/requests`, `/payslips` |
| Giao diện theo quyền | Menu/trang và các thao tác nghiệp vụ chính hiển thị theo quyền; cập nhật quyền khi lấy lại focus và theo chu kỳ 30 giây; API vẫn là lớp kiểm tra cuối | Toàn HRM |
| Hộp xử lý đơn tập trung | Bảng 7 loại đơn; lọc trạng thái/loại/tìm người; drawer nội dung/chứng từ; duyệt các đơn hợp lệ riêng lẻ hoặc theo danh sách | `/approvals` |
| Quy trình liên module | Đơn nghỉ, OT, đổi ca có thể khởi tạo hồ sơ Procedure; kết quả quy trình áp dụng về HRM một lần; chặn duyệt tắt | `/operations` → Quy trình liên module |
| Theo dõi lỗi tích hợp | Liên kết nguồn–đích, mã hồ sơ, số lần thử, lỗi và thử lại; đơn đã gửi giữ quy trình lúc tạo | `/operations` |
| Rút đơn chờ | Rút được 7 loại đơn chưa được duyệt; quỹ phép được giải phóng; đơn liên kết bị rút không được áp dụng lại bởi callback | `/requests` → Chi tiết → Rút/Hủy |
| Tác vụ phép tự động | Worker ERP tích các tháng đã kết thúc, chuyển năm nếu bật, xử lý hết hạn; khóa chống chạy đồng thời, giao dịch chống cộng trùng, lịch sử thành công/lỗi và con trỏ tháng | `/operations` → Tác vụ phép |
| Sổ quỹ phép | Đối soát đầu kỳ, tích lũy, điều chỉnh, đã dùng, giữ chỗ, còn lại và có thể dùng; giao dịch có căn cứ | `/leave-settings` |
| Công tác theo đầu việc con | Chọn hồ sơ Procedure và subtask thuộc hồ sơ; kiểm tra lại tham chiếu khi gửi | `/requests` → Công tác |
| Lịch cá nhân | Lịch ca, OFF/lễ, nghỉ đã duyệt, công tác và OT trong khoảng chọn, tối đa 63 ngày | `/calendar` |
| Thông báo trong HRM | Lịch sử trạng thái đơn của nhân viên, đánh dấu đã đọc; sự kiện trạng thái đồng thời ghi ra outbox chung | `/calendar` → Thông báo |
| Hồ sơ người phụ thuộc | Đăng ký HR đã xác minh, căn cứ, ngày hiệu lực/kết thúc; chống đăng ký trùng cùng mã trong một khoảng hiệu lực | `/dependents` |
| Người phụ thuộc trong công thức | `REGISTERED_DEPENDENT_COUNT` là số đăng ký còn hiệu lực tại ngày cuối kỳ; lưu ID nguồn và ngày chốt trong snapshot | `/payroll/settings`, `/payroll` |
| Snapshot người nhận lương | Lưu mã/tên nhân viên và thông tin tài khoản khi tính; sửa hồ sơ sau đó không đổi danh sách của lần lương đã chốt | `/payroll` |
| Xuất chi trả và đối soát | CSV từ lần lương FINALIZED, có audit người xuất; danh sách chi trả kiểm tra dữ liệu ngân hàng; bảng khoản lương phục vụ đối soát kế toán | `/payroll` |
| Xuất công có quyền riêng | Kiểm tra `hrm.timesheet.export` tại API, ghi audit và xuất bảng đang lọc trên UI | `/timesheets` |
| Mật độ giao diện | Table nhỏ, số căn theo cột, phân trang/scroll, cột cố định tại các bảng rộng; drawer 660px; dialog biểu mẫu; combobox tìm kiếm; nhãn Ant Design tiếng Việt | Các màn mới và shell chung |
| Worker chạy mã nguồn workspace | Bundling các thư viện nội bộ để Node không cố đọc import `.js` bên trong gói còn trỏ vào source TypeScript | Worker chung của ERP |

### Các nghiệp vụ nền ERP-114 đã có, tiếp tục dùng trong chuỗi trên

| Nghiệp vụ | Đầu ra |
|---|---|
| Nhân viên và tài khoản | Hồ sơ nhân viên tồn tại độc lập tài khoản; một tài khoản liên kết một nhân viên trong tenant; lịch sử công/phép/lương giữ nguyên ID |
| Ca ngày/đêm, giờ nghỉ, phân ca và đổi ca | Cửa sổ làm việc qua nửa đêm, dung sai, lịch hiệu lực không trùng; đổi ca được duyệt cập nhật lịch |
| Quy định công và lịch doanh nghiệp | Timezone, IP cho phép, địa điểm GPS/bán kính/sai số, trình duyệt đã duyệt, WORK/OFF/HOLIDAY và hưởng lương |
| Nhiều phiên vào-ra và giải trình | Log nguồn bất biến, chống gửi trùng; công thực tế, trễ/sớm, thiếu log và bất thường; sửa bằng đơn có lịch sử |
| Phép theo ngày/giờ, ứng phép | Hạn mức âm; giữ quỹ chờ, dùng khi duyệt, hoàn khi hủy; thâm niên, phân bổ theo ngày vào làm, chuyển năm/hết hạn |
| OT | Đăng ký/duyệt, giới hạn thời lượng, hệ số thường/OFF/lễ/đêm; số được tính tiền không vượt phần được duyệt giao với công thực tế |
| Bảng công tháng | Ma trận nhân viên × ngày, nguồn công/đơn/OT, điều chỉnh có lý do, khóa/mở kỳ có kiểm soát |
| Lương cấu hình | Mức lương có hiệu lực, công thức hạn chế an toàn, tham số cá nhân, khoản bổ sung/khấu trừ, tính/chốt, phiếu cá nhân bất biến |
| Tạm ứng | Duyệt, ghi nhận giải ngân, lập lịch thu hồi; khấu trừ một lần khi chốt lương, hết dư nợ chuyển REPAID |
| Chứng từ | Đăng ký file, tải lên storage, hoàn tất metadata và tải xuống theo quyền/người sở hữu |

## 2. Cấp quyền trong RBAC động

1. Đăng nhập tenant bằng tài khoản quản trị. Tenant phải có entitlement **HRM & Chấm công** đang hoạt động.
2. Vào **HRM → Danh mục quyền HRM**. Tìm theo mã hoặc tên; cột tài khoản hiện tại cho biết quyền hiệu lực của bạn.
3. Chọn **Mở phân quyền ERP**. Trong màn phân quyền chung, tạo/sửa **bộ quyền**, chọn các hành động `hrm.*` cần dùng.
4. Gắn bộ quyền vào **vai trò**. Cấp module `hrm` cho vai trò, sau đó gắn vai trò vào người dùng. Quyền hành động và quyền vào module là hai điều kiện cùng cần có.
5. Đăng nhập bằng tài khoản vai trò cần kiểm tra. Chuyển về tab HRM hoặc tải lại trang để cập nhật menu. Thử URL trực tiếp: API phải từ chối thao tác thiếu quyền dù tự gọi từ bên ngoài UI.
6. Với quyền cá nhân, vào **Nhân sự & Chức danh**, chọn nhân viên và **Liên kết tài khoản** trước. Quản trị viên có quyền nhưng chưa có hồ sơ nhân viên sẽ không tự có công/phép cá nhân.

Không tự cấp 51 quyền cho các vai trò hiện hữu. `hrm.manage` là toàn quyền HRM; chỉ dùng cho vai trò cần quản trị toàn bộ. Quyền `hrm.read` chỉ cho vào module và danh mục dùng chung, không mặc nhiên cho xem bảng lương hay hồ sơ mọi nhân viên.

### Gợi ý bộ quyền để tự tạo và kiểm tra

| Vai trò nghiệp vụ | Hành động nên chọn |
|---|---|
| Nhân viên | `hrm.self.read`, `hrm.self.profile.write`, `hrm.self.attendance`, `hrm.self.request`, `hrm.self.payslip` |
| Nhân sự hồ sơ | `hrm.employee.read`, `hrm.employee.manage`, `hrm.employee.link-account`, `hrm.profile.approve`, `hrm.dependent.manage` |
| Điều phối công/phép | `hrm.shift.manage`, `hrm.time.configure`, `hrm.device.manage`, `hrm.attendance.read`, `hrm.attendance.approve`, `hrm.leave.manage`, `hrm.timesheet.calculate`, `hrm.timesheet.adjust`, `hrm.timesheet.export` |
| Người duyệt đơn | Chọn riêng `hrm.leave.approve`, `hrm.ot.approve`, `hrm.trip.approve`, `hrm.shift.approve`, `hrm.profile.approve`, `hrm.advance.approve` theo trách nhiệm |
| Người khóa công | `hrm.timesheet.read`, `hrm.timesheet.lock`; cấp `hrm.timesheet.reopen` riêng nếu có trách nhiệm mở lại |
| Người cấu hình lương | `hrm.payroll.configure`, `hrm.salary.manage`, `hrm.employee.read`, `hrm.dependent.read` |
| Người tính lương | `hrm.payroll.calculate`, `hrm.payroll.adjust`; không tự có quyền chốt, phát hành hoặc chi trả |
| Người chốt lương | `hrm.payroll.finalize`, `hrm.payroll.publish` |
| Kế toán chi trả | `hrm.payroll.read`, `hrm.payroll.export`, `hrm.payroll.pay`, `hrm.advance.disburse` |
| Vận hành tích hợp | `hrm.automation.manage`, `hrm.integration.manage`, `hrm.audit.read`; cấu hình Procedure cần quyền đọc/thiết kế quy trình ở module đó |

Các quyền ghi tự kéo theo một số quyền đọc cần thiết. Quyền quản lý/xem toàn tenant chưa có phạm vi theo phòng ban hoặc pháp nhân. Không dùng các quyền toàn tenant để giả lập vai trò chỉ quản lý một nhóm. Người duyệt trong Procedure cần được phân vai tại Procedure và có quyền đọc đơn HRM để xem nội dung qua liên kết.

## 3. Thiết lập và thao tác theo thứ tự

### Bước 1 — Hồ sơ và dữ liệu nguồn

1. Mở **Nhân sự & Chức danh → Thêm hồ sơ mới**, nhập mã nhân viên duy nhất, họ tên, ngày vào làm và thông tin nghiệp vụ.
2. Chọn hồ sơ → liên kết đúng tài khoản ERP. Người chưa có tài khoản vẫn phân ca và tính công/lương được.
3. Kiểm tra đơn vị/chức danh, thông tin ngân hàng, mã số thuế và bảo hiểm. Hồ sơ thiếu tài khoản ngân hàng vẫn có thể tính lương; xuất chi trả CSV sẽ bị chặn nếu snapshot lúc tính thiếu ngân hàng/tài khoản.
4. Tại phần lương nhân viên, khai báo mức lương, GROSS/NET, tiền tệ và ngày hiệu lực. Quyền xem hồ sơ nhân viên không đồng nghĩa được sửa mức lương.

### Bước 2 — Ca, lịch và chấm công

1. Vào **Quản lý Ca & Chấm công**, tạo ca: mã, giờ vào/ra, qua đêm, thời gian nghỉ, dung sai. Gán nhân viên và ngày hiệu lực; không để hai phân ca có hiệu lực trùng nhau.
2. Vào **Chính sách nhân sự / Cấu hình công và thiết bị**. Khai báo ngày bắt đầu chính sách, múi giờ, yêu cầu IP/GPS/thiết bị, dung sai GPS; khai báo địa điểm và bán kính.
3. Khai báo lịch WORK/OFF/HOLIDAY, tên ngày, có hưởng lương hay không. Đây là lịch chung tenant ở phiên bản hiện tại.
4. Nhân viên vào **Chấm công**, đăng ký trình duyệt nếu chính sách yêu cầu. Người có `hrm.device.manage` duyệt hoặc thu hồi đăng ký trong màn cấu hình.
5. Nhấn vào/ra đúng từng phiên. Thiếu hoặc sai log: gửi **Giải trình / Bổ sung công**, khai báo đầy đủ các phiên và căn cứ. Người được quyền duyệt kiểm tra trước khi áp dụng.

Đầu ra cần đối soát: ngày công theo timezone, số phút làm việc, trễ/sớm, log nguồn và bất thường. “Một thiết bị” hiện là một đăng ký trình duyệt bằng cookie; không phải chứng thực phần cứng không thể giả mạo.

### Bước 3 — Quỹ phép và chạy tự động

1. Vào **Quỹ phép & Ứng lương → Thêm loại nghỉ**. Chọn ngày/giờ, hưởng lương, trừ quỹ, chứng từ, hạn mức âm và quy tắc chuyển năm.
2. Chọn **Lịch cộng phép**: loại nghỉ, hiệu lực, tháng/quý/năm, định mức, phân bổ theo ngày vào làm, mốc/số phép thâm niên. Các định mức do doanh nghiệp xác nhận.
3. Xem **Quỹ và sổ giao dịch phép**: chọn năm và nhân viên. `Có thể dùng = Còn lại − Giữ chỗ`; hạn mức âm được kiểm tra thêm khi gửi đơn.
4. Chọn **Điều chỉnh quỹ** khi cần nhập số dư hoặc điều chỉnh: nhập cộng/dương hoặc trừ/âm, đúng đơn vị loại nghỉ, năm và lý do. Dialog gửi mã chống lặp cho cùng thao tác.
5. Chạy **Cộng phép tháng**, **Chuyển phép năm**, **Hết hạn phép chuyển** thủ công để đối soát lần đầu.
6. Vào **Vận hành & Tích hợp → Tác vụ phép → Cấu hình lịch**. Chọn tháng bắt đầu, múi giờ, giờ chạy và việc chuyển năm tự động; bật sau khi lịch/định mức được kiểm tra. Mặc định chưa bật cho tenant.
7. **Chạy đối soát ngay** dùng cùng nghiệp vụ với worker. Đọc dòng thành công/lỗi và mở chi tiết; lần chạy lại không cộng trùng giao dịch đã ghi. Khi thay đổi lịch cộng phép hồi tố, cấu hình lại tháng bắt đầu hoặc chạy tháng cần bổ sung thủ công, không tự sửa giao dịch đã chốt.

### Bước 4 — Đơn từ và phê duyệt

1. Nhân viên vào **Đơn từ & Yêu cầu**, chọn nghỉ phép/OT/công tác/đổi ca/giải trình/tạm ứng/điều chỉnh hồ sơ.
2. Nhập ngày giờ, lý do và chứng từ nếu yêu cầu. Công tác: chọn hồ sơ Procedure rồi chọn đầu việc con phù hợp. OT phải có quy định tăng ca hiệu lực trước khi gửi.
3. Gửi và xem tab chờ/lịch sử. Đổi ca với đồng nghiệp cần người đổi cùng xác nhận. **Rút/Hủy đơn** chỉ xử lý đơn chưa duyệt; thay đổi đơn đã duyệt cần người có quyền xử lý và phải tôn trọng kỳ công/lương đã khóa.
4. Người duyệt mở **Xử lý Đơn từ**, lọc loại và trạng thái; mở **Chi tiết**, kiểm tra thời gian, lượng phép/OT/số tiền và chứng từ.
5. Đơn duyệt trực tiếp: chọn **Duyệt** hoặc **Từ chối**; các đơn đủ điều kiện có thể chọn nhiều dòng. Lô duyệt dừng tại lỗi và báo số đã xử lý, không ngầm coi cả lô thành công.
6. Đơn có liên kết Procedure: xử lý tại hồ sơ quy trình; nút duyệt trực tiếp bị ẩn và API/transaction cũng chặn bỏ qua quy trình.

### Bước 5 — Kết nối Procedure Engine

1. Bật Procedure Engine cho tenant, công bố quy trình phù hợp và phân vai các bước. Dùng quy trình phê duyệt có điểm kết thúc rõ ràng; không mặc định chọn một quy trình bảo trì chỉ vì nó có sẵn.
2. Vào **Vận hành & Tích hợp → Quy trình liên module → Cấu hình quy trình**.
3. Chọn một trong **Đơn nghỉ / Tăng ca / Đổi ca**, chọn quy trình đã công bố và bật áp dụng cho đơn mới. Đơn đổi ca đôi chỉ được đưa sang quy trình sau xác nhận của người đổi cùng.
4. Gửi một đơn mới. Theo dõi QUEUED → RUNNING và mã hồ sơ Procedure. Khi Procedure hoàn tất, worker áp dụng kết quả → APPLIED. FAILED hiển thị lỗi, có **Thử lại**.
5. Trong chi tiết hồ sơ Procedure, nguồn **Đơn HRM** có liên kết mở đơn tương ứng để xem nội dung/chứng từ.
6. Nếu rút đơn HRM đang xử lý, HRM không áp dụng kết quả đến muộn. Hồ sơ Procedure đã khởi tạo chưa tự hủy đồng bộ; người phụ trách phải xử lý kết thúc hồ sơ đó tại Procedure.

Yêu cầu vận hành: worker, RabbitMQ, Procedure API và `INTERNAL_SERVICE_TOKEN` phải được cấu hình nhất quán. Không nhập token trên form HRM. Chưa cấu hình token thì liên kết báo lỗi cụ thể, không tự chuyển thành duyệt trực tiếp.

### Bước 6 — Lịch và thông báo cá nhân

1. Mở **Lịch & Thông báo**, chọn từ/đến ngày tối đa 63 ngày và tải dữ liệu.
2. Kiểm tra ca, nghỉ, công tác, OT và ngày nghỉ/lễ; đơn nghỉ/công tác/OT chỉ đưa vào lịch khi đã duyệt.
3. Chuyển tab thông báo, đọc trạng thái và đánh dấu đã đọc. Chỉ thấy thông báo thuộc nhân viên liên kết tài khoản hiện tại.

Đây là lịch/thông báo bên trong HRM. Outbox đã ghi sự kiện cho nền tảng; chưa đồng nghĩa có email, push/mobile hoặc đồng bộ Google/Outlook Calendar.

### Bước 7 — Người phụ thuộc và công thức lương

1. Người có quyền quản lý mở **Người phụ thuộc → Thêm đăng ký**.
2. Chọn nhân viên, mã định danh hồ sơ ổn định, tên, quan hệ, ngày sinh, mã số thuế nếu có, căn cứ đã xác minh và thời gian đăng ký. Cùng mã hồ sơ không được trùng hiệu lực trên một nhân viên.
3. Khi ngừng đăng ký, chọn **Kết thúc**, nhập ngày cuối còn hiệu lực và lý do. Hệ thống chặn thay đổi ảnh hưởng kỳ lương đã chốt; kỳ chưa chốt bị yêu cầu tính lại.
4. Trong **Cấu hình lương**, dùng `REGISTERED_DEPENDENT_COUNT` nếu chính sách doanh nghiệp tính số người phụ thuộc theo ngày cuối kỳ. Tham số này do hệ thống cấp, không nhập đè trong tham số cá nhân.
5. Số tiền giảm trừ, tỷ lệ bảo hiểm, biểu thuế và các điều kiện được hưởng vẫn phải khai báo bằng phiên bản công thức/tham số được HR và kế toán xác nhận. Việc HR nhập hồ sơ không phải xác nhận đã đăng ký thành công với cơ quan thuế.

### Bước 8 — Công tháng, lương và chi trả

1. Vào **Bảng công tổng hợp**, tạo kỳ đã kết thúc → **Tính công**. Xem ma trận và chi tiết; xử lý đơn, log thiếu hoặc điều chỉnh có lý do trước khi khóa.
2. Xuất CSV để đối soát; bộ lọc tìm kiếm hiện tại được áp dụng vào dữ liệu xuất. Người có quyền khóa chọn **Khóa kỳ**.
3. Vào **Cấu hình lương**: chọn ngày hiệu lực, GROSS/NET, định mức phút chuẩn cả kỳ, các khoản lương/OT/phụ cấp/thuế/bảo hiểm/khấu trừ/thực lĩnh. Tham số riêng nhân viên có hiệu lực riêng.
4. Với người vào giữa kỳ, khai báo định mức phút của cả kỳ; không lấy số ngày còn lại sau khi vào làm làm mẫu số cho cả lương tháng.
5. Vào **Tiền lương & Chi trả**: tạo kỳ khớp bảng công đã khóa, thêm lần tính → **Tính lương**. Kiểm tra khoản chi tiết, thực lĩnh, tạm ứng, người phụ thuộc và snapshot ngân hàng.
6. Thêm khoản điều chỉnh có căn cứ nếu cần, tính lại và đối soát. Người được quyền riêng **Chốt lương** sau khi số liệu đạt yêu cầu.
7. Phát hành phiếu. Nhân viên vào **Phiếu lương** để xem/in/lưu PDF qua trình duyệt.
8. **Xuất chi trả CSV** chỉ dùng cho lần lương đã chốt và có snapshot ngân hàng đầy đủ. **Xuất đối soát khoản lương** tạo các dòng nguồn để kế toán kiểm tra. CSV là cấu trúc chung, chưa phải template upload của từng ngân hàng và không thực hiện chuyển tiền/hạch toán. Khi nhập vào Excel, đặt cột số tài khoản là **Text** để giữ số 0 ở đầu; danh sách có cả trạng thái đã chi trả để đối soát, không gửi toàn bộ danh sách như một lệnh thanh toán mới.
9. Sau khi chi trả bên ngoài, ghi **Mã chứng từ / giao dịch ngân hàng** tại dòng nhân viên. Thao tác ghi nhận là đối soát, không gọi ngân hàng chuyển tiền.

## 4. Kiểm tra nghiệm thu tối thiểu

- Nhân viên A không đọc/sửa đơn, công, hồ sơ hoặc phiếu lương của B bằng cách đổi ID.
- Vai trò chỉ tính lương: tính được, không chốt/phát hành/chi trả; vai trò chỉ xem không thấy thao tác ghi tương ứng.
- Thu hồi quyền hoặc module: request mới bị từ chối, không dựa riêng vào quyền cũ trong token.
- Đơn giữ quỹ → rút → quỹ trở lại; gửi lại/callback lặp không trừ/hoàn hai lần.
- Procedure: thử thành công, từ chối, lỗi liên kết, thử lại và rút đơn trước kết quả.
- Tác vụ phép: chạy lại cùng tháng, qua năm, hết hạn, người vào giữa kỳ và lịch thâm niên.
- Công: ca đêm, nhiều IN/OUT, thiếu OUT, OFF/lễ, phép giờ, công tác, OT và bất thường; sửa nguồn sau khóa bị chặn.
- Lương: công đã khóa, giữa kỳ, tham số có hiệu lực, người phụ thuộc đầu/cuối hiệu lực, tạm ứng; sửa nguồn buộc tính lại; chốt xong snapshot/phiếu không đổi.
- CSV chi trả giữ tài khoản tại lúc tính; dữ liệu thiếu bị chặn; quyền xuất có audit.
- HR/kế toán đối soát ít nhất một kỳ mẫu với cách tính hiện hành và ghi nhận chênh lệch, chưa đóng ERP-119 chỉ vì build/test đạt.

## 5. Phần chưa thể coi là hoàn tất

- Ca xoay kíp hàng loạt, nhiều ca rời/nhiều khoảng nghỉ một ngày và lịch riêng từng pháp nhân/đơn vị chưa được bổ sung trong đợt này.
- Workflow dùng chung mới nối ba loại nghỉ/OT/đổi ca; công tác, giải trình, sửa hồ sơ và tạm ứng vẫn duyệt trực tiếp theo quyền. Chưa đồng bộ hủy ngược sang Procedure.
- Phạm vi quyền theo phòng ban/pháp nhân, ủy quyền theo thời gian và phân tách bắt buộc người lập/người chốt chưa có. Quyền hiện phân biệt cá nhân với toàn tenant.
- Gross-up tự động, mẫu chuyển khoản riêng từng ngân hàng, hạch toán/đối soát module kế toán, PDF sinh/lưu qua File service và bộ chính sách pháp định đã xác nhận còn thiếu.
- Hồ sơ người phụ thuộc mới quản lý đăng ký và căn cứ HR xác minh; chưa khai báo điện tử cơ quan thuế hoặc quản lý hồ sơ scan riêng.
- Chưa quét mã độc chứng từ; chưa xác nhận định danh thiết bị vật lý; chưa kiểm thử tải, mọi tình huống đồng thời, hay UAT toàn luồng bằng nhiều tài khoản thật.

Các mục này giữ trạng thái còn việc, không tự chuyển thành Done trên Jira. Tuyển dụng/hợp đồng/đánh giá/KPI/OKR thuộc các giai đoạn sau, không được đánh dấu đã triển khai ở ERP-114.

## 6. Chạy và migration

Đã áp dụng HRM `0012-operations-and-workflow` và `0013-payroll-support` trên tenant local có entitlement HRM active; migration cũ giữ nguyên. Tenant mới dùng cùng registry khi cấp module.

```powershell
cd D:\data\savina\enterprise-platform
pnpm infra:up
pnpm nx run migrator:hrm-migrate
pnpm dev
```

Nếu đang chạy dev thì dừng lượt cũ trước khi chạy lại. Không cần `pnpm db:provision` cho việc nâng cấp riêng HRM trên môi trường đã provision. Mở `http://localhost:8080/modules/hrm` qua gateway chung. Tác vụ phép mặc định chưa bật; không chạy trên dữ liệu thật trước khi kiểm tra chính sách.

## 7. Danh mục quyền đầy đủ

Danh mục được sinh từ cùng nguồn dùng bởi API RBAC và UI; xem tệp `HRM-RBAC-actions.md` trong thư mục này.

## 8. Bằng chứng kiểm tra sau bổ sung

| Kiểm tra | Kết quả thực tế |
|---|---|
| HRM unit và PostgreSQL integration | **42/42 tests đạt**, 6 suites. Database thử riêng được tạo/dọn; có kiểm tra quyền và phạm vi cá nhân, workflow callback chống lặp, worker phép, người phụ thuộc buộc tính lại lương chưa chốt, snapshot chi trả và rút đơn |
| RBAC `platform-identity:test --testPathPatterns=tenant-authorization` | **20 tests đạt, 14 bỏ qua** do nhóm integration này cần môi trường DB riêng. Không khẳng định 14 test đó đã chạy |
| Migration registry | **5 tests đạt**; `0012`, `0013` đã áp dụng local |
| Build | HRM API, HRM web, worker, API chung và Procedure API/web đạt. HRM API/web/worker được build lại sau các thay đổi liên quan; HRM web build lần cuối sau chỉnh biểu mẫu/Drawer |
| Lint và TypeScript | `feature-hrm`, `module-hrm`, `worker` đạt; **0 lint errors, 54 warnings** ở phần backend được kiểm tra |
| React Doctor phạm vi feature HRM | **0 errors, 145 warnings**; vẫn còn nợ về tổ chức component/typing và tối ưu giao diện, không tuyên bố toàn bộ UI đã sạch cảnh báo |
| Worker runtime | Một phiên `pnpm dev` chung đang chạy. RabbitMQ `hrm.integrations.v1` có **1 consumer**, không còn lỗi import workspace `.js`. Tác vụ phép của tenant đang tắt và không được tự bật trong QA |
| RBAC trên UI có xác thực | Tài khoản quản trị đang đăng nhập; màn danh mục có **51 hành động HRM**. Mở **Vai trò & Phân quyền → Permission → Tạo permission**, xác nhận các hành động HRM xuất hiện trong danh mục chung 69 hành động; đóng không lưu |
| Giao diện nghiệp vụ | Đã đọc các màn vận hành/quy trình, người phụ thuộc, xử lý đơn, quỹ phép, lương, lịch và danh mục quyền; mở biểu mẫu liên kết Procedure/người phụ thuộc không lưu. Kiểm tra bố cục **1600×900** và kích thước panel hiện tại; sửa padding biểu mẫu và API Drawer bị deprecated |
| Dữ liệu tenant hiện tại | Các bảng HRM được xem chưa có dữ liệu nghiệp vụ. Tài khoản đang đăng nhập chưa liên kết hồ sơ nhân viên; lịch cá nhân hiển thị thông báo đúng. Không tự tạo hồ sơ, cấp quyền, duyệt đơn hoặc chạy lương trong QA |

Giới hạn: bộ test đầy đủ của `platform-identity` còn lỗi có sẵn ở `platform-access-decision.spec` (harness Jest/ESM `jose` và các kỳ vọng API cũ); không sửa hoặc bỏ qua lỗi bằng mock để báo đạt. Kiểm thử luồng Procedure có mock đầu nối trong integration test; chưa chạy toàn bộ thao tác phê duyệt thực qua trình duyệt và broker. Storage và nhiều vai trò thật vẫn cần UAT như mục 4–5.

Báo cáo máy tại `outputs/hrm-final-tests.txt`, `outputs/hrm-final-build.txt`, `outputs/hrm-final-ui-build.txt`, `outputs/hrm-expansion-final-check.txt`, `outputs/hrm-expansion-react-doctor.json`. Log dev tại `outputs/hrm-final-dev.log`. Không chạy thêm `pnpm dev` khi phiên này đang hoạt động; nếu cần tự quản lý terminal, dừng phiên đang chạy rồi khởi động một phiên duy nhất.

**Bước tiếp theo trên tenant:** tạo/liên kết hồ sơ nhân viên thực, thiết lập vai trò HR/công/lương theo bảng gợi ý, cấu hình ca và phép trước khi chạy một kỳ mẫu. Không tự đóng ERP-114/ERP-119 hoặc cập nhật Jira từ các kết quả kỹ thuật trên.
