# Thiết kế lại nghiệp vụ Phép năm và Đơn từ (chỉ trong module HRM)

Phạm vi: chỉ code, migration và giao diện của module HRM. Không sửa Core (`core_schema`, `packages/platform/*`, `apps/web`) và module khác
(procedure-engine, workspace, notifications...). HRM chỉ gọi Procedure Engine qua cổng đã có.

## 1. Phép năm: chỉ MỘT cấu hình

- Mỗi tenant có **đúng một** lý do nghỉ được đánh dấu là phép năm (`leave_types.is_annual = true`, chỉ một dòng, có chỉ mục duy nhất).
- **Chính sách phép năm** là một biểu mẫu duy nhất (không danh sách lịch, không phiên bản trên giao diện):
  - Căn cứ tính: ngày vào làm hoặc ngày ký HĐLĐ chính thức (`accrual_basis`).
  - Số ngày phép một năm (`annual_days`), cộng hằng tháng theo logic đã có (`+1/tháng`, mốc bắt đầu sau N tháng).
  - Cho ứng phép (`advance_allowed`).
  - Thâm niên: cứ đạt N năm thì cộng thêm M ngày (các mốc `leave_seniority_tiers`).
  - Chuyển phép sang năm sau: tối đa bao nhiêu ngày, hạn dùng (cột sẵn có của `leave_types`).
- Lưu xuống bảng cũ `leave_accrual_schedules` + tiers: sửa chính sách = tạo phiên bản mới có hiệu lực từ một tháng (hành vi cũ, ẩn khỏi giao diện).
  Lịch sử vẫn tra được qua audit.
- Các lý do nghỉ khác (nghỉ ốm, cưới, không lương...) **không có cấu hình phép năm** và **không trừ quỹ**.

## 2. Quỹ phép = danh sách hiện tại

Một bảng: mỗi nhân viên một dòng cho năm đang xem. Cột: mã, họ tên, đơn vị, được hưởng năm nay, chuyển từ năm trước, đã dùng, chờ duyệt,
còn lại. Lọc theo năm và tìm theo tên. Thao tác phụ: điều chỉnh (quyền quản lý) và xem lịch sử của một người. Không có quyết toán nghỉ việc,
không có các tab sổ giao dịch toàn tenant trên màn chính.

## 3. Đơn từ: LÝ DO là danh mục cấu hình, tách khỏi MÔ TẢ

Mỗi đơn có hai thông tin khác nhau, không được lẫn:

| | Lý do | Mô tả |
|---|---|---|
| Là gì | Chọn từ **danh mục cấu hình** của loại đơn | Văn bản **tự do** bổ sung chi tiết |
| Ai tạo | Quản trị cấu hình trước (Cấu hình, Lý do đơn từ / Lý do nghỉ) | Người làm đơn nhập |
| Có ý nghĩa nghiệp vụ | Có (có lương hay không lương, chọn cách duyệt riêng, thống kê) | Không, chỉ để giải thích |
| Bắt buộc | Luôn bắt buộc | Chỉ bắt buộc khi lý do được cấu hình "cần mô tả" (ví dụ lý do "Khác") |

- **Đơn nghỉ**: lý do chính là **Lý do nghỉ** (loại nghỉ, `leave_types`). Mỗi lý do có: tên, **có lương / không lương**, có trừ quỹ phép năm hay
  không (chỉ lý do phép năm trừ quỹ), cần chứng từ hay không, đang dùng hay ngừng.
  - Có lương: ngày nghỉ được tính là ngày công có lương trong bảng công. Không lương: không tính công, không bao giờ trừ quỹ phép.
- **Đơn làm thêm giờ, công tác, giải trình công, đổi ca**: lý do nằm ở danh mục `request_reasons` (kind `OVERTIME`, `BUSINESS_TRIP`,
  `ATTENDANCE_CORRECTION`, `SHIFT_CHANGE`; cố định 4 loại, không có "loại đơn" tự tạo). Mỗi lý do có: mã, tên, diễn giải (hướng dẫn cho
  người chọn), có lương / không lương (**chỉ áp dụng cho làm thêm giờ**: OT không lương không sinh tiền OT; loại khác luôn "có lương"),
  cần mô tả hay không, đang dùng hay ngừng.
- Lưu: `reason_id` + `reason_name` (bản chụp tên, đổi tên lý do không làm đổi đơn cũ); mô tả nằm ở cột `reason` cũ (API: `description`).
  Đơn cũ chưa có lý do: hiển thị mô tả cũ, lý do để trống.
- Làm thêm giờ tính hệ số theo chính sách OT (loại ngày/đêm do hệ thống suy ra), không có danh mục "loại OT".
- Quy tắc kiểm tra giữ lại: không chồng ngày giữa nghỉ, công tác, OT chờ duyệt hoặc đã duyệt; OT phải nằm ngoài ca; Chủ nhật chưa phân ca
  là ngày trống; kết quả quy trình được đồng bộ ngay khi thao tác.
- Tenant mới: quản trị bấm "Tạo lý do mặc định" (tenant HRM đã có được seed sẵn ở migration 0045).

## 4. Mỗi đơn có người duyệt, theo một trong hai cách

| Cách | Ý nghĩa | Người duyệt |
|---|---|---|
| **Quản lý trực tiếp** (mặc định) | Đơn đi thẳng lên quản lý trực tiếp của người làm đơn (suy ra từ sơ đồ tổ chức) | Quản lý trực tiếp; người có quyền duyệt toàn bộ (`*.approve.all`, `hrm.manage`) |
| **Theo quy trình** | Đơn khởi tạo một quy trình duyệt của Procedure Engine | Người do quy trình chỉ định theo từng bước |

- Chọn cách duyệt theo **loại đơn** (nghỉ, OT, công tác, đổi ca, giải trình công, ứng lương, đính chính hồ sơ) và có thể chọn **riêng cho từng lý do**
  của 5 loại đơn có danh mục (ví dụ lý do nghỉ không lương phải qua quy trình).
- Lưu trong bảng cũ `request_procedure_bindings` (kind + sub_type_code = mã lý do). Không có binding thì dùng Quản lý trực tiếp.
- Khi tạo đơn, giao diện cho người làm đơn biết trước: "Người duyệt: Quản lý trực tiếp (tên)" hoặc "Duyệt theo quy trình: tên quy trình".
- Không tự duyệt đơn của chính mình (trừ khi tenant bật ngoại lệ, mặc định tắt).

## 5. Gỡ bỏ so với bản gộp từ nhánh Hai và leave-annual-policy

- Gỡ "loại đơn tự tạo" (request_reason_categories), danh mục "Loại OT" và việc OT không hệ số. Giữ bảng `request_reasons` nhưng đổi thành danh mục lý do
  cố định 4 loại có `paid` và `requires_description`.
- Gỡ các màn "Cấu hình phép / Lý do nghỉ / Lịch cộng phép nhiều phiên bản" thay bằng một biểu mẫu chính sách phép năm và bảng lý do nghỉ.
- Giữ nguyên: quy tắc kiểm tra ở mục 3, đồng bộ kết quả quy trình, migration `0034-hrm-offboarding-event-envelope`,
  logic cộng phép tháng và thâm niên theo ngày, đơn nghỉ không giữ chỗ phép khi gửi (kiểm tra quỹ lúc duyệt).
