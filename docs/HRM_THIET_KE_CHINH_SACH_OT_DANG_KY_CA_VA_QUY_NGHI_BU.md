# Thiết kế HRM: chính sách làm thêm cấu hình được, đơn đăng ký ca và quỹ nghỉ bù

Trạng thái: **đề xuất, chưa triển khai**. Tài liệu này bổ sung và, ở các điểm nêu rõ, thay thế hướng đã mô tả trong
`HRM_THIET_KE_QUY_NGHI_BU_VA_CHOT_CHAN_DON_TU.md` (hai chế độ cứng `NIGHT_REST`, `CLOCK_WINDOW`).

Các con số và ví dụ hệ số trong tài liệu chỉ để minh họa cấu hình. Mức hệ số, trần giờ và việc quy đổi nghỉ bù thay cho
trả lương phải được pháp chế và HR xác nhận cho từng tenant.

## 1. Vấn đề cần giải quyết

1. `NIGHT_REST` và `CLOCK_WINDOW` là mã cứng, tên không nói lên đang chọn gì, tenant mới không tự hiểu được.
2. Mỗi chế độ gộp ba việc độc lập: chia giờ làm thêm thành nhóm, hệ số và trần cho từng nhóm, cách giờ thành quỹ nghỉ bù.
3. Chế độ `NIGHT_REST` cần biết "ngày làm việc kế tiếp có được nghỉ không" (`f`), nhưng dữ liệu nguồn là ghi chú tự do
   nên không ổn định.
4. Chỉ có một hệ số quy đổi cho mọi nhóm giờ, nên không phục vụ được tenant có hệ số theo loại ngày.

## 2. Các cách đã xem xét

| # | Cách | Trạng thái |
|---|---|---|
| 1 | `NIGHT_REST`: ca qua 00:00 thì `ca đêm = min(giờ ca, 8 × f)`, trần tháng, phần dư quy ra ngày | Có trong code |
| 2 | `CLOCK_WINDOW`: giờ nằm trong khung đêm là ca đêm, phần dư quy ra ngày | Có trong code |
| 3 | Quản lý ngoài hệ thống (tắt quy tắc nghỉ bù) | Có trong code |
| 4 | Theo ngày có ca và không có ca | Phân tích |
| 5 | `OT_ONLY`: bỏ phân biệt đêm, quá 40 giờ quy hết ra nghỉ bù, có trần quỹ | Phân tích |
| 6 | Quy giờ dư ra công trước, phần vượt công chuẩn vào quỹ | Phân tích |
| 7 | Đơn công tác khai giờ theo ngày, tách giờ trong ca và làm thêm | Có trong code |
| 8 | Khung chính sách cấu hình theo tenant (file đề xuất kiến trúc) | Khung bao ngoài, xem 2.1 |

### 2.1. Cách 8 là khung, không phải công thức

Cách 8 trả lời "tenant nào dùng quy tắc nào, nhập trường nào, lưu vết ra sao", không phải "giờ thành quỹ như thế nào".
Bốn tenant của nó tương ứng: A là cách 3, B gần cách 5, D là cách 1 (khác ở chỗ vượt 40 giờ chỉ cảnh báo), C là
**hệ số theo loại ngày, chưa có trong cách nào** của 7 cách đầu.

### 2.2. Bốn tenant mẫu áp vào các cách

Tình huống kiểm tra: 2 giờ OT ngày thường (không qua nửa đêm) cộng 3 giờ OT chủ nhật, tổng 5 giờ, dưới ngưỡng 40, một
ngày nghỉ quy đổi 8 giờ.

| Tenant | Kết quả mong muốn | Cách nào đạt |
|---|---|---|
| A (OT thuần) | Ghi 5 giờ, không quỹ | Cách 3, và cách 1 hoặc 2 nếu tắt cờ |
| B (mọi giờ OT thành quỹ, hệ số 1,0) | 5 giờ, tức 0,625 ngày | Chưa cách nào: cách 5 gần nhất nếu ngưỡng bằng 0 |
| C (hệ số theo loại ngày) | Quỹ 2×1,0 + 3×1,5 = 6,5 giờ = 0,8125 ngày | Không cách nào |
| D (hiện tại) | Phân loại theo ngày kế tiếp, vượt 40 giờ chỉ cảnh báo | Cách 1, trừ phần tự quy đổi phần dư |

Điểm chung của các cách hiện có: chỉ phần vượt trần mới thành quỹ, và chỉ có một hệ số. Tenant B cần ngưỡng 0, tenant C
cần nhiều hệ số, tenant A cần tắt hết.

### 2.3. Tham chiếu: cài đặt nghỉ bù của 1Office

Trang "Cài đặt nghỉ bù" của 1Office (Chấm công) dùng một bộ tham số nhỏ:
- Bật tắt; tỷ lệ quy đổi giờ làm thêm ra giờ nghỉ bù (ví dụ 1,5).
- Hạn dùng tính từ lúc bắt đầu đơn làm thêm: không hết hạn, hết trong tháng, cuối năm, 1, 2, 3, 6, 12 tháng, hoặc "tháng N
  năm sau".
- Ứng trước nghỉ bù với số giờ tối đa.
- **Chốt quỹ theo tháng**: thủ công hoặc tự động sau N ngày kể từ cuối kỳ; cấp quyền thấp nhất được chốt và hoàn chốt.
- Cài đặt theo phòng ban, vị trí, chức vụ, cấp bậc (nhiều dòng cài đặt).
- Không có trần tháng, không có phân loại ca đêm, không có hệ số trả lương. Mọi giờ làm thêm đã duyệt vào quỹ.

Đơn vị là giờ. Hạn dùng của 1Office tính từ ngày đơn, còn của chúng ta tính từ tháng cộng quỹ.

## 3. Mô hình tham số bốn tầng (thay hai enum cứng)

Nguyên tắc: không nhập công thức tự do (khó kiểm thử, khó giải thích, dễ nhập sai gây lệch quỹ cả công ty). Mỗi tầng là cấu
trúc cố định với tham số có tên. Mặc định của mọi tham số tùy chọn là trống.

### Tầng 1. Nhóm giờ
Tenant khai danh sách nhóm. Mẫu: Ngày thường, Ngày nghỉ tuần, Ngày lễ, Ca đêm. Mỗi nhóm có:

| Tham số | Kiểu |
|---|---|
| Hệ số tính lương | số, chỉ để xuất payroll |
| Hệ số quy đổi nghỉ bù | số, dùng cho quỹ |
| Tính vào trần tháng và năm | ô tích |
| Được cộng quỹ | ô tích |

### Tầng 2. Quy tắc gán nhóm
Mỗi quy tắc có điều kiện và hành động, xếp theo ưu tiên. Điều kiện thuộc danh sách đóng: loại ngày (thường, thứ 7, chủ
nhật, lễ), khung giờ, ca qua nửa đêm. Hành động: đưa tối đa N giờ hoặc toàn bộ vào một nhóm.

Khi dùng đơn đăng ký ca (mục 4), điều kiện "ngày kế tiếp được nghỉ" **không còn là điều kiện cấu hình**, vì nó đã nằm trong
dữ liệu lịch. `NIGHT_REST` và `CLOCK_WINDOW` thu về: OT là giờ làm ngoài lịch hiệu lực, nhóm theo loại ngày và khung giờ.

### Tầng 3. Trần và hành động khi vượt

| Tham số | Giá trị |
|---|---|
| Trần tháng, trần năm | số giờ hoặc trống |
| Nhóm tính vào trần | chọn nhiều |
| Khi vượt trần | chỉ cảnh báo; chặn duyệt; phần vượt đổi sang quỹ; phần vượt chuyển cho payroll xử lý |

Hiện code luôn chọn "phần vượt đổi sang quỹ", còn đề xuất kiến trúc cho tenant D là "chỉ cảnh báo". Biến thành tham số thì
không còn mâu thuẫn.

### Tầng 4. Quy đổi và quỹ

| Tham số | Giá trị |
|---|---|
| Chế độ cộng quỹ | không cộng; chỉ phần vượt trần; mọi giờ OT |
| Số giờ một ngày nghỉ, làm tròn, số thập phân, bước dùng | như hiện nay |
| Thời điểm cộng | cùng tháng hoặc tháng sau |
| Hạn dùng | số tháng hoặc số ngày; tùy chọn "tháng N năm sau", "cuối năm" |
| Trần tích lũy | số ngày hoặc trống |
| Chốt quỹ theo kỳ | thủ công hoặc tự động sau N ngày; cấp quyền được chốt |
| Cần HR xác nhận trước khi cộng quỹ | ô tích |
| Phạm vi áp dụng | theo nhóm nhân sự (phòng ban, chức vụ, cấp bậc), để trống là tất cả |

### Ánh xạ các cách vào mô hình

| Cách | Viết được bằng tham số |
|---|---|
| 1, 2 | Có: quy tắc tầng 2 và chế độ "chỉ phần vượt trần" |
| 3 | Có: chế độ "không cộng" |
| 4 | Có: quy tắc theo loại ngày với hệ số nhóm riêng |
| 5 | Có: không có nhóm đêm, chế độ "chỉ phần vượt trần", ngưỡng 40 |
| 6 | Không: là phép toán lên bảng công. Cần chế độ quy đổi thứ ba "cộng vào công thực làm trước". Để sau |
| 7 | Không thuộc mô hình: là nguồn giờ, đứng trước tầng 1 |

## 4. Đơn đăng ký ca và lịch hai lớp

### 4.1. Mục đích
Thay trường hợp "làm thêm nhưng hôm sau không làm = ca đêm" bằng dữ liệu có cấu trúc. Nhân viên đăng ký ca đêm kèm ngày
nghỉ sau ca. Giờ trong ca đã đăng ký là giờ làm bình thường. OT chỉ là phần làm ngoài ca.

Kết quả tương đương `NIGHT_REST` khi ca đăng ký bằng `8 × f`, nhưng `f` giờ là dữ liệu, không còn là ghi chú. Ca nửa ngày
nghỉ là ca đăng ký dài 4 giờ, nên trường hợp "ca 11 giờ với nửa ngày nghỉ" chưa giải được trước đây không còn.

### 4.2. Lịch hai lớp
1. Lớp nền: lịch phân ca hiện hành (giờ hành chính).
2. Lớp đăng ký: ca đã duyệt, chèn lên lớp nền, kèm ngày nghỉ sau ca và phần nghỉ (1 hoặc 0,5).

Lịch hiệu lực của một ngày là lớp đăng ký nếu có, không thì lớp nền. Lớp đăng ký không ghi đè lớp nền, nên hủy đăng ký là
lịch trở về như cũ.

### 4.3. Đơn công tác
Đơn công tác (CT cả ngày, CT/2 nửa ngày) chỉ chọn ngày, không chọn giờ, vì giờ giấc có thể không theo giờ hành chính.
Đơn đăng ký ca là lựa chọn bổ sung khi có phát sinh thay đổi.

Hệ quả: tính năng đơn công tác khai giờ theo ngày (`hrm-trip-day-lines.ts`) thành đường sinh OT thứ hai và có thể trùng
với đăng ký ca. Cần quyết định tắt hoặc gỡ khi tenant dùng đăng ký ca.

### 4.4. Quan hệ với loại đơn `shift_change` hiện có
`shift_change` hiện chỉ đổi từ ca A sang ca B có sẵn cho các ngày đang làm đúng ca A, bỏ qua ngày nghỉ, lễ, chủ nhật, và
chỉ chọn ca trong danh sách. Đăng ký ca đêm cần: ngày làm có thể là ngày vốn được nghỉ, khung giờ tùy ý, và có ngày nghỉ kèm
theo. Quyết định cuối: không mở rộng `shift_change` (vẫn ẩn), tạo loại đơn riêng `shift_registration` (xem mục 12 và 13).

### 4.5. Dữ liệu
Bảng `shift_registrations`: nhân viên, thời điểm bắt đầu và kết thúc (mốc tuyệt đối), ngày nghỉ sau ca, phần nghỉ, trạng
thái, người duyệt. Ràng buộc loại trừ khoảng thời gian ở cơ sở dữ liệu để hai đăng ký đã duyệt của một người không chồng nhau.

## 5. Chốt chặn giữa đơn làm thêm và đăng ký ca

### 5.1. Điều kiện bất biến
**Mỗi phút của một nhân viên chỉ thuộc một loại: trong ca hoặc làm thêm.** Khoảng OT được duyệt phải nằm ngoài cả ca hành
chính ban đầu và ca đã đăng ký của ngày đó. So sánh trên mốc thời gian tuyệt đối, không theo ngày, vì ca 18:00 ngày D đến
02:00 ngày D+1 chiếm cả hai ngày.

Kèm theo:
- Ca đăng ký dài tối đa theo cài đặt (đề xuất 8 giờ). Làm quá thì phần dư là OT sát ngay sau ca, không trùng.
- Ngày nghỉ sau ca là ngày OFF trong lịch. Đăng ký ca cho chính ngày đó vẫn được (nhiều đêm liên tiếp là trường hợp
  thường gặp), nên đây không phải ràng buộc cứng; chỉ chặn khi ngày nghỉ của một đơn trùng ngày đã đăng ký ca khác.
- OT không được khai trong khung hành chính của ngày có ca đêm. Khung đó không có công và không có OT (quyết định này đang
  chờ xác nhận, xem mục 9).

### 5.2. Chốt chặn theo thứ tự duyệt

| Thứ tự | Xử lý |
|---|---|
| A. Ca duyệt trước, OT sau | Lúc tạo OT, form hiện khung ca và chặn khoảng trùng. Lúc duyệt OT kiểm tra lại trong cùng giao dịch |
| B. OT duyệt trước, đăng ký ca sau | Lúc nộp đăng ký, liệt kê OT đã duyệt trùng giờ. Mặc định chặn nộp, người dùng điều chỉnh OT trước. Tùy chọn: người duyệt xác nhận cắt phần trùng, chỉ khi tháng chưa chốt và quỹ chưa cộng; lịch sử khối OT được giữ kèm lý do |
| C. Cả hai đang chờ duyệt | Mặc định cho nộp song song kèm cảnh báo; đơn duyệt sau bị từ chối với mã `HRM_SHIFT_OT_OVERLAP`. Tùy chọn: chặn nộp đơn thứ hai |
| D. Đơn bị từ chối, rút, hủy | Giải phóng khoảng giờ |
| E. Tháng đã chốt công hoặc quỹ đã cộng | Chặn mọi thay đổi chồng lên tháng đó, chuyển HR xử lý ngoại lệ |
| F. Sửa đăng ký ca đã duyệt | Không sửa tại chỗ: hủy và đăng ký lại, chạy lại toàn bộ kiểm tra |

### 5.3. Yêu cầu kỹ thuật
- Khóa theo nhân viên khi duyệt (đã có `lockEmployee`), để hai đơn của cùng một người không cùng vượt qua kiểm tra.
- Kiểm tra dự phòng ở cơ sở dữ liệu (trigger khi ghi `overtime_blocks` hoặc khi duyệt đăng ký), giống trigger 0018 khóa đơn
  gắn PE.
- Đơn OT đã duyệt không sửa được bằng tính năng sửa đơn chưa duyệt, nên dòng B mặc định đi qua hủy và tạo lại.

## 6. Quy tắc thời điểm tạo đơn

Hệ thống đã có `request_time_rules` cho từng loại đơn: `minNoticeDays` (tạo trước tối thiểu), `maxBackdateDays` (tạo bù tối
đa), `escalateAfterDays` (dự phòng xử lý sau). Đơn đăng ký ca dùng lại cơ chế này (`shift_change` đã nằm trong
`TIME_RULE_KINDS`). Thêm một tham số mới: **tạo trước tối đa** (`maxAheadDays`).

### 6.1. Ràng buộc giữa hai cửa sổ
Cửa sổ tạo bù của đăng ký ca nên không dài hơn của OT. Nếu dài hơn, nhân viên có thể đăng ký ca khi OT của ngày đó đã quá
hạn tạo lại, nên xung đột ở dòng B không còn đường sửa. Đây chỉ là **cảnh báo khi lưu cấu hình**, không chặn.

### 6.2. Kiểm tra lại ở thời điểm duyệt
Kiểm tra thời gian hiện chỉ chạy lúc tạo đơn. Với đăng ký ca cần kiểm tra lại tháng khóa ngay lúc duyệt, trong cùng giao
dịch với kiểm tra trùng giờ. Ca xuyên tháng: một trong hai tháng đã chốt thì chặn.

### 6.3. Mốc tính hạn
Tính từ ngày bắt đầu ca. Người duyệt dự phòng nên đặt ngắn hơn cửa sổ tạo bù để đơn không rơi vào tháng chốt.

### 6.4. Tính lại công
Đăng ký ca duyệt muộn đổi lịch hiệu lực của ngày D và D+1. Bảng công đã tính có thể đang đánh dấu vắng hay thiếu giờ ở D+1,
nên cần tính lại hai ngày đó khi duyệt. Chưa kiểm tra bảng công hiện tính lại tự động hay theo lô.

## 7. Phân nhóm: ràng buộc cố định và tùy chọn theo tenant

### 7.1. Ràng buộc toàn vẹn, không đưa vào cài đặt
- Mỗi phút chỉ thuộc một loại, không trùng.
- Không thay đổi dữ liệu của tháng đã chốt công, kể cả khi đơn được duyệt muộn (thời điểm chốt vẫn là cài đặt kỳ công).
- Khóa theo nhân viên khi duyệt và kiểm tra dự phòng ở cơ sở dữ liệu.
- Giữ nguyên giờ chấm công thực tế, không đổi nhãn để làm giờ vượt trần biến mất.

### 7.2. Tùy chọn theo tenant

| Tùy chọn | Giá trị | Mặc định |
|---|---|---|
| Dùng đơn đăng ký ca | bật hoặc tắt | tắt |
| Độ dài tối đa một ca đăng ký | số giờ | trống |
| Bắt buộc kèm ngày nghỉ sau ca | bật hoặc tắt | tắt |
| Tạo trước tối thiểu, tạo bù tối đa, dự phòng xử lý sau, tạo trước tối đa | số ngày, cho từng loại đơn | trống |
| OT đã duyệt trùng đăng ký ca | chặn cứng, hoặc người duyệt xác nhận cắt phần trùng | chặn cứng |
| Hai đơn cùng chờ duyệt | song song kèm cảnh báo, hoặc chặn nộp đơn thứ hai | song song |
| Đăng ký duyệt muộn khi tháng đã chốt | từ chối, hoặc chuyển HR | từ chối |
| Giờ hành chính ban ngày của ngày có ca đêm | không công không OT, hoặc tính công | chưa chốt |
| Toàn bộ tham số của mục 3 (tầng 1 đến 4) | xem mục 3 | trống |

Tenant không bật đăng ký ca không nhìn thấy các tùy chọn liên quan.

## 8. Hợp đồng với thiết kế và code hiện có

- `NIGHT_REST` và `CLOCK_WINDOW` bị thay. Bắt buộc có migration chuyển cấu hình hiện tại sang bộ tham số mới và cho ra đúng
  cùng kết quả, kiểm bằng kiểm thử hồi quy trên dữ liệu T9, T10. Kết quả đã tính giữ snapshot phiên bản chính sách cũ.
- Lưu thời lượng bằng phút nguyên thay giờ thập phân. Việc này đụng dữ liệu hiện có nên cần quyết định sớm.
- Tách giờ làm theo luật trong khung 22:00 đến 06:00 thành đầu ra riêng cho payroll. Bỏ khái niệm OT ca đêm không có
  nghĩa là bỏ phụ cấp làm việc ban đêm.
- Công thức ngày công `công_chuẩn − ngày nghỉ sau ca đêm` không còn cần, công theo lịch hiệu lực.
- Mã `weekendRule` (`ALL_NIGHT` và các giá trị khác) chỉ có trong tài liệu thiết kế cũ, không có trong code, và trái với
  dữ liệu 1Office; không đưa vào thiết kế mới.
- Trần 40 giờ của tenant hiện tại: cần quyết định tự quy đổi phần dư thành nghỉ bù (như đang chạy) hay chỉ cảnh báo.
  Với tham số "khi vượt trần" ở tầng 3, cả hai đều cấu hình được.

## 9. Quyết định còn mở

1. Khung hành chính ban ngày của ngày có ca đêm: không công không OT, hay tính công?
2. Ngày nghỉ sau ca đêm: nghỉ hưởng lương tính vào công chuẩn, hay ngày nghỉ đổi từ ca đêm không trừ công?
3. Mặc định của tenant hiện tại khi vượt trần 40 giờ: tự quy đổi hay chỉ cảnh báo?
4. Cho tenant thêm nhóm giờ tùy ý, hay chỉ dùng bốn nhóm?
5. Tính năng khai giờ theo ngày của đơn công tác: tắt hay gỡ?
6. Tenant có cần HR xác nhận lô trước khi cộng quỹ?
7. Đổi sang lưu phút nguyên ở lần này hay để sau?
8. Cách 6 (quy ra công) có nằm trong phạm vi lần này không. Đề xuất để sau.

## 10. Lộ trình đề xuất

1. Tách hai việc đang dính nhau: cách phân loại giờ và cách đổi giờ ra quỹ (chế độ cộng quỹ, tầng 3 và 4), kèm migration
   và kiểm thử hồi quy.
2. Bảng hệ số theo nhóm và mục đích; mở rộng cho tenant có hệ số theo loại ngày.
3. Đơn đăng ký ca, lịch hai lớp, chốt chặn mục 5, quy tắc thời gian mục 6.
4. Chốt quỹ theo kỳ và phạm vi theo nhóm nhân sự.
5. Màn mô phỏng: nhập ca OT thử, xem ra nhóm nào, bao nhiêu giờ quỹ, trước khi lưu chính sách.
6. Mẫu cấu hình có sẵn ("OT thuần", "OT đổi nghỉ bù", "OT có hệ số theo ngày", "Ca đêm theo ngày nghỉ") để tenant mới chọn
   rồi chỉnh, mỗi tham số có một dòng giải thích và một ví dụ số.

## 11. Kiểm thử cần có

Ca qua nửa đêm; ca qua tháng; OT trùng hoặc chồng ca; đăng ký ca duyệt trước và sau OT theo từng dòng A đến F; hai đơn duyệt
đồng thời; tháng đã chốt; đơn bị rút hoặc hủy sau duyệt; điều chỉnh giờ sau khi quỹ đã cộng hoặc đã dùng; hồi quy khớp kết
quả `NIGHT_REST` và `CLOCK_WINDOW` cũ trên dữ liệu T9, T10.

## 12. Hướng đã chọn (nhánh `feat/hrm-ot-overnight`): bỏ đơn đăng ký ca, đơn OT tự nhận qua đêm

Sau khi thử phương án đơn đăng ký ca riêng (`shift_registration`, đã làm xong ở nhánh `feat/hrm-shift-registration`, chưa
commit, không đưa vào nhánh này), hướng được chọn là đơn giản hơn: giữ một loại đơn OT, mỗi dòng ngày là MỘT khoảng liền.
Quy tắc tính lấy từ tài liệu của công ty (`Tong_hop_dien_giai_va_tinh_toan_OT_ca_dem.md`).

### 12.1. Quy tắc phân loại (tính riêng từng khoảng, `overtime-classification.ts`)
| Khoảng | Làm thêm | Ca đêm |
|---|---|---|
| Không qua đêm | toàn bộ | 0 |
| Bắt đầu thứ Bảy hoặc Chủ nhật | toàn bộ | 0 |
| Qua đêm, bắt đầu thứ Hai đến thứ Sáu, sáng hôm sau CÓ đi làm | toàn bộ | 0 |
| Qua đêm, bắt đầu thứ Hai đến thứ Sáu, sáng hôm sau KHÔNG đi làm | phần vượt 8 giờ | min(giờ, 8) |

Luôn có `làm thêm + ca đêm = tổng giờ`. Ca xuyên tháng: 8 giờ ca đêm tính một lần cho cả khoảng rồi xếp vào các phần theo thứ
tự thời gian. Kiểm thử bằng mẫu Phan Trung Kiên dòng 69: tổng 58, làm thêm 50, ca đêm 8.

### 12.2. Form đơn OT
- Mỗi dòng ngày (kể cả các dòng thêm bằng dấu +) có ô "Làm qua đêm": tự tích khi giờ Đến không sau giờ Từ, nên khoảng
  18:00 đến 04:00 là một dòng, không tách thành hai.
- Khi tích "Làm qua đêm" hiện ô "Sáng hôm sau có đi làm" (mặc định tích). Bỏ tích nghĩa là sáng hôm sau nghỉ: gửi
  `nextDayRest = FULL`; còn lại gửi `NONE`. Chọn mặc định "có đi làm" là mặc định an toàn: không tự sinh giờ ca đêm khi người
  dùng chưa khai.
- Chỉ phân biệt có hoặc không đi làm sáng hôm sau (theo tài liệu). Giá trị `HALF` cũ trong dữ liệu được hiểu như "nghỉ".

### 12.3. Dọn cài đặt "Làm thêm và nghỉ bù"
Bỏ: chế độ phân loại (NIGHT_REST / CLOCK_WINDOW), khung giờ đêm, số giờ ca đêm bù mỗi ngày nghỉ, nghỉ nửa ngày, "ca đêm cũng
bị cắt trần", tuỳ chọn công tác khai giờ tính giờ đêm. Các khóa cũ trong dữ liệu bị bỏ qua khi đọc. Số giờ ca đêm tối đa lấy
từ "Số giờ chuẩn một ngày làm việc" (mặc định 8). Cột `rule_set` ghi cố định `NIGHT_REST`; không đổi schema.
Đơn công tác khai giờ theo ngày: mọi giờ ngoài ca là giờ làm thêm (chưa tách ca đêm).

### 12.4. Chưa làm / cần chốt
- Mặc định của ô "Sáng hôm sau có đi làm" chưa suy ra từ lịch phân ca, nghỉ phép hoặc ngày nghỉ của ngày hôm sau; người dùng tự khai.
- Ngày lễ và ngày nghỉ bù theo lịch chưa được coi như thứ Bảy, Chủ nhật (tài liệu chỉ nêu thứ Bảy và Chủ nhật).
- Khoảng ban ngày (không qua đêm) dù sáng hôm sau nghỉ vẫn là làm thêm toàn bộ (theo mẫu Trần Văn Thìn: 13:00 đến 17:00).
- Phần giờ ban đêm theo pháp luật cho tính lương lưu riêng theo khung giờ (mục 10.6 của tài liệu công ty) chưa làm.
- Chấm công ca qua đêm (gán lần chấm theo ngày bắt đầu ca) chưa kiểm tra; lỗi AUTO ở `hrm-attendance-ingest.ts:189` chờ duyệt.
- Ca đêm đã ghi trước đây vẫn đọc được; chưa có công cụ gộp lại.
