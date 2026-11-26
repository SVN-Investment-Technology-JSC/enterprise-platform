# HRM: phân tích hiệu năng báo cáo tổng hợp đơn từ, chốt đơn từ và chốt bảng công

Ngày đo: 26/11/2026. Nhánh `feat/hrm-compoff-confirm-reports`. Đo trên DB local (Postgres trong Docker, tenant `savina`): 47 nhân viên, 1.144 đơn làm thêm, 765 đơn công tác, 369 đơn nghỉ, 233 đơn giải trình, 29 đơn đổi ca, 3.193 lượt chấm công. Dữ liệu nhỏ nên mọi con số dưới đây là mức thấp; trên tenant lớn hơn sẽ tệ hơn.

## 1. Kết luận

| Chức năng | Đo được | Nguyên nhân chính | Trạng thái |
|---|---|---|---|
| Báo cáo tổng hợp đơn từ (`/reports?view=requests`) | 14,1 giây (tháng 10), 32,6 giây (cả năm) | Truy vấn con theo từng dòng bị chạy lặp 47 lần (một lần cho mỗi nhân viên) và chạy cho cả đơn ngoài kỳ | Đã sửa: còn khoảng 0,7–1,4 giây |
| Chốt bảng công (`POST /timesheet-months/:month/lock`) | Bước tính công 17,5 giây, 17.933 truy vấn tuần tự | Tính công theo kiểu N+1: mỗi cặp nhân viên-ngày chạy khoảng 12 truy vấn riêng | Đã sửa: xem mục 7 |
| Chốt đơn từ và hộp thoại chốt (`close-state`, `close-requests`) | Mỗi lần tính điều kiện chốt khoảng 0,45–0,75 giây, gọi lặp 2–3 lần mỗi thao tác | Chỉ để đếm "ngày chưa có ca" mà nạp cả bảng công tháng của mọi nhân viên (`loadBoard`) | Đã sửa một phần: xem mục 7 |

## 2. Báo cáo tổng hợp đơn từ

### 2.1. Luồng

`ServerReportPanel` (kind `requests`) gọi API báo cáo, rồi `loadRequestsReport` trong [hrm-reports.ts](../packages/modules/hrm/src/lib/infrastructure/hrm-reports.ts) dựng một câu SQL duy nhất gồm 5 nhánh `UNION ALL`, mỗi loại đơn một nhánh:

1. `leave_requests` nối `leave_types`.
2. `ot_requests` gom theo nhóm (`OT_GROUPS_SQL`: đơn làm thêm nhiều khoảng là một dòng; mỗi đơn chạy một `LATERAL` quét lại `ot_requests`).
3. `business_trip_requests`.
4. `shift_change_requests`.
5. `attendance_corrections`.

Mỗi nhánh còn có các truy vấn con theo từng dòng: tên người duyệt (`approverSql`, tìm trong view `employee_directory` theo `approved_by`) và mã/tên dự án (`projectSql`, tìm trong `request_project_links`). Kết quả nối với `employee_directory` để lấy tên, phòng ban, chức vụ, lọc theo ngày/trạng thái/nhân viên, rồi bọc `count(*) OVER ()` và `LIMIT`.

### 2.2. Câu lệnh gốc (rút gọn) và vì sao chậm

```sql
WITH q AS (
  SELECT u.kind, u.id, ..., ed.full_name, ed.employee_code, ed.department_name, ed.position_name
    FROM (
      SELECT 'leave', r.id, ..., approverSql(r) AS approver, projectSql(...) , ...   -- truy vấn con nằm TRONG nhánh
        FROM leave_requests r ...
      UNION ALL SELECT 'ot', ...  FROM (OT_GROUPS_SQL) r
      UNION ALL SELECT 'business_trip', ...
      UNION ALL SELECT 'shift_change', ...
      UNION ALL SELECT 'correction', ...
    ) AS u(...)
    JOIN hrm_schema.employee_directory ed ON ed.tenant_id = u.tenant_id AND ed.employee_id = u.employee_id
   WHERE u.start_date <= $to AND u.end_date >= $from  [AND ed.department_id = ANY(...)] [AND u.status = ANY(...)]
   ORDER BY u.start_date DESC, ed.full_name, u.id
)
SELECT q.*, count(*) OVER () AS total_count FROM q LIMIT <HRM_REPORT_MAX_ROWS>;
```

Kế hoạch thực thi (`EXPLAIN ANALYZE`) của tháng 10/2026, 382 dòng kết quả, tổng 13,5 giây:

- Postgres chọn `Nested Loop`: bảng ngoài là `core_schema.employees` (47 dòng), bảng trong là cả khối `Append` của 5 nhánh. Khối đó chạy lại 47 lần (`loops=47`), mỗi lần khoảng 284 ms.
- Điều kiện ngày nằm ở `WHERE` ngoài nên không giúp cắt dòng trước khi tính các cột trong nhánh. Các truy vấn con trong danh sách chọn chạy cho mọi dòng của mọi nhánh: truy vấn tìm người duyệt chạy 1.739 lần, truy vấn dự án chạy 1.739 lần; phần gom nhóm làm thêm giờ chạy 53.486 lần (1.138 đơn × 47).
- View `employee_directory` rất nặng (nối `employee_profiles`, `core_schema.employees`, `organization_node_assignments`, `organization_nodes` ba cấp, `position_profiles`, `salary_grades` và một `LATERAL` chọn chức vụ). Mỗi lần tìm người duyệt phải chạy lại các phép nối này.
- Gom nhóm làm thêm giờ dùng `COALESCE(x.group_id, x.id) = r.id`. Biểu thức bọc `COALESCE` không dùng được chỉ mục `idx_hrm_ot_requests_group (tenant_id, group_id) WHERE group_id IS NOT NULL`, nên mỗi đơn quét lại cả bảng `ot_requests` (seq scan).

### 2.3. Cách đã sửa

Chia câu lệnh thành 3 lớp, nặng đến nhẹ chỉ chạy cho dòng còn lại:

```sql
WITH q AS (
  WITH u AS MATERIALIZED (                       -- 1) chỉ cột nhẹ, lọc ngày/trạng thái ngay tại đây
    SELECT * FROM ( <5 nhánh UNION ALL, chỉ cột nhẹ + approved_by, approved_at, created_at, ids, fallback_project> )
           AS u(kind, id, tenant_id, employee_id, start_date, end_date, status, ...)
     WHERE u.start_date <= $to AND u.end_date >= $from [AND u.status = ANY(...)]
  ), f AS (                                      -- 2) nối nhân viên một lần cho dòng đã lọc
    SELECT u.*, ed.full_name, ed.employee_code, ed.department_name, ed.position_name
      FROM u JOIN hrm_schema.employee_directory ed ON ed.tenant_id = u.tenant_id AND ed.employee_id = u.employee_id
     WHERE TRUE [AND ed.department_id = ANY(...)] [AND ed.employee_id = ANY(...)]
  )
  SELECT r.kind, r.id, ..., approverSql(r) AS approver,          -- 3) cột nặng chỉ tính cho dòng cuối cùng
         (SELECT string_agg(DISTINCT l.project_code, ', ') FROM request_project_links l
           WHERE l.tenant_id = r.tenant_id AND l.request_kind = r.kind AND l.request_id = ANY(r.ids) AND l.status IS DISTINCT FROM 'REJECTED') AS project_code,
         COALESCE((SELECT string_agg(DISTINCT l.project_name, ', ') ... ), r.fallback_project) AS project_name,
         ...
    FROM f r ORDER BY r.start_date DESC, r.full_name, r.id
)
SELECT q.*, count(*) OVER () AS total_count FROM q LIMIT <HRM_REPORT_MAX_ROWS>;
```

Kết quả đo lại: tháng 10 (382 dòng) và cả năm (2.533 dòng) đều khoảng 0,7–1,4 giây; kế hoạch thực thi 618 ms, thời gian lập kế hoạch 7 ms. Nội dung dòng (người duyệt, dự án, ngày giờ) giữ nguyên.

### 2.4. Còn có thể tối ưu

- Gom nhóm làm thêm giờ vẫn tốn khoảng 240 ms (1.138 lần quét `ot_requests`). Nên viết lại bằng một `GROUP BY COALESCE(group_id, id)` rồi nối, hoặc thêm chỉ mục theo biểu thức.
- Các bảng đơn không có chỉ mục theo ngày (xem mục 4); khi dữ liệu lớn, lọc theo khoảng ngày vẫn quét cả bảng.
- Chưa kiểm tra các báo cáo khác (làm thêm, công tác, nghỉ phép đã dùng) có cùng kiểu truy vấn con trong nhánh hay không.

## 3. Chốt đơn từ và chốt bảng công

### 3.1. Luồng thao tác và các lệnh gọi

Mã nguồn chính: [hrm-timesheet-board.controller.ts](../packages/modules/hrm/src/lib/presentation/hrm-timesheet-board.controller.ts), [hrm-timesheet-month.ts](../packages/modules/hrm/src/lib/infrastructure/hrm-timesheet-month.ts), [hrm-timesheet-calculation.ts](../packages/modules/hrm/src/lib/infrastructure/hrm-timesheet-calculation.ts), [hrm-timesheet-board.ts](../packages/modules/hrm/src/lib/infrastructure/hrm-timesheet-board.ts).

**Mở hộp thoại chốt** (`GET /timesheet-months/:month/close-state`, thêm `GET comp-off/status?month=` khi chốt công):

1. `findMonthPeriods`: 1 truy vấn `timesheet_periods`.
2. `pendingRequestBlockers`: 1 truy vấn đếm 5 loại đơn chờ duyệt, cộng đơn tuỳ chỉnh.
3. `lockBlockers` gọi `dayProblems`: `employedEmployeeIds` rồi **`loadBoard` cho cả tháng và mọi nhân viên** để đếm "ngày làm việc chưa có ca". Tháng đã chốt thì trả sớm (`ALREADY_LOCKED`), rất nhẹ.

`loadBoard` chạy song song khoảng 15 truy vấn (danh sách nhân viên qua view `employee_directory`, lịch lễ, chính sách chấm công, lịch phân ca `employee_work_days`, lượt chấm công, nghỉ, công tác, làm thêm giờ, đơn đổi ca, giải trình, đơn tuỳ chỉnh, dòng công đã lưu, `resolveRuleDays` là một truy vấn `WITH RECURSIVE`). Đo: 450–750 ms với 47 nhân viên; truy vấn lớn nhất (đơn từ gộp) thực thi 288 ms.

**Chốt đơn từ** (`POST /timesheet-months/:month/close-requests`), một transaction:

1. `closeMonthRequests`: `ensureMonthPeriod` (advisory lock + `SELECT ... FOR UPDATE` kỳ công), `pendingRequestBlockers` (kiểm tra lần nữa), `UPDATE timesheet_periods SET requests_closed_at`, ghi `audit_log`.
2. Trả `monthCloseState` => **tính lại toàn bộ điều kiện chốt công, gồm cả `loadBoard`**, dù giao diện chỉ cần trạng thái mới.

**Chốt bảng công** (`POST /timesheet-months/:month/lock`), một transaction:

1. `ensureMonthPeriod`: advisory lock và khoá dòng kỳ công trong suốt giao dịch.
2. `lockBlockers`: lần thứ hai gọi `loadBoard` (lần đầu là lúc mở hộp thoại).
3. `calculateTimesheet`: **bước chậm nhất** (mục 3.2).
4. `lockTimesheetPeriod`: khoá kỳ; nếu bật tự cộng quỹ nghỉ bù thì `autoAccrueCompOff` chạy trong cùng transaction.
5. Ghi `audit_log` (`TIMESHEET_CALCULATED`, `TIMESHEET_MONTH_CLOSED`), trả `monthCloseState` (đã khoá nên nhẹ).
6. Giao diện gọi tiếp `POST comp-off/convert` để cộng quỹ theo số đã xem trước.

### 3.2. Nguyên nhân chính: tính công theo kiểu N+1

`calculateTimesheet` lặp hai vòng lồng `for employee × for day`. Với mỗi cặp nhân viên-ngày (trừ ngày ngoài thời gian làm việc), mã chạy lần lượt các truy vấn sau, mỗi truy vấn là một lần đi về với DB:

| # | Truy vấn | Bảng |
|---|---|---|
| 1 | `resolvePolicy` (chính sách chấm công theo ngày/nhân viên) | `policies`, `policy_versions` |
| 2 | `dayContextForDate` (ca và loại ngày theo lịch phân ca) | `employee_work_days`, `company_holidays`, `shift_definitions` |
| 3 | Lượt chấm công trong ngày | `attendance_events` |
| 4 | Bản ghi chấm công | `attendances` |
| 5 | Nghỉ phép đã duyệt | `leave_requests`, `leave_request_days`, `leave_types` |
| 6 | Nghỉ phép dạng cũ (không có dòng ngày) | `leave_requests` |
| 7 | Công tác | `business_trip_requests` |
| 8 | Giải trình công (2 nhánh UNION) | `attendance_events` |
| 9 | Đổi ca đã áp dụng | `shift_change_requests` |
| 10 | Làm thêm giờ đã duyệt | `ot_requests` |
| 11 | Mỗi đơn làm thêm giờ: `UPDATE ot_requests` | `ot_requests` |
| 12 | Ghi dòng công (upsert) | `timesheets` |

Đo thật: chạy `calculateTimesheet` cho tháng 11/2026 (47 nhân viên × 30 ngày) trong một transaction rồi `ROLLBACK` (không ghi gì):

- **17,5 giây, 17.933 truy vấn tuần tự** trên DB cùng máy. Mỗi truy vấn trung bình khoảng 1 ms.
- Trên môi trường thật, DB nằm ở máy khác nên mỗi lần đi về cộng thêm độ trễ mạng (1–3 ms): ước tính 35–70 giây cho cùng quy mô. Đây là ước tính, chưa đo ở môi trường deploy.
- Toàn bộ chạy trong một transaction giữ khoá kỳ công (`pg_advisory_xact_lock` và `FOR UPDATE`), nên các thao tác khác trên kỳ này phải chờ.
- Số truy vấn tăng theo (số nhân viên × số ngày). 500 nhân viên sẽ là khoảng 180.000 truy vấn.

### 3.3. Nguyên nhân phụ

- `loadBoard` nạp cả tháng cho mọi nhân viên chỉ để đếm ngày chưa có ca, và bị gọi lặp: mở hộp thoại, sau chốt đơn từ (trả `monthCloseState`), trước chốt công (`lockBlockers`). Mỗi lần 0,45–0,75 giây ở quy mô 47 người.
- View `employee_directory` nặng (mục 2.2) được `loadBoard` và nhiều màn khác dùng.

## 4. Cấu trúc DB liên quan

Schema `hrm_schema` (DB riêng mỗi tenant); nhân viên gốc ở `core_schema`.

| Bảng / view | Vai trò | Chỉ mục đáng chú ý |
|---|---|---|
| `timesheet_periods` | Kỳ công theo tháng: `period_code`, `from_date`, `to_date`, `status` (OPEN/LOCKED), `requests_closed_at`, `locked_at`, `calculated_at` | Khoá dòng bằng `FOR UPDATE` khi chốt |
| `timesheets` | Một dòng công mỗi nhân viên-ngày của kỳ (phút công, muộn, sớm, làm thêm, trạng thái, `calculation_snapshot`) | theo `period_id` |
| `attendance_events` | Lượt vào/ra (`event_kind`, `occurred_at`, `source`, `evidence`, `voided_by_correction_id`) | theo nhân viên và `work_date` |
| `attendances` | Bản ghi chấm công theo ngày | |
| `leave_requests` + `leave_request_days` | Đơn nghỉ và các ngày của đơn | `idx_hrm_leave_requests_emp (tenant_id, employee_id, status)`, `idx_hrm_leave_requests_group (tenant_id, group_id)` (có điều kiện) |
| `ot_requests` | Đơn làm thêm giờ, đơn nhiều khoảng gắn bằng `group_id` (đơn đầu có `group_id = id`) | `idx_hrm_ot_requests_emp (tenant_id, employee_id, status)`, `idx_hrm_ot_requests_group (tenant_id, group_id) WHERE group_id IS NOT NULL` |
| `business_trip_requests` | Đơn công tác | `idx_hrm_trip_requests_emp (tenant_id, employee_id, status)` |
| `shift_change_requests` | Đơn đổi ca | `idx_hrm_shift_change_emp (tenant_id, employee_id, status)` |
| `attendance_corrections` | Đơn giải trình công | `idx_hrm_att_corrections_emp (tenant_id, employee_id, status)` |
| `custom_requests` | Đơn tuỳ chỉnh | |
| `request_project_links` | Gắn đơn với dự án (`request_kind`, `request_id`, `project_id`, `project_code`, `status`) | `idx_request_project_links_request (tenant_id, request_kind, request_id)`, `uq_request_project_links_project`, `idx_request_project_links_project (tenant_id, project_id)` |
| `employee_work_days`, `company_holidays`, `shift_definitions`, `work_calendar` | Lịch phân ca, ngày lễ, định nghĩa ca, lịch làm việc | |
| `policies` + `policy_versions` | Chính sách theo loại (ATTENDANCE, PAYROLL, OT...), phiên bản theo ngày hiệu lực | |
| `employee_profiles` | Hồ sơ HRM của nhân viên (`join_date`, `inactive_from`, `deleted_at`) | `uq_hrm_employee_profiles_code (tenant_id, employee_code)`, `idx_hrm_employee_profiles_tenant_status` |
| `employee_directory` (view) | Gộp `employee_profiles` + `core_schema.employees` + `organization_node_assignments` + `organization_nodes` (chức vụ, đơn vị, khối) + `position_profiles` + `salary_grades` | Không có chỉ mục (là view), mỗi lần truy cập chạy lại các phép nối |
| `audit_log` | Nhật ký (TIMESHEET_REQUESTS_CLOSED, TIMESHEET_CALCULATED, TIMESHEET_MONTH_CLOSED) | |

Điểm cần chú ý về chỉ mục: các bảng đơn chỉ có chỉ mục theo `(tenant_id, employee_id, status)` và `group_id`. **Không có chỉ mục theo ngày** (`from_date`, `to_date`, `work_date`, `request_date`), nên mọi truy vấn lọc theo kỳ (báo cáo, đếm đơn chờ duyệt, `loadBoard`) quét cả bảng của tenant. Hiện chưa gây vấn đề vì bảng nhỏ, nhưng sẽ chậm dần khi dữ liệu tăng.

## 5. Đề xuất sửa (chưa làm)

Theo mức ưu tiên:

1. **Tính công theo lô (cao nhất).** Trong `calculateTimesheet`, nạp trước một lần cho cả kỳ và mọi nhân viên (giống `loadBoard` đã làm): lượt chấm công, đơn nghỉ/công tác/làm thêm/đổi ca/giải trình, lịch phân ca và chính sách; rồi tính trong bộ nhớ theo từng nhân viên-ngày. Ghi dòng công bằng một câu `INSERT ... ON CONFLICT` theo lô thay vì từng dòng. Mục tiêu: từ khoảng 18.000 truy vấn xuống vài chục. Cần có test so sánh kết quả cũ và mới trên cùng dữ liệu vì đây là logic tính lương.
2. **Bỏ tính lặp điều kiện chốt.** Các phản hồi chốt đơn từ và chốt công không cần trả lại `blockersForLock` (giao diện tự tải lại `close-state` khi cần). Đếm "ngày chưa có ca" bằng một truy vấn trên `employee_work_days` và `employee_profiles` thay vì nạp cả bảng công.
3. **Chỉ mục theo ngày** cho các bảng đơn, cần migration mới (không sửa migration đã merge): `(tenant_id, from_date, to_date)` cho nghỉ/công tác/đổi ca, `(tenant_id, work_date)` cho `ot_requests`, `(tenant_id, request_date)` cho `attendance_corrections`.
4. **Báo cáo:** viết lại gom nhóm làm thêm giờ bằng `GROUP BY`; kiểm tra các báo cáo còn lại theo cùng mẫu "lọc trước, tính cột nặng sau".
5. **Nhẹ hơn cho `employee_directory`:** truy vấn chỉ cần tên người duyệt thì đọc thẳng `employee_profiles`/`core_schema.employees` thay vì view đầy đủ.

## 6. Cách đo và hạn chế

- Báo cáo: gọi `loadRequestsReport` trực tiếp trên DB local, đo thời gian và `EXPLAIN (ANALYZE, COSTS OFF)` chính câu SQL thật (lấy từ lời gọi `pool.query`). So sánh trước và sau khi sửa.
- Tính công: chạy `ensureMonthPeriod` rồi `calculateTimesheet` cho tháng 11/2026 trong transaction và `ROLLBACK`, đếm số lần gọi `client.query`.
- Đo trên một DB Docker cùng máy, kết nối ấm, không tải đồng thời. Chưa đo ở môi trường deploy (Coolify), nên con số mạng và đồng thời chỉ là ước tính. Các file đo tạm đã xoá, không có trong repo.

## 7. Kết quả sau khi sửa (26/11/2026, DB local, 47 nhân viên)

### 7.1. Tính công khi chốt (`calculateTimesheet`)

- Mã nguồn: [hrm-timesheet-inputs.ts](../packages/modules/hrm/src/lib/infrastructure/hrm-timesheet-inputs.ts) (mới) nạp một lần chính sách, lịch phân ca, định nghĩa ca, lượt chấm công, nghỉ, công tác, đổi ca, làm thêm giờ của cả kỳ; [hrm-timesheet-calculation.ts](../packages/modules/hrm/src/lib/infrastructure/hrm-timesheet-calculation.ts) tính trong bộ nhớ rồi ghi dòng công theo lô (250 dòng mỗi câu `INSERT ... ON CONFLICT`) và cập nhật số phút đơn làm thêm giờ bằng một câu `UPDATE ... FROM unnest`.
- Lịch định kỳ vẫn tra theo từng ngày (30 truy vấn mỗi kỳ, không phụ thuộc số nhân viên) vì phòng ban hiệu lực của nhân viên được tính tại đúng ngày đang tra; gom cả kỳ một lần sẽ đổi kết quả với người chuyển phòng giữa tháng.
- Đối chiếu bản cũ và bản mới trên cùng dữ liệu thật (mỗi bản chạy trong transaction rồi `ROLLBACK`, so từng cột của từng dòng công và số phút trên đơn làm thêm giờ):

| Tháng | Số dòng công | Bản cũ | Bản mới | Khác biệt |
|---|---:|---|---|---|
| 05/2026 | 1.116 | 9,3 giây, 12.385 truy vấn | 0,5 giây, 62 truy vấn | 0 |
| 06/2026 | 1.080 | 8,3 giây, 11.985 truy vấn | 1,6 giây, 61 truy vấn | 0 |
| 07/2026 | 1.154 | 9,0 giây, 12.769 truy vấn | 0,4 giây, 62 truy vấn | 0 |
| 08/2026 | 1.278 | 9,4 giây, 14.278 truy vấn | 1,5 giây, 63 truy vấn | 1 dòng (xem dưới) |
| 09/2026 | 1.400 | 16,5 giây, 18.192 truy vấn | 0,6 giây, 62 truy vấn | 0 |
| 10/2026 | 1.396 | 17,5 giây, 18.916 truy vấn | 1,3 giây, 810 truy vấn (*) | 0 |
| 11/2026 | 1.350 | 21,1 giây, 17.933 truy vấn | 2,1 giây, 831 truy vấn (*) | 0 |

(*) Khoảng 750 truy vấn thừa ở tháng 10 và 11 là bước sinh chấm công tự động (`generateAutoAttendance`) chạy theo từng ngày chưa có sự kiện. Phép đo chạy trong transaction rồi hoàn tác nên mỗi lần phải sinh lại; khi chạy thật worker sinh dần từng ngày nên lúc chốt chỉ còn rất ít. Chưa tối ưu phần này.

Khác biệt duy nhất: ngày 11/08/2026 của một nhân viên có hai đơn nghỉ đã duyệt trùng ngày. Bản cũ không có `ORDER BY` nên chọn đơn đầu tiên theo thứ tự lưu trữ ngẫu nhiên; bản mới sắp theo thời gian tạo đơn nên ổn định. Trạng thái, số công và số phút vẫn giống nhau; chỉ khác đơn nào được ghi là `leave_request_id` và thứ tự nguồn.

Test: các test cũ đối chiếu bảng công trực tiếp với đường lưu (`hrm-timesheet-board.spec.ts`, `hrm-timesheet-unpaid-ot.spec.ts`) được cập nhật theo cách nạp mới và vẫn pass; thêm [hrm-timesheet-calculation-batch.spec.ts](../packages/modules/hrm/src/lib/infrastructure/hrm-timesheet-calculation-batch.spec.ts) khẳng định số truy vấn không tăng theo số nhân viên (1 và 40 nhân viên cho cùng số truy vấn, dưới 80) và các dòng công được ghi trong một câu lệnh.

### 7.2. Điều kiện chốt

- `GET close-state?for=requests` (hộp thoại chốt đơn từ) và các phản hồi của `close-requests`, `calculate`, `reopen` không còn tính điều kiện chốt công (không nạp bảng công). Chặn chốt công vẫn kiểm ở server trong `closeMonth`, và `close-state?for=lock` vẫn trả đủ để hộp thoại chốt công hiện danh sách vướng.
- Chưa viết truy vấn đếm "ngày chưa có ca" riêng: điều kiện này phụ thuộc lượt chấm công, nghỉ, công tác, lễ và ngày tương lai (`computeBoardDay`), viết lại bằng SQL dễ lệch với bảng công đang hiển thị.

### 7.3. Màn Dữ liệu chấm công

`GET attendance-data?group=employee` gom theo nhân viên ở máy chủ (gom trước, nối view nhân viên sau) và phân trang theo nhân viên; các ngày công của một người chỉ tải khi mở drawer. Truy vấn gom khoảng 42 ms.

### 7.4. Báo cáo đơn từ

Gom đơn làm thêm giờ nhiều khoảng đổi từ `CROSS JOIN LATERAL` sang một `GROUP BY COALESCE(group_id, id)`: báo cáo tổng hợp đơn từ tháng 10 còn khoảng 0,11–0,18 giây (trước khi sửa 14,1 giây), báo cáo làm thêm giờ khoảng 0,06–0,08 giây. Số dòng không đổi (382 và 192); gom nhóm cũ và mới cho cùng kết quả trên toàn bộ 1.138 đơn dẫn đầu.

### 7.5. Chưa làm

- Chỉ mục theo ngày và chỉ mục từng phần cho đơn chờ duyệt: chưa có căn cứ, vì với dữ liệu hiện tại câu đếm đơn chờ duyệt chạy khoảng 6 ms và Postgres sẽ chọn quét cả bảng. Cần dữ liệu mẫu lớn (hàng trăm nghìn đơn) và `EXPLAIN` trước khi thêm migration.
- Tối ưu `generateAutoAttendance` (cùng kiểu N+1 theo từng ngày chưa sinh) và rà các báo cáo còn lại.
- Chưa đo ở môi trường deploy.
