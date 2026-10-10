# Rà soát và đề xuất tái cấu trúc menu HRM (giai đoạn kiểm kê, chưa đổi code)

Ngày lập: 09/10/2026. Nhánh: `dev/release`.
Phạm vi giai đoạn này: chỉ đọc source, phân tích và đề xuất. **Không sửa code, không xóa menu/API/bảng, không đổi database, không chạy migration** trong giai đoạn kiểm kê này. Tài liệu này và thư mục `docs/hrm-audit/` là các file tài liệu mới duy nhất được thêm.

## 0. Phương pháp, độ tin cậy và giới hạn

- Năm mảng được đọc song song bằng phân tích tĩnh: giao diện (menu, route, màn hình), API nhân sự, API chấm công/nghỉ phép/đơn từ, API lương, và cơ sở dữ liệu + luồng nghiệp vụ + phân quyền. Chi tiết từng endpoint, từng bảng và bằng chứng (file, dòng) nằm ở năm báo cáo đính kèm:
  - [A. Menu, route, màn hình](hrm-audit/A-frontend-menu-route.md)
  - [B1. API nhân sự và tổ chức (72 endpoint)](hrm-audit/B1-backend-nhan-su.md)
  - [B2. API ca, chấm công, bảng công, nghỉ phép, đơn từ (139 endpoint)](hrm-audit/B2-backend-cong-phep-don.md)
  - [B3. API lương (56 endpoint)](hrm-audit/B3-backend-luong.md)
  - [C. Cơ sở dữ liệu, luồng dữ liệu, phân quyền (72 bảng, 267 route)](hrm-audit/C-du-lieu-luong-phan-quyen.md)
- **Chưa chạy hệ thống thật.** Mọi kết luận là từ đọc code và SQL. Chỗ nào không chứng minh được từ code đều ghi "chưa xác minh". Ba điểm tôi đã tự đối chiếu lại trong code sau khi nhận báo cáo: lịch định kỳ không được hàm xác định loại ngày đọc (mục 6, P0-1), cờ "có lương" của ngày lễ theo phạm vi không được bảng công đọc (P0-2), và các chỗ guard API mặc định chỉ ghi nhật ký.
- Giới hạn đã biết của phần giao diện: bốn màn rất dài (Đơn từ, Nhân sự, Hồ sơ, Cấu hình công) được đọc ở mức cấu trúc, endpoint và các phần chính, chưa đọc từng dòng form; chưa dò từng thẻ `<select>` thô nên chưa kết luận được mức tuân thủ quy chuẩn UI trong `AGENTS.md`.
- Giá trị `HRM_ACCESS_GUARD_MODE` ở môi trường triển khai thật, việc tenant nào đã bật tách nhiệm vụ lương, và việc dữ liệu phân ca cũ đã được chuyển sang lịch mới trên prod là **chưa xác minh**.

## 1. Danh mục toàn bộ menu và chức năng hiện có

Menu hiện có đúng **20 mục, 20 route, 20 màn hình** (khớp 1-1, không mục giả, không mục con, không redirect, không trang ngoài menu). Nhóm hiện tại trên giao diện: Tổng quan (1), Cá nhân (5), Vận hành (9), Quản trị và hệ thống (5).

Quyền ghi theo kiểu "any" (có một trong các quyền là thấy menu). Trạng thái: **HC** = hoàn chỉnh, **HC\*** = hoàn chỉnh nhưng có lỗi hoặc khiếm khuyết (nêu bên cạnh), **Thiếu** = thiếu so với tên/nhiệm vụ, **CXM** = chưa xác minh.

| Mã | Menu hiện tại | Route | Component (trong `packages/features/hrm/src/lib/screens/`) | Nghiệp vụ thực tế | API và dữ liệu chính | Quyền (menu / thao tác) | Trạng thái | Trùng hoặc phụ thuộc | Đề xuất |
|---|---|---|---|---|---|---|---|---|---|
| F-01 | Bàn làm việc | `/` | `dashboard-screen.tsx` | Chấm công nhanh, số đơn chờ duyệt, thẻ kỳ công/kỳ lương, tình hình chấm công hôm nay, lối tắt cấu hình | `/dashboard/overview`, `/my-attendance-context`, `/timesheet-periods`, `/payroll-periods`, check-in/out | `self.read` hoặc `dashboard.read` | HC\*: link Procedure sai, tham số `?type=` bị bỏ qua, số kỳ công/lương sai khi thiếu quyền (lỗi 403 bị nuốt), 3 vùng hiện cho mọi người, nút chấm công không gắn quyền | Chồng một phần với F-02, F-12, F-13 (chỉ là lối tắt) | **Sửa**: hiển thị theo quyền/vai trò, sửa link, chỉ gọi API khi có quyền |
| F-02 | Lịch và Thông báo | `/calendar` | `hrm-calendar-screen.tsx` | Lịch cá nhân theo khoảng ngày + tiến độ phê duyệt đơn. **Không có thông báo** | `/my-calendar`, `/request-workflows` | `self.read` | Thiếu: tên nói có thông báo nhưng `/my-notifications` không có UI; `/request-workflows` trả toàn tenant cho người có `request.read` | Khác F-11 (đó là quản trị phân ca) | **Đổi tên** "Lịch của tôi"; bổ sung thông báo (P1) hoặc bỏ chữ "Thông báo" |
| F-03 | Chấm công | `/attendance` | `attendance-screen.tsx` | Chấm công vào/ra cá nhân, ma trận tháng, giải trình công, đăng ký trình duyệt | `/my-attendance`, `/my-attendance-context`, `/leave-requests` (không lọc), `/attendance/check-in|out`, `/attendance-corrections` | `self.read` / `self.attendance`, `self.request` | HC\*: gọi danh sách đơn nghỉ không lọc theo nhân viên nên người có `request.read` thấy đơn cả tenant trong lịch của mình | Cùng component ma trận với F-13; khác nghiệp vụ (xem mục 5) | **Đổi tên** "Chấm công của tôi"; sửa lọc `employee_id` |
| F-04 | Đơn từ và Yêu cầu | `/requests` | `requests-screen.tsx` (5477 dòng) | Tạo, theo dõi, rút đơn của chính mình | 7 danh sách đơn, `/request-workflows`, `/requests/:kind/:id/withdraw`, v.v. | `self.read` / `self.request` | Thiếu/lỗi: chỉ tạo được 4/7 loại (thiếu đổi ca, tạm ứng, đính chính hồ sơ dù form đã có); `leave-day-preview` gọi endpoint không tồn tại; nút xuất lịch sử giả; phân trang giả; không có nháp | Cùng dữ liệu với F-12 (khác vai trò) | **Đổi tên** "Đơn từ của tôi"; **bổ sung** lối vào 3 loại đơn; sửa/loại bỏ nút giả |
| F-05 | Hồ sơ của tôi | `/profile` | `profile-screen.tsx` (2513 dòng) | Xem/sửa hồ sơ, giấy tờ, người thân, lịch sử công tác | `/my-profile` (PATCH), `/my-dependents`, tài liệu | `self.read` / `self.profile.write` | HC\*: sửa **trực tiếp** họ tên, ngày sinh, CCCD không qua duyệt, mâu thuẫn với đơn đính chính | Chồng với đơn đính chính (F-04/F-12) | **Giữ**, **hợp nhất** hai đường sửa (quyết định nghiệp vụ, mục 8) |
| F-06 | Phiếu lương | `/payslips` | `payslips-screen.tsx` | Phiếu lương đã phát hành của chính mình, in/PDF | `/my-payslips` | `self.payslip` | HC\*: tiêu đề shell sai ("Bàn làm việc") | Cùng nguồn với F-14 (khác góc nhìn: bản chụp đóng băng) | **Đổi tên** "Phiếu lương của tôi"; sửa tiêu đề |
| F-07 | Nhân sự và Chức danh | `/employees` | `employees-screen.tsx` (2638 dòng) | 4 tab: nhân viên, chức danh, ngạch/bậc lương, cấu hình lương cá nhân; drawer có giấy tờ, người thân, **hợp đồng**, báo cáo trực tiếp | `/employees*`, `/positions`, `/salary-grades*`, `/employees/:id/contracts`, `/salary-profiles`... | `employee.read` / `employee.manage`, `salary.*`, `appointment.manage` | HC\*: nút Xuất Excel giả; danh sách trả cả CCCD, MST, BHXH, số tài khoản; trộn nhân sự và lương | Hai tab lương trùng nghiệp vụ với F-18; hợp đồng chỉ có trong drawer | **Chia**: nhân viên, chức danh vào nhóm Nhân sự; ngạch/bậc và hồ sơ lương chuyển sang Cấu hình lương |
| F-08 | Người phụ thuộc | `/dependents` | `dependents-screen.tsx` | Đăng ký người phụ thuộc đã xác minh (giảm trừ thuế) | `/dependents*` -> `employee_dependents` | `dependent.read` / `dependent.manage` | HC | Khác bảng với "người thân" tự khai (`employee_family_members`) nhưng tên giống | **Giữ**, ghi chú rõ khác biệt; đổi tên "Người phụ thuộc (giảm trừ thuế)" |
| F-09 | Quyết định nhân sự | `/personnel-decisions` | `personnel-decisions-screen.tsx` | Bổ nhiệm, thăng chức, điều chuyển, kiêm nhiệm, miễn nhiệm, đổi quản lý, kèm đổi lương | `/personnel-decisions*` | `appointment.read` / `.manage` / `.approve` | HC\*: không có phạm vi duyệt theo tổ chức; áp dụng nhiều bước không atomic; không có loại thôi việc | Chồng với F-07 (đổi lương, nghỉ việc đi đường khác) | **Giữ**; sửa theo mục 6 |
| F-10 | Danh mục ca làm việc | `/shifts` | `shifts-screen.tsx` | CRUD danh mục ca (nguồn duy nhất giờ ca) | `/shifts` | `shift.read` hoặc `shift.manage` | HC (UI không có xóa dù API có) | Khác F-11 | **Giữ** (đã đổi tên đúng) |
| F-11 | Phân ca làm việc | `/work-schedules` | `work-schedule-screen.tsx` + `ui/work-schedule/*` | Lịch tháng/tuần, gán 1 người/hàng loạt/phòng ban/toàn công ty, lịch định kỳ không kết thúc, mẫu tuần, ngoại lệ, lễ/Tết, nhật ký, xuất CSV | `/work-schedules/*`, `/work-schedule-templates`, `/work-schedule-holidays`, `/shift-units` | `schedule.read` / `.manage` / `.bulk` / `.calendar` | HC\*: mới, chưa commit; SQL chưa kiểm chứng đủ trên DB thật; **2 lỗi của tôi** (P0-1, P0-2) | Lịch lễ trùng với F-17; ngày nghỉ tuần trùng với F-17 | **Giữ**; sửa P0-1, P0-2 |
| F-12 | Xử lý Đơn từ | `/approvals` | `approvals-screen.tsx` | Hộp duyệt 7 loại đơn, duyệt/từ chối, duyệt hàng loạt, hủy hiệu lực, đi theo Procedure Engine | 7 danh sách (`forApproval=1`), `/…/approve|reject`, `/requests/:kind/:id/actions|reverse` | `request.read` hoặc `advance.read`; thao tác theo `*.approve` | HC\*: không hiện mã nhân viên; link `?type=` bị bỏ qua | Cùng dữ liệu với F-04; backend duyệt DIRECT là nhiều bộ riêng theo loại | **Giữ**, đổi tên "Đơn từ cần xử lý" |
| F-13 | Bảng công tổng hợp | `/timesheets` | `timesheets-screen.tsx` | Kỳ công: tạo, tính, khóa, mở lại, điều chỉnh, xuất | `/timesheet-periods*`, `/timesheets*` | `timesheet.*` | HC\*: ma trận tự gán giờ vào/ra giả 08:00/17:30; nút Export của ma trận giả | Tính cùng thuật toán với chấm công ngày (tính hai lần) | **Giữ**; sửa giờ giả, nút giả |
| F-14 | Tiền lương và Chi trả | `/payroll` | `payroll-screen.tsx` | Kỳ lương: tạo, tính, chốt, phát phiếu, điều chỉnh, ghi nhận chi trả, xuất | `/payroll-periods*`, `/payroll-runs*`, `/payroll-totals/:id/record-payment` | `payroll.*` | HC\*: **không có bước duyệt**; chốt trừ nợ ứng cho cả nhân viên ngoài lần tính; SoD không áp cho chi trả | Phiếu lương F-06 là bản chụp của dữ liệu này | **Giữ**; sửa theo mục 6; quyết định về bước duyệt (mục 8) |
| F-15 | Ứng và Thu hồi lương | `/payroll/advances` | `advances-screen.tsx` | Giải ngân và lập lịch thu hồi khoản ứng | `/salary-advance-requests*`, `/salary-advance-deductions*` | `advance.read` / `advance.disburse` | HC\*: không tạo được đơn ứng từ giao diện nhân viên (F-04 thiếu lối); giải ngân không audit/SoD | Duyệt nằm ở F-12 | **Giữ**; bổ sung lối tạo ở F-04 |
| F-16 | Quỹ phép | `/leave-settings` | `leave-settings-screen.tsx` | Trộn **vận hành quỹ phép** (số dư, sổ cái, điều chỉnh, quyết toán nghỉ việc) và **cấu hình** (loại nghỉ, lịch cộng phép, cộng phép tháng, chốt cuối năm) | `/leave-types`, `/leave-balances`, `/leave-transactions`, `/leave-accruals/run`, `/leave-carryovers/*`, `/leave-settlements`... | `leave.read` / `leave.manage` | HC\*: người có quyền duyệt tự được `leave.read` nên xem quỹ phép cả tenant; hai file giao diện mồ côi gọi endpoint không tồn tại | Chồng với F-19 (chạy cộng phép tự động) | **Chia đôi** thành "Quỹ phép" và "Cấu hình phép năm và loại nghỉ" |
| F-17 | Cấu hình công và Thiết bị | `/policies` | `time-settings-screen.tsx` | 4 tab: quy định chấm công, lịch làm/OFF/lễ, địa điểm GPS, thiết bị | `/time-settings*` | `time.configure` hoặc `device.manage` | HC (quyền GET chưa xác minh) | **Trùng**: lịch lễ cùng bảng `work_calendar` với F-11; ngày nghỉ tuần chồng với mẫu lịch F-11 | **Giữ**; chọn một nguồn lịch lễ (mục 5) |
| F-18 | Cấu hình lương | `/payroll/settings` | `payroll-settings-screen.tsx` | 2 tab: phiên bản công thức lương + OT (có chạy thử), mức lương và tham số theo nhân viên | `/payroll-configuration*`, `/ot-configuration`, `/payroll-dry-run*`, `/employees/:id/payroll-inputs`, `/salary-profiles` | `payroll.configure` | HC\*: không có giao diện cấu hình tách nhiệm vụ lương (SoD) | Mức lương sửa ở 3 nơi (F-07, F-09, F-18) | **Giữ**; thêm tab ngạch/bậc, SoD |
| F-19 | Vận hành và Tích hợp | `/operations` | `operations-screen.tsx` | 3 tab: tự động hóa phép, gán quy trình duyệt (DIRECT/Procedure), nhật ký nghiệp vụ | `/operations*`, `/approval-policy-settings` | `automation.manage`, `integration.manage`, `audit.read` | HC | Chạy phép thủ công ở F-16 trùng mục đích | **Giữ** |
| F-20 | Danh mục quyền HRM | `/permissions` | `hrm-permissions-screen.tsx` | Danh mục quyền (đọc), vai trò mẫu, nút tạo vai trò mẫu | `/api/auth/v1/me`, tạo vai trò mẫu (nền tảng) | `hrm.read` (**mọi người dùng HRM**) | HC\*: hiện cho cả nhân viên thường | Cấp quyền thật ở `/authorization` (ngoài HRM) | **Sửa quyền hiển thị** (chỉ quản trị); giữ |

**Chức năng đã có ở backend nhưng chưa có giao diện** (đối chiếu từng endpoint ở các báo cáo B và A mục E17): thông báo HRM (`/my-notifications`), cấu hình tách nhiệm vụ lương, xem phiếu lương đã phát hành cho nhân sự, dữ liệu chấm công toàn tenant (`GET /attendance`, `attendance-events`), gộp loại nghỉ và đối soát quỹ phép, toàn bộ `/policies/*`, xem chi tiết một lần tính lương, `GET /employees/:id/overview`.

**Mã chết hoặc mồ côi ở giao diện:** hai file quyết toán phép (`leave-settlement-policy-card.tsx`, `hrm-leave-settlement.tsx`) gọi endpoint không tồn tại, panel log chấm công thô (`hrm-raw-attendance-panel.tsx`), component nháp đơn (`HrmRequestDrafts`), nhánh menu "Sắp có", hằng `LEAVE_SETTINGS_TABS`. Chi tiết ở báo cáo A mục C.

**Chức năng giả (chỉ hiện thông báo, không làm gì):** ba nút xuất file (Xuất lịch sử đơn, Xuất Excel hồ sơ nhân sự, Export ma trận chấm công), nút "Đổi tài khoản nhận lương", phân trang lịch sử đơn, ô Tìm kiếm và nút Cài đặt hệ thống trên thanh trên.

## 2. Cấu trúc menu đích (đã đối chiếu với source thực tế)

Cấu trúc A-H bạn đưa ra được giữ làm khung. Các chỉnh sửa và lý do nằm ở cột "Ghi chú" (đều dựa trên phát hiện ở mục 1 và mục 5).

```
A. TỔNG QUAN
   - Bàn làm việc                       [F-01, hiển thị theo quyền/vai trò]

B. KHÔNG GIAN CÁ NHÂN                   (nhóm này cần quyền hrm.self.*)
   - Lịch của tôi                       [F-02]
   - Chấm công của tôi                  [F-03]
   - Bảng công của tôi                  [MỚI - hiện chưa có API cho nhân viên]
   - Đơn từ của tôi                     [F-04, bổ sung 3 loại đơn]
   - Hồ sơ của tôi                      [F-05]
   - Phiếu lương của tôi                [F-06]

C. QUẢN LÝ NHÂN SỰ
   - Danh sách nhân viên                [F-07 tab nhân viên]
   - Chức danh                          [F-07 tab chức danh; phòng ban ở /organization của nền tảng]
   - Người phụ thuộc                    [F-08]
   - Quyết định nhân sự                 [F-09]
   - Hợp đồng                           [hiện chỉ trong drawer nhân viên; tách trang là P2]

D. CHẤM CÔNG VÀ LỊCH LÀM VIỆC
   - Danh mục ca làm việc               [F-10]
   - Phân ca làm việc                   [F-11]
   - Dữ liệu chấm công                  [MỚI giao diện; API đã có, panel cũ bị mồ côi]
   - Bảng công tổng hợp                 [F-13]

E. NGHỈ PHÉP VÀ PHÊ DUYỆT
   - Đơn từ cần xử lý                   [F-12]
   - Quỹ phép                           [F-16 phần số dư, sổ cái, quyết toán]

F. TIỀN LƯƠNG VÀ CHI TRẢ
   - Bảng lương                         [F-14: tính, chốt, phát phiếu, chi trả là các bước trong một màn]
   - Ứng và thu hồi lương               [F-15]

G. BÁO CÁO                              [CHƯA TẠO NHÓM: xem ghi chú]

H. CẤU HÌNH HỆ THỐNG
   - Cấu hình công và thiết bị          [F-17]
   - Cấu hình lương                     [F-18 + ngạch/bậc lương + hồ sơ lương nhân viên + tách nhiệm vụ lương]
   - Phép năm và loại nghỉ              [F-16 phần loại nghỉ, lịch cộng phép, chạy cộng phép]
   - Vận hành và tích hợp               [F-19 gồm nhật ký nghiệp vụ]
   - Danh mục quyền                     [F-20, chỉ hiện cho quản trị]
```

| Điểm khác với cấu trúc tham khảo | Lý do (căn cứ) |
|---|---|
| Thêm "Bảng công của tôi" vào nhóm B | Nhân viên là đối tượng nhận số công nhưng **không có API xem bảng công của chính mình** (vai trò Nhân viên không có `timesheet.read`, B2-61/62). Chỉ thêm menu khi có API. |
| "Phòng ban và chức danh" thành "Chức danh" | Phòng ban/cây tổ chức do mô-đun nền tảng quản lý (`/organization`), HRM chỉ có chức danh và mô tả công việc (F-07 tab chức danh). Không tạo bản sao trong HRM. |
| "Hợp đồng" không thành mục riêng ngay | Hiện chỉ có panel trong drawer nhân viên (`HrmContractPanel`); danh sách hợp đồng toàn công ty chưa có màn hình. Tách là P2. |
| Thêm "Dữ liệu chấm công" vào nhóm D | `GET /attendance` và `attendance-events` (quyền `attendance.read`) tồn tại nhưng **không có giao diện** sau khi gỡ tab cũ; panel log thô đang bị mồ côi. Nhu cầu của người phụ trách chấm công là có thật. |
| "Quỹ phép" nằm ở E, cấu hình phép năm nằm ở H | Màn `/leave-settings` đang trộn vận hành và cấu hình. Backend đã tách rõ hai nhóm endpoint nên tách menu là hợp lý. |
| **Không có "danh mục lý do nghỉ"** | Source không có danh mục lý do: `reason` là chữ tự do trong từng đơn; chỉ có **loại nghỉ** (`leave_types`) và danh mục loại con để gắn quy trình. Mục "Phép năm và loại nghỉ" thay cho "phép năm và danh mục lý do nghỉ". |
| Nhóm "Báo cáo" chưa tạo | Source **không có báo cáo riêng**: chỉ có xuất CSV/Excel nằm trong từng màn và tổng quan ở Bàn làm việc. Theo yêu cầu "không tự tạo module mới", để nhóm G trống cho đến khi có phạm vi báo cáo. Nhật ký nghiệp vụ đang nằm ở Vận hành, giữ ở H. |
| "Duyệt và chốt lương" không tách mục | Luồng thật là tính, chốt, phát phiếu, chi trả trong **một màn**, dùng chung dữ liệu; **không có bước duyệt** (mục 5, nhóm 8). Tách menu sẽ tạo mục dẫn về cùng màn hình. |
| "Lịch sử phê duyệt" | Không có màn riêng. Lịch sử đơn của chính mình nằm ở F-04; tiến độ nằm ở F-02; nhật ký nghiệp vụ ở F-19. Không đề xuất tạo mới. |

Cách hiển thị theo vai trò (suy từ code, đã chạy tính menu từng vai trò mẫu): Nhân viên chỉ thấy nhóm A và B; Trưởng bộ phận thêm Danh mục ca, Xử lý đơn từ, Quỹ phép (đang dư quyền, xem mục 6); Chấm công viên thêm Phân ca, Bảng công, Cấu hình công; Nhân sự hồ sơ thêm nhóm C; C&B thêm Bảng công, Lương, Cấu hình lương; Quản trị thấy tất cả. Ma trận đầy đủ ở báo cáo C mục 4.5.

## 3. Bảng đối chiếu chức năng hiện tại với cấu trúc đích

| Nhóm đích | Mục đích | Từ chức năng hiện tại | Hành động |
|---|---|---|---|
| A. Tổng quan | Bàn làm việc | F-01 | Sửa (hiển thị theo quyền, link, số liệu) |
| B. Cá nhân | Lịch của tôi | F-02 | Đổi tên |
| B. Cá nhân | Chấm công của tôi | F-03 | Đổi tên, sửa lọc |
| B. Cá nhân | Bảng công của tôi | (chưa có) | **Bổ sung** (cần API) |
| B. Cá nhân | Đơn từ của tôi | F-04 | Đổi tên, bổ sung lối vào 3 loại đơn |
| B. Cá nhân | Hồ sơ của tôi | F-05 | Giữ, hợp nhất đường sửa hồ sơ |
| B. Cá nhân | Phiếu lương của tôi | F-06 | Đổi tên, sửa tiêu đề |
| C. Nhân sự | Danh sách nhân viên | F-07 (tab 1) | Chuyển nhóm, tách tab |
| C. Nhân sự | Chức danh | F-07 (tab 2) | Chuyển nhóm |
| C. Nhân sự | Người phụ thuộc | F-08 | Chuyển nhóm |
| C. Nhân sự | Quyết định nhân sự | F-09 | Chuyển nhóm |
| C. Nhân sự | Hợp đồng | drawer của F-07 | Giữ nguyên chỗ cũ (P2 tách trang) |
| D. Chấm công | Danh mục ca | F-10 | Chuyển nhóm |
| D. Chấm công | Phân ca | F-11 | Chuyển nhóm, sửa lỗi |
| D. Chấm công | Dữ liệu chấm công | (panel mồ côi) | **Bổ sung** giao diện |
| D. Chấm công | Bảng công tổng hợp | F-13 | Chuyển nhóm, sửa chức năng giả |
| E. Phép và duyệt | Đơn từ cần xử lý | F-12 | Đổi tên, chuyển nhóm |
| E. Phép và duyệt | Quỹ phép | F-16 (nửa vận hành) | **Tách** |
| F. Lương | Bảng lương | F-14 | Chuyển nhóm |
| F. Lương | Ứng và thu hồi | F-15 | Chuyển nhóm |
| G. Báo cáo | (trống) | - | Chưa tạo |
| H. Cấu hình | Công và thiết bị | F-17 | Chuyển nhóm |
| H. Cấu hình | Lương (+ ngạch/bậc, hồ sơ lương, SoD) | F-18 + F-07 (tab 3, 4) | **Hợp nhất** |
| H. Cấu hình | Phép năm và loại nghỉ | F-16 (nửa cấu hình) | **Tách** |
| H. Cấu hình | Vận hành và tích hợp | F-19 | Giữ |
| H. Cấu hình | Danh mục quyền | F-20 | Giữ, hạn chế hiển thị |

## 4. Danh sách theo tình trạng

**Hoàn chỉnh (không phát hiện thiếu sót đáng kể):** Người phụ thuộc (F-08), Danh mục ca (F-10), Vận hành và tích hợp (F-19), Ứng và thu hồi (F-15, trừ audit giải ngân), Cấu hình công (F-17, quyền GET chưa xác minh).

**Hoàn chỉnh về chức năng nhưng có lỗi hoặc khiếm khuyết cần sửa:** F-01, F-03, F-05, F-06, F-07, F-09, F-11, F-12, F-13, F-14, F-16, F-18, F-20 (chi tiết ở mục 1).

**Thiếu so với tên gọi hoặc nhu cầu:** F-02 (không có thông báo), F-04 (3/7 loại đơn không tạo được), Bảng công của nhân viên, giao diện Dữ liệu chấm công, giao diện cấu hình SoD lương, bước duyệt lương.

**Có khả năng không còn dùng** (chỉ là ứng viên, cần xác minh dữ liệu trước khi xử lý): bảng `workflow_rules`, `workflow_links`, `workflow_callbacks`; `unit_shift_assignments`; `shift_assignments` (chỉ còn nhãn nhật ký cũ và các script); `notifications` (không còn đường ghi từ migration 0021); toàn bộ `/v1/policies` (8 endpoint, không có giao diện); file mồ côi ở giao diện (mục 1).

**Trạng thái và cột có trong schema nhưng không có code nào ghi:** trạng thái duyệt lương (`IN_REVIEW`, `APPROVED`, `REJECTED` của lần tính lương, 7 cột người duyệt), `SUBMITTED`/`APPROVED` của kỳ công, `EXPIRED` của hợp đồng, phiếu lương `VIEWED`/`DOWNLOADED`, kỳ lương `PROCESSING`, `PAYMENT_QUEUED`, `taxable_income`. Danh sách đầy đủ ở báo cáo C mục 1.4.

## 5. Phân tích các nhóm dễ trùng

| Nhóm | Kết luận | Căn cứ | Cách tổ chức menu |
|---|---|---|---|
| **Chấm công của nhân viên và bảng công quản trị** | **Khác nghiệp vụ, nhưng cùng thuật toán chạy hai lần.** Chấm công cá nhân đọc `attendances` (tổng hợp ngày); bảng công tính lại từ `attendance_events` bằng cùng hàm `calculateAttendance`, cộng nghỉ phép, công tác, OT, loại ngày, chỉnh tay. Hai kết quả có thể lệch khi đổi ca hoặc lịch sau đó (`attendances` không tính lại). | `hrm-time.ts` `recalculateAttendance`; `hrm-timesheet-calculation.ts`; B2 mục B.1, C-06 | Giữ hai menu: "Chấm công của tôi" (B) và "Bảng công tổng hợp" (D). Thêm "Dữ liệu chấm công" cho quản trị. Không gộp. |
| **Đơn từ của nhân viên và xử lý/duyệt đơn** | **Cùng dữ liệu, khác vai trò.** Màn nhân viên tạo và theo dõi (lọc theo chính mình); màn xử lý duyệt (`forApproval=1`). Backend duyệt trực tiếp là **nhiều bộ riêng theo loại đơn**; phần chung duy nhất là đường Procedure Engine và hàm áp kết quả. | `requests-screen.tsx`, `approvals-screen.tsx`; B2 mục B.2 | Giữ hai menu ở hai nhóm. Gộp ở giao diện là không cần thiết. Có 3 endpoint hủy trùng với đường rút đơn chung (FE không gọi). |
| **Danh mục ca và phân ca** | **Khác nghiệp vụ**, phân ca dùng danh mục ca. | `work-schedule-screen` gọi `GET /shifts` | Giữ hai menu cạnh nhau ở nhóm D. |
| **Quỹ phép và cấu hình phép năm** | **Cùng màn, hai nghiệp vụ.** Backend đã tách (số dư và sổ cái; lịch cộng phép và loại nghỉ). | `leave-settings-screen.tsx` | **Tách** thành hai menu (E và H). |
| **Danh mục lý do nghỉ và quy tắc cộng phép** | **Không có danh mục lý do.** Lý do là chữ tự do. Quy tắc cộng phép nằm ở `leave_accrual_schedules` (hai mô hình trong một bảng: theo ngày vào làm cũ và theo ngày ký hợp đồng mới). Chính sách `LEAVE` trong `/policies` không có logic nào đọc. | B2 mục B.3 | Chỉ một menu "Phép năm và loại nghỉ". Có hai file logic phép không được import và truy vấn bảng không tồn tại (`leave_seniority_milestones`), nên là mô hình bỏ dở. |
| **Cấu hình lương và tính lương** | **Khác nghiệp vụ.** Cấu hình sở hữu công thức, tham số, OT; tính lương sở hữu kỳ, lần tính, khoản, phiếu. Ngạch/bậc chỉ là danh mục tham chiếu, **không tham gia tính lương** và không ràng buộc mức lương. | B3 mục B1 | Giữ hai menu ở F và H. Ngạch/bậc chuyển về H. |
| **Tính, duyệt, chốt, chi trả lương** | **Một luồng, một màn.** Luồng thực tế: nháp, đã tính, chốt, phát phiếu, ghi nhận chi trả, kỳ đã trả. **Không có bước duyệt** (các trạng thái duyệt chỉ có trong ràng buộc dữ liệu). | B3 mục B2; `hrm-payroll.controller.ts` | Một menu "Bảng lương" với các bước là tab/nút trong màn. Chưa tách "Duyệt và chốt". |
| **Các màn điều chỉnh công, phép, lương** | **Khác nhau, không trùng.** Giải trình công sửa dữ liệu gốc có duyệt và đảo được; chỉnh bảng công ghi đè kết quả một dòng, không duyệt; điều chỉnh phép là bút toán sổ cái; điều chỉnh lương thủ công chỉ thêm khoản thu hoặc khấu trừ. | B2 mục B.4; B3 mục B6 | Giữ nguyên chỗ hiện tại, không gộp. |
| **Ngày lễ (hai nơi)** | **Trùng một phần.** Lịch lễ ở Cấu hình công (`work_calendar`) và ở Phân ca (`company_holidays`) cùng ghi vào `work_calendar`; ngày nghỉ hằng tuần có ba nơi (chính sách, `work_calendar`, mẫu lịch tuần) và bảng công chỉ đọc một phần. | C mục 1.3; B2 mục B.5 | Cần chọn **một nguồn** (xem mục 8, quyết định 4). |
| **Sửa hồ sơ** | **Trùng.** `PATCH /my-profile` sửa thẳng họ tên, ngày sinh, CCCD; đơn đính chính bắt duyệt chính các trường đó (và không có lối vào). | B1 C-01 | Chọn một đường (mục 8, quyết định 5). |
| **Mức lương (ba nơi)** | **Trùng.** Hồ sơ lương trực tiếp (không audit, không duyệt), quyết định nhân sự (có duyệt), hợp đồng (`base_salary` không được tính lương dùng). | B3 C-07; C mục 1.3 | Một nơi nhập chính (mục 8, quyết định 6). |
| **Người phụ thuộc (hai bảng)** | **Khác mục đích nhưng dễ nhầm.** `employee_family_members` tự khai, không giảm trừ; `employee_dependents` đã xác minh, có hiệu lực theo ngày, tính lương dùng. | B1 B.4 | Giữ hai, đặt tên giao diện rõ. |

## 6. Phân quyền và trải nghiệm người dùng

Các nhóm người dùng đối chiếu với cơ chế hiện có (không tạo vai trò mới): hệ thống đã có **9 vai trò mẫu**: Nhân viên, Trưởng bộ phận, Nhân sự hồ sơ, Trưởng phòng nhân sự, Chấm công viên, C&B, Người chốt lương, Kế toán chi trả, Quản trị HRM. Việc các vai trò mẫu được tạo tự động khi cấp tenant hay chỉ thủ công là **chưa xác minh**.

**Ba lớp phân quyền cần phân biệt** (chi tiết ở báo cáo C mục 4.4, 4.6):

| Lớp | Hiện trạng | Nhận xét |
|---|---|---|
| Hiển thị menu | `hrmPagePermissions` + lọc kiểu "any" | Menu và kiểm tra trang dùng chung một bản đồ nên nhất quán. |
| Truy cập route/trang | Chỉ chặn ở **trình duyệt**. `apps/hrm-web` không có middleware hay kiểm tra phía máy chủ; `proxy.ts` của ứng dụng chính không bao phủ `/modules/hrm`. | Ẩn menu và chặn khung trang là UX, không phải bảo mật. Dữ liệu chỉ được bảo vệ bởi API. |
| Thao tác API | Mọi handler đều gọi `getContext` (kiểm phiên, CSRF, entitlement, quyền). `HrmAccessGuard` ở chế độ `audit` mặc định (chỉ ghi nhật ký, **không chặn**). Chỉ 41/267 route khai báo `@RequirePermission`. | Nếu bật chế độ chặn ngay, 226 route sẽ trả 403. Không có cấu hình nào trong repo đặt chế độ chặn. |

**Các lỗ hổng quyền quan trọng** (đánh số theo báo cáo C mục 4.7):
- **Đọc quá rộng do quyền được cấp ngầm** (G3, G4, G5): mọi quyền `*.approve` tự kéo theo `request.read`; `leave.approve` kéo theo `leave.read`. Vai trò Trưởng bộ phận vì vậy đọc được **đơn, chấm công (kèm IP/GPS) và quỹ phép của toàn tenant**. Phạm vi cấp dưới chỉ áp khi giao diện tự gửi `forApproval=1` và lúc duyệt.
- **Dữ liệu cá nhân nhạy cảm** (G7): danh sách nhân viên trả CCCD, mã số thuế, BHXH, số tài khoản cho mọi người có `employee.read`; chỉ trường lương được che.
- **Vai trò thiếu** (G11): 12 quyền không vai trò mẫu phi-admin nào có (duyệt tạm ứng, mở lại bảng công, xem nhật ký, dashboard tổng quan...), nên các việc này chỉ quản trị làm được.
- **Phạm vi duyệt đơn** (G19, F14): dùng quan hệ quản lý của mô-đun nền tảng, **không dùng** `employee_reporting_lines` mà quyết định nhân sự ghi. Đổi quản lý bằng quyết định nhân sự không đổi người duyệt.
- **Tách nhiệm vụ lương** (G13): tenant mới mặc định bật, tenant cũ mặc định tắt; bước chi trả **không** được áp tách nhiệm vụ dù định nghĩa có.
- **Ghi lương** (G15): tạo hồ sơ lương chỉ cần `salary.manage`, không audit, không duyệt, cho hiệu lực lùi ngày khi kỳ chưa chốt.

## 7. Luồng nghiệp vụ giữa các phân hệ và điểm đáng lưu ý

```
 NHÂN VIÊN + HỢP ĐỒNG
   employee_profiles (join_date, trạng thái, inactive_from) + employment_contracts
   (hợp đồng KHÔNG ràng buộc lịch, công, lương; ngày ký hợp đồng chỉ dùng làm mốc phép năm)
        |
        v
 LỊCH LÀM VIỆC VÀ PHÂN CA
   shift_definitions <- mẫu tuần -> lịch định kỳ (không kết thúc: nhân viên > phòng ban > công ty, tra khi cần)
                                    lịch từng ngày (ngoại lệ, ngày lễ, gán theo khoảng) thắng lịch định kỳ
        |
        v
 CHẤM CÔNG
   attendance_events (dữ liệu thô) -> attendances (tổng hợp ngày, tính lần 1)
   giải trình công: void sự kiện cũ, chèn sự kiện mới
        |
        v   (đơn nghỉ phép, tăng ca, công tác, đổi ca, giải trình; duyệt DIRECT hoặc qua Procedure Engine)
 NGHỈ PHÉP / LÀM THÊM
   leave_requests (+ leave_request_days chụp phút có lương), ot_requests, business_trip_requests
        |
        v
 XÁC NHẬN VÀ CHỐT CÔNG
   calculateTimesheet: tính lại từ sự kiện thô (tính lần 2) + nghỉ phép + công tác + OT + loại ngày
   -> timesheets + calculation_snapshot ; khóa kỳ (chặn thay đổi nguồn, chỉ ở tầng ứng dụng)
        |
        v
 TÍNH LƯƠNG
   payroll_runs: đọc timesheets đã khóa + hồ sơ lương theo ngày + chính sách lương + tham số cá nhân
                 + lịch thu hồi ứng + quyết toán phép + người phụ thuộc
   -> payroll_items (+ snapshot công thức và đầu vào), payroll_employee_totals (+ snapshot tài khoản)
        |
        v
 CHỐT LƯƠNG   (không có bước duyệt thật)   -> trừ nợ ứng, kỳ lương khóa
        |
        v
 PHÁT PHIẾU LƯƠNG -> payslips (bản chụp đóng băng)  -> CHI TRẢ (ghi nhận thủ công từng người) -> kỳ lương PAID
```

**Điểm thiếu liên kết, tính trùng, lưu trùng, nguy cơ sai khi đổi dữ liệu** (đánh mã theo báo cáo C mục 3.3):

| Mã | Loại | Vấn đề | Mức |
|---|---|---|---|
| F1 | Tính trùng | `calculateAttendance` chạy hai lần (chấm công ngày và bảng công); bảng công không đọc `attendances`. `attendances` không tính lại khi đổi ca, lịch, ngày lễ. | Trung bình |
| F2 | Tính trùng | Loại ngày (làm/nghỉ/lễ) suy ra ở nhiều nơi với quy tắc khác nhau; **lịch định kỳ bị bỏ sót ở đơn nghỉ phép và `dayKindOf`**; hệ số OT chỉ xét `work_calendar`. | **Cao** |
| F4 | Lưu trùng | Lương lưu 4 nơi, tính lương chỉ đọc một (`employee_salary_profiles`). Hợp đồng/quyết định không tự đồng bộ. | Cao |
| F5 | Thiếu liên kết | Hợp đồng không ràng buộc công và lương; trạng thái hợp đồng hết hạn không bao giờ được đặt; tạo nhân viên không sinh hồ sơ lương hay lịch, lỗi lộ ở bước tính lương. | Cao |
| F7 | Đổi âm thầm | Lịch định kỳ tra theo phân công tổ chức và giờ ca **hiện hành**; sửa phân công hoặc cắt/hủy lịch làm đổi ca quá khứ ở kỳ chưa khóa. | Trung bình |
| F8 | Đổi âm thầm | Mở lại kỳ công rồi tính lại dùng ca và chính sách hiện hành, không dùng snapshot cũ. | Trung bình |
| F10 | Đổi âm thầm | Chính sách lương lấy theo ngày cuối kỳ cho cả kỳ; tham số cá nhân theo đầu kỳ. | Trung bình |
| F12 | Lịch sử | Nghỉ việc: ngày kết thúc phân công lấy ngày chạy sự kiện (không phải ngày nghỉ); dòng công ngoài thời gian làm việc bị xóa thật; không có đường tái tuyển. | Trung bình |
| F14 | Thiếu liên kết | Hai nguồn "quản lý trực tiếp" không đồng bộ (mục 6). | Cao |
| F17 | Hiệu năng | Tính bảng công chạy khoảng 10 truy vấn cho mỗi nhân viên mỗi ngày trong một giao dịch. | Hiệu năng |

**Bảo toàn lịch sử theo tình huống** (chi tiết ở báo cáo C Part 2):

| Tình huống | Giữ lịch sử? | Ghi chú |
|---|---|---|
| Chuyển phòng ban | **Có** (đóng và mở phân công theo ngày) | Dòng công và lương không lưu đơn vị; sửa phân công trực tiếp ở mô-đun nền tảng không qua audit HRM. |
| Đổi ca, đổi lịch | **Một phần** | Dòng lịch từng ngày giữ (hủy chứ không xóa); lịch định kỳ bị cắt thì giá trị cũ chỉ còn trong nhật ký, không có bảng phiên bản. |
| Đổi mức lương | **Có** (hiệu lực theo ngày, hồ sơ cũ giữ) | Cho phép hiệu lực lùi; tạo trực tiếp không audit. |
| Nghỉ việc | **Một phần** | Hồ sơ, công, lương giữ; hợp đồng, quản lý, quyết định đang mở không được đóng. |
| Kỳ công đã khóa | **Có** ở mức dòng | Không có snapshot cấp kỳ; tính lại sau khi mở dùng định nghĩa hiện hành. |
| Kỳ lương đã chốt | **Có** (nhiều lớp snapshot) | Không có tính lại hay mở lại sau chốt; sửa sai chỉ qua điều chỉnh ở kỳ sau. Khóa chỉ ở tầng ứng dụng, không có ràng buộc ở DB. |

## 8. Việc đề xuất theo mức ưu tiên và các quyết định cần bạn xác nhận

### P0: cốt lõi (sai nghiệp vụ, lộ dữ liệu, hoặc chặn việc tái cấu trúc)

| # | Việc | Căn cứ |
|---|---|---|
| P0-1 | **Sửa lỗi lịch định kỳ ở đơn nghỉ phép** (lỗi của phần phân ca tôi làm): hàm xác định loại ngày chỉ đọc lịch từng ngày, không đọc lịch định kỳ. Nhân viên chỉ có lịch định kỳ với ngày nghỉ (ví dụ Chủ nhật OFF) mà xin nghỉ qua ngày đó sẽ bị báo "Chưa phân ca ngày …". Đã đối chiếu trong `hrm-time.ts` (`scheduleDayTypeOf`) và `hrm-leave-operations.ts`. | F2 |
| P0-2 | **Sửa ngày lễ theo phạm vi** (cũng của phần phân ca): bảng công và tăng ca không đọc `company_holidays` (chỉ `work_calendar`), nên cờ "có lương" của lễ theo phòng ban/nhân viên không có tác dụng và OT không nhận ra các ngày lễ đó. Cần xác nhận bằng dữ liệu thật trước khi kết luận về lương. | B2 C-04, C-05 |
| P0-3 | Ép phạm vi đọc ở máy chủ cho đơn, chấm công, quỹ phép (hoặc tách quyền "đọc toàn tenant" khỏi quyền "duyệt"); sửa giao diện chấm công cá nhân đang gọi danh sách đơn không lọc. | G3-G5; A mục E7 |
| P0-4 | Lương: sửa việc chốt trừ nợ ứng cho nhân viên không nằm trong lần tính; áp tách nhiệm vụ cho bước chi trả; quyết định có làm bước duyệt lương thật hay bỏ các trạng thái chết. | B3 C-01, C-02, C-03 |
| P0-5 | Hồ sơ: đóng đường sửa trực tiếp họ tên, ngày sinh, CCCD (hoặc đưa qua duyệt); che dữ liệu nhạy cảm trong danh sách nhân viên theo quyền riêng. | B1 C-01, C-05 |
| P0-6 | Xác nhận trên prod: nhân viên nào còn dựa vào phân ca cũ mà chưa có lịch mới (đang không có ca, bảng công báo bất thường). Gán lịch định kỳ cho toàn công ty là cách nhanh nhất. | C mục 1.3 (cutover chưa xác minh) |
| P0-7 | Cho nhân viên xem bảng công của chính mình (tạo API tự phục vụ), là điều kiện để menu "Bảng công của tôi" có nghĩa. | B2 C-03 |

### P1: cần thiết (để menu đích hoạt động và bỏ chồng chéo)

- Tái cấu trúc menu theo mục 2 (đổi tên, chuyển nhóm, chia F-07, F-16): thay đổi chủ yếu ở giao diện.
- Giao diện Dữ liệu chấm công (dùng lại API có sẵn); lối tạo 3 loại đơn còn thiếu; giao diện thông báo; giao diện cấu hình tách nhiệm vụ lương.
- Chọn một nguồn lịch lễ và một nơi khai ngày nghỉ hằng tuần (mục 5).
- Bỏ chức năng giả (3 nút xuất, nút đổi tài khoản, phân trang giả, ô tìm kiếm), sửa link Procedure sai, sửa tiêu đề trang, sửa quyền hiển thị `/permissions`.
- Khai báo `@RequirePermission` cho các route còn lại rồi mới bật chế độ chặn; thêm vai trò mẫu cho các quyền chưa ai có (duyệt tạm ứng, mở lại bảng công).
- Đồng bộ nguồn "quản lý trực tiếp" cho phạm vi duyệt đơn.
- Audit cho tạo hồ sơ lương, các bước tạo/tính/chốt lương và giải ngân ứng.

### P2: mở rộng

- Trang Hợp đồng riêng; tách bảng công thành snapshot cấp kỳ; một lần tính chấm công thay vì hai lần.
- Kiểm tra phiên và quyền phía máy chủ cho `apps/hrm-web`.
- Dọn mã chết, file mồ côi, endpoint không dùng; sau khi xác minh dữ liệu prod mới xét bỏ bảng `workflow_*`, `unit_shift_assignments`, `notifications`.
- Job hết hạn hợp đồng, đường tái tuyển, đóng hợp đồng khi nghỉ việc.
- Tối ưu hiệu năng tính bảng công; phân trang các danh sách.
- Nhóm Báo cáo, khi bạn xác định phạm vi.

### Kế hoạch theo giai đoạn

| Giai đoạn | Nội dung | Giữ nguyên | Chỉnh sửa | Hợp nhất | Bổ sung | Xem xét loại bỏ |
|---|---|---|---|---|---|---|
| 0 | Sửa P0-1, P0-2 và kiểm chứng trên dữ liệu thật; xử lý P0-6 | Toàn bộ menu | Logic loại ngày, ngày lễ | - | Test | - |
| 1 | Bảo mật dữ liệu (P0-3, P0-5), lương (P0-4) | Menu | Phạm vi đọc, quyền, chốt lương | - | Audit | - |
| 2 | Đổi cấu trúc menu (giao diện): đổi tên, chuyển nhóm, chia F-07 và F-16 | Mọi route và API | Tên, nhóm, quyền hiển thị | Hai tab lương vào Cấu hình lương | - | Nút giả, nhánh "Sắp có" |
| 3 | Lấp chỗ thiếu: Bảng công của tôi, Dữ liệu chấm công, 3 loại đơn, thông báo, cấu hình SoD | - | - | - | API và giao diện mới | - |
| 4 | Hợp nhất nguồn: lịch lễ, ngày nghỉ tuần, đường sửa hồ sơ, nơi sửa lương, quản lý trực tiếp | Dữ liệu cũ | Cách ghi/đọc | Các nguồn trùng | - | Đường cũ sau khi xác minh |
| 5 | Dọn dẹp và bật chế độ chặn quyền ở API | - | Khai báo quyền | - | Vai trò mẫu còn thiếu | Bảng/endpoint mồ côi sau khi xác minh dữ liệu prod |

### Các quyết định cần bạn xác nhận trước khi bắt đầu code

1. **Bước duyệt lương:** làm thật (người rà soát, người duyệt, có lý do từ chối) hay bỏ các trạng thái duyệt đang chết và giữ luồng "tính, chốt, phát, chi"?
2. **Nhóm Báo cáo:** chưa tạo vì chưa có báo cáo riêng; bạn có muốn xác định phạm vi báo cáo trong giai đoạn này không?
3. **Hợp đồng:** để trong drawer nhân viên hay tách trang riêng ngay?
4. **Lịch lễ:** chọn nguồn duy nhất là màn Phân ca (có phạm vi, có xử lý nghỉ/vẫn làm) hay màn Cấu hình công?
5. **Sửa hồ sơ cá nhân:** cho nhân viên tự sửa trực tiếp (thu hẹp bớt trường nhạy cảm) hay bắt toàn bộ qua đơn đính chính cần duyệt?
6. **Nơi nhập mức lương chính:** hồ sơ lương trực tiếp, hay chỉ qua quyết định nhân sự có duyệt (hợp đồng chỉ mang tính thông tin)?

## 9. Giới hạn của báo cáo

- Phân tích tĩnh; chưa chạy thử từng chức năng, chưa kiểm tra bằng dữ liệu thật. Các kết luận về lương liên quan đến ngày lễ theo phạm vi và việc nhân viên chưa có lịch cần xác nhận bằng dữ liệu.
- Mỗi endpoint và bảng có bằng chứng (file, dòng) trong các báo cáo A, B1, B2, B3, C. Nếu có điểm nào bạn thấy khác thực tế, cho tôi biết để đối chiếu lại.
- Các điểm chưa xác minh được liệt kê ở cuối từng báo cáo chi tiết.
- Không có thay đổi nào ở code, menu, API hay database trong giai đoạn này. Chờ bạn xác nhận phạm vi.
