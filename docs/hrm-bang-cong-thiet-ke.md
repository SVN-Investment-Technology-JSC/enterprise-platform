# Thiết kế lại Bảng công (chỉ trong module HRM)

Phạm vi: chỉ HRM (backend, contracts, migration, giao diện). Không sửa Core hay module khác.

## Logic đúng

1. **Bảng công là toàn bộ thời gian**, xem theo tháng, không cần "tạo kỳ công". Chọn tháng là xem được ngay, kể cả tháng chưa có dữ liệu chấm công
   (hiển thị ca dự kiến theo lịch phân ca) và tháng chưa tới (ca dự kiến, trạng thái "Chưa tới ngày").
2. **Ai thấy gì**: người có quyền xem bảng công (`hrm.timesheet.read`) thấy mọi nhân viên; mọi người khác (nhân viên) chỉ thấy bảng công của
   chính mình. Cùng một màn hình, cùng một API: phạm vi do server quyết định, client không thể xem người khác.
3. **Mỗi ngày thể hiện rõ**: loại ngày (làm việc, nghỉ OFF, lễ, chưa có lịch), ca làm việc (mã, giờ bắt đầu/kết thúc), giờ chấm vào/ra, và khi có chấm công
   thì **số công trong ngày theo ca** (`paidMinutes / scheduledMinutes`: 1, 0.5...), cùng: đi trễ, về sớm, bất thường (quên chấm công), nghỉ không phép,
   nghỉ có phép, nghỉ phép năm, nghỉ không lương, công tác, tăng ca.
4. **Chốt, không phải tạo kỳ**:
   - Tháng công là tháng dương lịch (`YYYY-MM`), hệ thống tự tạo bản ghi kỳ công (`timesheet_periods`, mã `YYYY-MM`) khi cần (xem, tính, chốt).
   - **Chốt đơn từ**: từ lúc chốt, không tạo, sửa hay duyệt đơn nào có ngày thuộc tháng đó. Điều kiện: không còn đơn chờ duyệt có ngày trong tháng
     (hệ thống liệt kê số đơn còn vướng).
   - **Chốt công**: tính lại và khóa bảng công tháng, phục vụ tính lương. Điều kiện: tháng đã kết thúc, đã chốt đơn từ, không còn ngày bất thường chưa xử lý.
   - **Mở lại**: mở lại công (và đơn từ) có lý do; chặn nếu kỳ lương đã chốt (luật hiện có).
   - Quyền chốt: dùng các quyền sẵn có của kỳ công (`hrm.timesheet.calculate` để chốt đơn từ và chốt công; mở lại như hiện nay).

## Trạng thái ngày (thứ tự ưu tiên khi nhiều điều kiện cùng đúng)

Lễ, nghỉ OFF, bất thường (còn lỗi chấm công sau khi trừ phần ca đã có đơn nghỉ/công tác bao phủ, lệch dữ liệu), công tác, phép năm,
nghỉ có phép (có lương, không phải phép năm), nghỉ không lương, nghỉ không phép (có ca, không chấm công, không đơn nghỉ), đi trễ + về sớm,
đi trễ, về sớm, đi làm đủ. Ngày chưa tới: "Chưa tới ngày". Ngày làm việc đã qua mà chưa có ca: ô "Chưa có lịch" mang mã `NO_SHIFT`
(không phải lỗi chấm công nhưng vẫn chặn chốt công, hiển thị ở blocker `UNSCHEDULED_DAYS`).

## Quy tắc tính ngày dùng chung (một bộ cho bảng xem trực tiếp và lúc chốt)

Phần quyết định của một ngày nằm ở `domain/timesheet-day.ts` (`resolveDayOutcome`), được cả `computeBoardDay` (xem trực tiếp) và
`calculateTimesheet` (chốt) gọi nên số liệu khớp theo cấu trúc:

- Số phút công trả = min(ca, làm thực tế + phút nghỉ hưởng lương + phần ca công tác bao phủ). Ngày OFF = 0; ngày lễ có lương = cả ca.
- Nghỉ/công tác đã duyệt bao phủ cả ca thì lỗi chấm công (thiếu chấm ra...) chỉ là ghi chú, không chặn chốt. Nghỉ nửa ngày thì phần còn lại vẫn kiểm tra.
- Đi trễ / về sớm chỉ tính trên phần ca chưa được nghỉ hoặc công tác bao phủ (đơn có từ ngày giờ đến ngày giờ; đơn cũ không có giờ: nghỉ cả ngày thì về 0).
- Chủ nhật chưa phân ca là ngày trống (OFF) ở cả hai đường và ở đơn nghỉ, OT.
- Công tác có giờ: chỉ phần ca được công tác bao phủ được tính công và công tác phí; không có giờ: cả ca.
- Mỗi dòng công lưu `sources` (nghỉ, làm thêm giờ, công tác, giải trình công, đổi ca) để truy vết về đơn gốc; `ot_request_id`, `leave_request_id`,
  `business_trip_request_id` là đơn chính của ngày.

## Hệ số tăng ca theo lý do (cấu hình động)

- Lý do của đơn tăng ca (Danh mục lý do, loại Làm thêm giờ) có trường **Hệ số** (1 đến 10, tối đa 2 chữ số thập phân); để trống thì theo chính sách OT (ngày thường / ngày nghỉ / lễ / đêm).
- Đơn tăng ca lưu `ot_rate_multiplier` và `rate_source` (`REASON` = hệ số của lý do, `POLICY` = chính sách OT). Lúc **duyệt** hệ số được đọc lại từ lý do hiện hành, nên đổi cấu hình giữa lúc tạo và lúc duyệt thì đơn lấy hệ số mới; đơn đã duyệt không đổi theo cấu hình về sau.
- Hệ số của lý do thay cho hệ số chính sách trên **toàn bộ đơn** (không trộn giờ ngày/đêm khi đã có hệ số lý do). Đơn không chọn lý do có hệ số vẫn trộn giờ ngày/đêm theo số phút như trước.
- Chuỗi tính lương: `ot_requests.ot_rate_multiplier` -> phút OT quy đổi trong bảng công (`weightedOtMinutes`) -> đầu vào `WEIGHTED_OT_MINUTES` của công thức lương (ví dụ dòng OT_PAY).
- Lý do đang có giữ nguyên (hệ số rỗng, theo chính sách). Migration `0049-hrm-ot-reason-rate`.

## Công chuẩn và ký hiệu bảng công cá nhân

- **Công chuẩn** là mẫu số tính lương theo công, cấu hình trong phiên bản công thức lương (Cấu hình, Lương, Thêm công thức lương). Hai chế độ:
  - **Động** (`standardWorkMode = DYNAMIC`, mặc định khi chưa cấu hình): bằng số ngày công thực tế của tháng theo phân ca, đã trừ ngày nghỉ hằng tuần. Người vào hoặc nghỉ việc giữa kỳ được trả theo công chuẩn của kỳ (lớn nhất trong các nhân viên của kỳ), không lấy công của chính họ.
  - **Cố định** (`FIXED`, `standardWorkdays`, 1 đến 31, bước 0,5): số ngày công chuẩn do cấu hình, tháng nhiều hay ít ngày nghỉ vẫn như nhau. Mẫu số phút = số ngày x số phút trung bình một ngày công của nhân viên.
  - `MINUTES` chỉ còn cho phiên bản cấu hình cũ (`standardMinutes`); phiên bản cũ không đổi kết quả.
- Một nguồn quy tắc duy nhất: `domain/standard-workdays.ts`, dùng cho tính lương và hiển thị công chuẩn trên bảng công (`HrmBoardEmployee.standard`).
- Biến công thức: `STANDARD_PERIOD_MINUTES` (mẫu số phút) và `STANDARD_WORKDAYS` (công chuẩn theo ngày công). Lương theo công = lương tháng x phút được trả / `STANDARD_PERIOD_MINUTES`.
- Đổi cấu hình công chuẩn đặt các lần tính lương chưa chốt về nháp (như mọi thay đổi cấu hình lương); phiên bản đã được kỳ lương tham chiếu bị khóa sửa.
- **Ký hiệu trên lịch Công của tôi**: P phép (gồm phép năm; có tính công hay không theo loại nghỉ của đơn), CT công tác, TC tăng ca, GT giải trình công, KP nghỉ không phép (ngày vắng không có đơn nghỉ), ĐC đổi ca, KH đơn khác. Nền đặc là đã duyệt, viền đứt là chờ duyệt, gạch ngang là từ chối. Ngày chưa tới hiện mã ca, ngày đã qua hiện số công; đi trễ hoặc về sớm tô đỏ.

## Từ bảng công tới bảng lương

- Bảng lương chỉ đọc `timesheets` của kỳ công đã khóa, mỗi kỳ công chỉ có một kỳ lương.
- Công tác phí = mức/ngày theo hình thức công tác (`business_trip_allowance_rates`, có phiên bản theo ngày hiệu lực) x tỷ lệ ca được công tác,
  tính khi tính công và đóng băng vào dòng công; lương cộng qua đầu vào `TRIP_ALLOWANCE_AMOUNT` (công thức phải có thành phần dùng biến này).
  Dự trù phụ phí trong đơn công tác không phải khoản trả.
- Người nghỉ việc giữa kỳ: lương theo công trên công chuẩn của kỳ (không trả như đủ tháng).
- `payroll_runs.timesheet_fingerprint` lưu dấu vân tay bảng công lúc tính; chốt lương so sánh lại, lệch thì phải tính lại. `GET /payroll-runs/:runId/employees/:employeeId/trace` truy vết từng ngày công và đơn từ.
- Phân ca không được làm lệch đơn: đổi ca, huỷ ca, ngày OFF/lễ trên ngày có đơn nghỉ hoặc công tác đã duyệt bị từ chối (`HRM_SCHEDULE_REQUEST_CONFLICT`); đơn đang chờ chỉ cảnh báo.
Hợp đồng dữ liệu: `HrmTimesheetBoard`, `HrmBoardDay`, `HrmMonthCloseState` trong `packages/contracts/hrm/src/lib/contracts-hrm.ts` (mục "Bảng công theo tháng").

## API

- `GET /timesheet-board?month=YYYY-MM&employee_id=&q=&page=&page_size=` -> `{ data: HrmTimesheetBoard }`.
  Tháng đã chốt công: đọc từ bảng công đã lưu (`timesheets`, bất biến). Tháng chưa chốt: tính trực tiếp, không ghi DB (set-based, không truy vấn từng ngày từng người).
- `GET /timesheet-months/:month/close-state` -> `{ data: HrmMonthCloseState }`.
- `POST /timesheet-months/:month/close-requests` (chốt đơn từ), `POST /timesheet-months/:month/calculate` (tính công, ghi cả dòng bất thường để điều chỉnh),
  `POST /timesheet-months/:month/adjust` { employeeId, date, paidMinutes, reason } (điều chỉnh công một ngày, cần `hrm.timesheet.adjust`),
  `POST /timesheet-months/:month/close` (chốt công: tính + khóa),
  `POST /timesheet-months/:month/reopen` { reason } (mở lại). Mọi thao tác ghi audit.
- Các API kỳ công cũ (`/timesheet-periods...`) giữ nguyên cho tính lương, nhưng giao diện mới không còn "Tạo kỳ công".
