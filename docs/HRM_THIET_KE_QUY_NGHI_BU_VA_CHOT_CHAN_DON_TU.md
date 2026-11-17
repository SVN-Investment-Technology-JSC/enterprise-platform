# Thiết kế HRM: phân loại làm thêm và ca đêm, quỹ nghỉ bù, chốt chặn đơn từ

Trạng thái: thiết kế đã đối chiếu với dữ liệu 1Office tháng 9 và 10/2026, chưa triển khai. Đã hợp nhất ý kiến từ tài liệu đề xuất kiến trúc multi-tenant (chính sách có phiên bản, snapshot theo kỳ, idempotency); những ý chưa cần cho giai đoạn này ghi ở mục 2.3.
Phạm vi: phân hệ HRM, mỗi tenant có cấu hình riêng.
Ví dụ số liệu dùng mã ẩn danh (NV-A); không ghi tên hay dữ liệu cá nhân thật vào tài liệu. File Excel nguồn không đưa vào repo.

## 1. Mục tiêu

1. Cho nhân viên ghi nhận đủ giờ làm thêm thực tế, không chặn cứng ở bước tạo đơn.
2. Khi tổng hợp bảng công: chỉ phần trong trần pháp luật được tính vào bảng lương; phần vượt trần chuyển thủ công sang quỹ nghỉ bù.
3. Phân loại giờ "làm thêm" và "ca đêm" đúng cách 1Office đang làm, từ dữ liệu đơn làm thêm và ngày nghỉ sau ca đêm.
4. Thêm loại nghỉ "Nghỉ bù" có quỹ riêng.
5. Khớp số liệu 1Office tháng 9 và 10/2026 để demo cuối tháng 11.

## 2. Quyết định đã chốt

| Nội dung | Quyết định |
|---|---|
| Trần 40 giờ/tháng | Trần giờ làm thêm theo luật (Bộ luật Lao động 2019 điều 107, Nghị định 145/2020). Cấu hình được. |
| Trần tháng áp dụng ở đâu | Ở dòng tổng hợp tháng, không cắt từng ngày hay từng ca. |
| Giờ dư | Chỉ lấy từ giờ làm thêm. Giờ ca đêm không bị cắt trần và không đổi thành nghỉ bù. |
| Quy đổi | Tenant cấu hình; mặc định `số ngày = giờ dư / 8 × 1,5`. Quỹ cộng vào tháng kế tiếp. |
| Số dư quỹ | Lưu làm tròn 1 chữ số thập phân (4,3125 thành 4,3). |
| Dùng quỹ khi tạo đơn | Chỉ theo bước 0,5 ngày. |
| Áp dụng quy tắc | Ô tích "bắt buộc / không bắt buộc" trong cấu hình. |
| Chuyển đổi | Bước thủ công, theo cấu hình tenant. HR và quản lý trực tiếp chỉ xem và can thiệp như ở `/modules/hrm/leave`. |
| Lịch làm việc | Thứ 7 là nửa ngày công (ca sáng), chủ nhật là ngày nghỉ tuần. Lấy từ phân ca, không đặt thành tham số riêng. |
| Công tác phí (CTP) | Khoản riêng, không liên quan làm thêm giờ (xem 3.6). |
| Đơn từ | Mọi đơn nằm trong một tháng; chỉ khóa bảng công mới chặn tạo đơn của tháng đó. |

### 2.1. Phân tầng: lõi chung, chính sách theo tenant, phần riêng của Savina

Quy tắc phân loại ở mục 3.3 được suy ra từ dữ liệu 1Office của một công ty (Savina, nhân viên thí nghiệm hiện trường làm đêm rồi nghỉ ngày hôm sau). Chưa có bằng chứng tenant khác tính giống vậy. Vì vậy thiết kế chia làm ba tầng để lõi không bị gắn với một công ty.

**Tầng 1: lõi dùng chung cho mọi tenant**

| Yếu tố | Ghi chú |
|---|---|
| Làm thêm tính theo phân ca (giờ ngoài ca là làm thêm; thứ 7 nửa ngày, chủ nhật nghỉ lấy từ phân ca) | Mọi công ty đều có lịch làm việc. |
| Trần làm thêm theo tháng và năm, áp ở dòng tổng hợp, giữ nguyên giờ thực tế trong báo cáo | Quy định pháp luật, chỉ khác con số. |
| Sổ quỹ nghỉ bù theo lô: giữ chỗ, hạn dùng, làm tròn, bước 0,5 ngày; loại nghỉ `COMPENSATORY` | Hệ số, hạn dùng, làm tròn là cấu hình. |
| Tách ca xuyên tháng tại 00:00 ngày mùng 1 | Cần cho mọi tenant có ca đêm. |
| Bản ghi từng ca (`overtime_blocks`), HR sửa tay kèm lý do | Không quy tắc nào phủ hết thực tế. |
| Công tác phí tách khỏi làm thêm | Mức tiền và điều kiện nhận là chính sách từng công ty. |

**Tầng 2: chính sách theo tenant (cấu hình, mặc định theo luật)**

| Yếu tố | Ghi chú |
|---|---|
| Chế độ phân loại: `CLOCK_WINDOW` hoặc `NIGHT_REST` | Mặc định tenant mới là `CLOCK_WINDOW` (tách theo khung đêm; theo hiểu biết hiện tại là cách luật tính, cần pháp chế xác nhận). |
| Trần làm thêm có áp vào tiền lương không; ca đêm có bị cắt trần không | Savina: làm thêm cắt ở 40 giờ, ca đêm không cắt. Tenant khác có thể khác. |
| Hệ số quy đổi nghỉ bù, số giờ một ngày, hạn dùng, làm tròn, tháng cộng quỹ | Mỗi tenant một bộ giá trị. |
| Nhóm tăng ca ngày lễ | Có tham số riêng. |

**Tầng 3: chỉ dành cho Savina (cấu hình hoặc công cụ riêng)**

| Yếu tố | Ghi chú |
|---|---|
| Chế độ `NIGHT_REST` (ca đêm = min(giờ của ca, 8 × phần ngày nghỉ hôm sau)) | Bật bằng cấu hình cho tenant này. Trường "hôm sau nghỉ" trên form đơn chỉ hiện khi tenant bật chế độ này. Mức 8 giờ và việc có tính nửa ngày là cấu hình, để công ty có kiểu tương tự dùng lại được. |
| Ngày công trừ ngày nghỉ sau ca đêm (mục 4.3) | Phụ thuộc chế độ `NIGHT_REST`; tenant không dùng thì không có phép trừ này. |
| Đoán ghi chú nghỉ theo ngày ca hay ngày hôm sau; xử lý lỗi nhập 44 giờ; đối soát từng dòng | Chỉ là lỗi của dữ liệu nguồn 1Office, nằm trong script nhập (mục 10), không đưa vào module. Trong ERP, ngày nghỉ sau ca đêm là trường có cấu trúc nên không còn chuyện ngày ca hay ngày hôm sau. |

**Nguyên tắc kỹ thuật:**
- Hàm phân loại nhận chính sách làm tham số và trả cùng một kiểu kết quả (giờ làm thêm, giờ ca đêm). Tổng hợp tháng, trần, quỹ nghỉ bù, bảng lương chỉ đọc kết quả đó, không biết đang dùng chế độ nào.
- Không gắn tên công ty vào mã hay tên cấu hình; đặt tên theo bản chất (`NIGHT_REST`).
- Tham số "phân loại" và tham số "trả lương" tách riêng (mục 8).

**Rủi ro:** quy tắc `NIGHT_REST` chỉ được kiểm trên dữ liệu của một công ty, 91% khớp cho thấy nó mô tả đúng cách Savina đang tính nhưng chưa chứng minh là chính sách thành văn. Nên hỏi nhanh HR của một tenant khác để biết họ tính ca đêm thế nào (mục 12).

### 2.2. Chính sách có phiên bản, kỳ công và snapshot

**Cách tách tenant của nền tảng:** mỗi tenant một database riêng, các tenant dùng chung tên schema `hrm_schema`, và bảng nghiệp vụ có cột `tenant_id`. Tenant context do nền tảng xử lý; thiết kế này không thêm cơ chế tách tenant riêng và giữ quy ước `tenant_id` trên bảng mới.

**Chính sách làm thêm và nghỉ bù dùng cơ chế phiên bản chính sách sẵn có của HRM**, không tạo bảng cấu hình thứ hai. Repo đã có `hrm_schema.policies` và `hrm_schema.policy_versions` (loại `OT`, có `effective_from`, `effective_to`, `config_json`, trạng thái `DRAFT`, `ACTIVE`, `SUPERSEDED`), cùng bộ chọn `resolvePolicy` theo ngày và bộ kiểm tra chồng lấn khi xuất bản (`hrm-policy-versions.ts`). Khung giờ đêm hiện nằm sẵn trong `config_json` của chính sách OT (`nightStartMinute`, `nightEndMinute`). Cấu hình mới đặt trong nhóm `config_json.overtimeComp` của cùng phiên bản:
- Mỗi tenant có đúng một chính sách OT hiệu lực tại một thời điểm, áp dụng cho toàn doanh nghiệp. Không dùng phạm vi theo nhân viên (`employeeIds`) của cơ chế sẵn có cho tính năng này.
- Chính sách áp dụng cho một ngày là phiên bản có `effective_from` lớn nhất không vượt quá ngày đó; bảng công tháng M chọn theo ngày đầu tháng M.
- Chỉ cho xuất bản phiên bản có `effective_from` là ngày mùng 1; không cho hiệu lực giữa tháng (kiểm ở bước xuất bản).
- Không sửa đè phiên bản đã được kỳ đã chốt dùng; muốn đổi thì tạo phiên bản mới cho tháng sau. Dấu vết người tạo và thời điểm dùng cơ chế sẵn có (`created_by`, `created_at`, nhật ký chính sách), không làm bảng nhật ký riêng.
- Nội dung nhóm `overtimeComp`: `enabled`, `ruleSet`, các tham số ở mục 8. Đọc có mặc định và kiểm chặt dữ liệu người dùng gửi bằng `parseOvertimeCompPolicy` và `validateOvertimeCompPolicy` (`overtime-comp-policy.ts`).
- **Phiên bản mặc định:** khi bật tính năng cho tenant, hệ thống tạo sẵn một phiên bản mặc định (`CLOCK_WINDOW`, giá trị theo luật, `enabled` tắt) hiệu lực từ tháng bật. Nếu một tháng không có chính sách OT nào, chặn tính và báo lỗi cấu hình; không chọn cấu hình ngầm.

**Snapshot khi chốt công:** lúc chốt, lưu cấu hình đã dùng (mã phiên bản chính sách, `effective_from`, `ruleSet`, các tham số) vào cột `policy_snapshot` (jsonb) trên `timesheet_periods`. Kỳ đã chốt luôn đọc snapshot, không đọc cấu hình hiện tại, nên đổi chính sách không làm đổi kết quả kỳ cũ. Kỳ chưa chốt dùng chính sách theo tháng; nếu chính sách đổi sau khi đã tính nhưng chưa chốt thì chỉ cảnh báo và HR chọn tính lại. Dòng sổ quỹ giữ snapshot công thức riêng của mình.

**Chống ghi trùng (idempotency):** chuyển đổi nghỉ bù, giữ chỗ, xác nhận sử dụng, giải phóng và hết hạn đều có khóa nghiệp vụ duy nhất (mục 5); gọi lại không được cộng quỹ hai lần hay tạo giao dịch hết hạn trùng.

**Entitlement và chính sách:** quyền được dùng tính năng ở cấp nền tảng (entitlement, đã có trong `packages/platform/entitlement`) tách khỏi chính sách nghiệp vụ của tenant. Ô tích "Áp dụng quy tắc trần làm thêm và nghỉ bù" là một tham số chính sách, không thay thế entitlement; phải kiểm entitlement sẵn có trước khi thêm cái mới.

**Ai sửa gì:** tenant Admin hoặc HR có quyền `hrm.policy.manage` được chọn chế độ, sửa tham số và đặt tháng hiệu lực. Super Admin nền tảng quản lý module và entitlement, không sửa chính sách vận hành của tenant (nếu hỗ trợ thì theo quy trình có audit). Chính sách vẫn phải nằm trong ràng buộc pháp luật: giai đoạn đầu là hằng số kiểm khoảng giá trị và cảnh báo khi cấu hình vượt (ví dụ trần tháng lớn hơn 40 giờ), ghi rõ nguồn căn cứ trong mã.

### 2.3. Để sau, khi có yêu cầu thực tế

Các ý sau có trong tài liệu đề xuất kiến trúc nhưng chưa cần cho giai đoạn này:
- Chính sách theo phạm vi (đơn vị, nhà máy, nhân viên) và Policy Assignment Engine.
- Vòng đời chính sách `DRAFT`, `SCHEDULED`, `SUPERSEDED`, `CANCELLED`, bảng nhật ký thay đổi riêng và quy trình phê duyệt thay đổi chính sách qua module Quy trình.
- `calculation_run`, `snapshot_hash`, kho phiên bản ràng buộc pháp lý toàn cục.
- Chu kỳ chấm công không theo tháng dương lịch.
- Bảng theo dõi phiên bản module ở lõi (nền tảng đã theo dõi migration từng tenant qua `integration_schema.schema_migrations`), kế hoạch triển khai theo đợt và canary.
- Kiểm thử hai tenant thật chạy đồng thời (giai đoạn đầu dùng test đơn vị với hai chính sách khác nhau).
- Quy tắc tùy chỉnh bằng code hoặc script: không hỗ trợ.

## 3. Phân loại giờ làm thêm và ca đêm

### 3.1. Nguyên tắc

Mục này mô tả chế độ `NIGHT_REST` (3.2 đến 3.9) đã đối chiếu với dữ liệu Savina. Chế độ `CLOCK_WINDOW` mô tả ở 3.10.

- Làm thêm tính theo lịch làm việc (phân ca) của nhân viên: giờ nằm ngoài ca là giờ làm thêm. Sáng thứ 7 nằm trong giờ làm việc nên không phải làm thêm; làm thêm thứ 7 bắt đầu từ chiều.
- Mỗi ca làm thêm được phân thành hai phần: **làm thêm** và **ca đêm**. Tổng hai phần bằng số giờ của ca.
- Không dùng mốc 22:00 hay trần 4 giờ mỗi ngày để cắt. Hai quy tắc này đã kiểm chứng và bị bác (xem 3.8).

### 3.2. Ca không xuyên đêm

Ca kết thúc trước 00:00: **toàn bộ là làm thêm**, không phân biệt thứ trong tuần, không cắt theo giờ. Ví dụ thứ 7 13:00 đến 18:00 là 5 giờ làm thêm; chủ nhật 07:00 đến 18:00 là 11 giờ làm thêm.

### 3.3. Ca xuyên đêm (quy tắc "chốt 8 giờ")

Ca kết thúc từ 00:00 trở đi (kể cả đúng 00:00) cần biết **ngày làm việc kế tiếp có được nghỉ không**:

```
f        = phần ngày làm việc kế tiếp được nghỉ sau ca đêm (1 cả ngày, 0,5 nửa ngày, 0 không nghỉ)
ca_đêm   = min( số giờ của ca , giờ_bù_mỗi_ngày_nghỉ × f )     (giờ_bù_mỗi_ngày_nghỉ mặc định 8)
làm_thêm = số giờ của ca − ca_đêm
```

Nghĩa là mỗi ngày nghỉ sau ca đêm được bù tối đa 8 giờ "ca đêm"; phần ca còn lại là làm thêm. Hôm sau đi làm bình thường thì cả ca là làm thêm.

Ví dụ:

| Ca | Hôm sau | Ca đêm | Làm thêm |
|---|---|---|---|
| 18:00 đến 04:00 (10 giờ) | Nghỉ cả ngày | 8 | 2 |
| 18:00 đến 00:00 (6 giờ) | Nghỉ cả ngày | 6 | 0 |
| 17:00 đến 07:30 (14,5 giờ) | Nghỉ cả ngày | 8 | 6,5 |
| 17:30 đến 07:00 (13,5 giờ) | Nghỉ nửa ngày | 4 | 9,5 |
| 17:00 đến 05:00 (12 giờ) | Đi làm bình thường | 0 | 12 |

Ngày nghỉ hằng tuần (chủ nhật) và ngày lễ không được tính là ngày nghỉ bù cho ca đêm.

### 3.4. Nguồn dữ liệu "ngày nghỉ sau ca đêm"

Ngày nghỉ sau ca đêm là dữ liệu đầu vào chung của ba việc: phân loại ca đêm, trừ ngày công (mục 4.3) và đối soát 1Office. Phải lưu thành bản ghi có cấu trúc (mục 5), gắn với ca làm thêm, không để ở ghi chú tự do. Trên 1Office hiện chỉ có ghi chú tự do dạng "Nghỉ 6 ngày: 07-08-13-14-15-16/10", và ghi chú này không nhất quán: có người ghi theo ngày của ca, có người ghi theo ngày hôm sau.

### 3.5. Ca xuyên tháng

Ca bắt đầu ở tháng trước và kết thúc ở tháng sau được tách tại 00:00 ngày mùng 1; mỗi tháng chỉ tính phần thuộc tháng đó (1Office làm vậy: ca 17:00 ngày 31/08 đến 04:00 ngày 01/09 chỉ có 4 giờ tính vào tháng 9). Tổng hợp bảng công phải tách theo tháng dù đơn không bị chặn.

### 3.6. Công tác phí (CTP) và ngày lễ

- **Công tác phí:** nhân viên đi dự án ngoài thành phố là nhận CTP, không cần làm thêm. Đơn công tác ghi CT (cả ngày) hoặc CT/2 (nửa ngày) theo thời gian đi thực tế. Làm thêm giờ phải thực sự làm việc và tính theo thời gian làm thực tế. Hai khoản này là bản ghi tách biệt.
- **Ngày lễ:** nhóm riêng "tăng ca ngày lễ" (`HOLIDAY_OT`), có tham số riêng (mục 8). Ngày vừa là lễ vừa là cuối tuần thì ưu tiên ngày lễ. Dữ liệu 1Office tháng 9 và 10 chưa có ca nào rơi vào ngày lễ cần đối chiếu.

### 3.7. Sửa tay

Hệ thống gợi ý phân loại theo 3.2 và 3.3. HR và quản lý trực tiếp có thể sửa phân loại từng ca (số giờ làm thêm, số giờ ca đêm, ngày nghỉ sau ca) và phải ghi lý do; mọi lần sửa lưu người sửa, thời điểm, giá trị cũ. Đây là chỗ xử lý các trường hợp ngoài quy tắc (3.9).

### 3.8. Kết quả kiểm chứng

Chạy trên toàn bộ 157 dòng của sheet "Làm thêm giờ - Ca đêm" (tháng 9: 75 dòng, tháng 10: 82 dòng), đối chiếu với đơn làm thêm tương ứng:

| Phép thử | Tháng 10 | Tháng 9 |
|---|---|---|
| Quy tắc cũ "cắt 4 giờ mỗi ngày" | 41/82 | chưa chạy |
| Quy tắc 3.2 và 3.3, ngày nghỉ lấy từ ghi chú, hiểu theo ngày hôm sau | **75/82** | **68/75** |
| Như trên, mỗi dòng chọn hiểu theo ngày của ca hoặc ngày hôm sau | 80/82 | 71/75 |
| Cho phép chọn ngày nghỉ tự do từng ca | **80/82** | **73/75** |

- Kết quả chung: **143/157 (91%)** theo ghi chú; **153/157 (97%)** nếu ngày nghỉ từng ca được ghi đúng.
- Phần lệch chủ yếu do ghi chú ghi ngày nghỉ không đồng nhất, tức là lỗi nhập liệu, không phải lỗi quy tắc.
- Riêng quy tắc không xuyên đêm: 29/30 dòng không có ca xuyên đêm ra 100% làm thêm.
- Tháng 9 có 4 dòng đơn bắt đầu từ 31/08 không đối chiếu được, vì chỉ phần trong tháng 9 được tính (3.5).
- Các quy tắc đã thử và bị bác: cắt 4 giờ mỗi ngày (41/82), cắt theo khung 22:00 đến 06:00 (30/82), chốt 8 giờ áp dụng như trần làm thêm (39/82), "cuối tuần là ca đêm", "ca chạm khung đêm thì cả ca là ca đêm".

### 3.9. Trường hợp ngoài quy tắc (cần HR xác nhận hoặc sửa tay)

| Trường hợp | Nội dung |
|---|---|
| Ca không xuyên đêm bị tính ca đêm | Ca ban đêm trong ngày nghỉ của nhân viên (ví dụ ca 20:00 đến 22:00 và ca 18:00 đến 23:00, cả hai đều trong ngày nhân viên nghỉ) ra ca đêm thay vì làm thêm. Có thể mở rộng quy tắc 3.2 theo ngày nghỉ của chính ngày làm việc. |
| Nghỉ nửa ngày | Một ca 11 giờ với nửa ngày nghỉ ra 7 giờ ca đêm, không phải 4 giờ. Chưa rõ quy tắc. |
| Lỗi nhập liệu nguồn | Một dòng tháng 9 ghi 44 giờ làm thêm cho ca 11 giờ (13:00 đến 00:00); số đúng là 11. Lỗi này nằm trong tổng 109 giờ làm thêm của nhân viên đó: giờ dư đúng là 36 (6,75 ngày nghỉ bù), bảng đang ghi 69 (12,9375 ngày), dôi 6,1875 ngày. Phải sửa trước khi nhập. |

### 3.10. Chế độ `CLOCK_WINDOW` (mặc định cho tenant mới)

Cắt ca làm thêm tại các mốc khung đêm (mặc định 22:00 đến 06:00), nửa đêm và đổi loại ngày. Từng đoạn thuộc một nhóm (ngày thường, đêm, cuối tuần, lễ) và có hệ số riêng khai báo trong cấu hình. Ví dụ ca 20:00 đến 02:00 được chia tại 22:00 và 00:00. Chế độ này không cần trường "hôm sau nghỉ". Chưa đối chiếu với dữ liệu tenant nào; sẽ viết test theo các tình huống chuẩn (làm 20:00 đến 02:00, 17:00 đến 23:00, ca qua ngày lễ). Cách tính giờ đêm theo luật cần pháp chế xác nhận trước khi dùng thật.

## 4. Trần tháng, quy đổi nghỉ bù và ngày công

### 4.1. Công thức

```
giờ_làm_thêm_thực_tế = tổng giờ làm thêm trong tháng (sau phân loại, không tính ca đêm)
giờ_tính_lương_làm_thêm = min(giờ_làm_thêm_thực_tế, trần_tháng, trần_năm còn lại)
giờ_dư  = giờ_làm_thêm_thực_tế − giờ_tính_lương_làm_thêm
số_ngày = round( giờ_dư / số_giờ_một_ngày × hệ_số , 1 )
cột "Giờ làm thêm/Ca đêm" = giờ_tính_lương_làm_thêm + giờ ca đêm
```

Kiểm chứng: cột này (cột AL của sheet "TH") khớp công thức ở 20/20 nhân viên tháng 9 và 21/21 nhân viên tháng 10. Giờ dư và số ngày nghỉ bù (giờ dư / 8 × 1,5) khớp ở các dòng đối chiếu của cả hai tháng. Ca đêm không bị cắt trần (có người 82 giờ ca đêm vẫn giữ nguyên). Bảng gốc ghi số ngày nghỉ bù không làm tròn và tính vào tháng kế tiếp.

### 4.2. Ví dụ (NV-A, tháng 10/2026, số của 1Office)

| Dòng tuần | Làm thêm | Ca đêm |
|---|---|---|
| 03 đến 04/10 | 17 | 0 |
| 06 đến 12/10 | 16 | 28 |
| 12 đến 18/10 | 24 | 32 |
| 31/10 | 6 | 0 |
| **Tổng** | **63** | **60** |

Giờ tính lương 40, giờ dư 23, `23 / 8 × 1,5 = 4,3125`, làm tròn 4,3 ngày. Cột "Giờ làm thêm/Ca đêm" là `40 + 60 = 100`.

Các ca 18:00 đến 04:00 và 18:00 đến 00:00 của tuần 06 đến 12/10 ra 16 và 28 khi áp quy tắc 3.3 với bốn ngày nghỉ liền sau bốn đêm đầu tuần.

### 4.3. Ngày công làm việc

```
ngày_công = công_chuẩn − ngày_nghỉ_sau_ca_đêm − ngày_nghỉ_không_lương
```

Khớp 19/20 nhân viên tháng 9 và 20/21 nhân viên tháng 10 (xem 3.4 về nguồn ngày nghỉ). Phần đếm công theo mã ngày có thể vượt công chuẩn vì công tác thứ 7 và chủ nhật đếm đủ; bảng cắt về tối đa bằng công chuẩn.

## 5. Mô hình dữ liệu (migration mới, `hrm_schema`)

**`overtime_blocks`** (một dòng cho mỗi ca làm thêm của đơn):

| Cột | Ý nghĩa |
|---|---|
| `request_id`, `employee_id`, `start_at`, `end_at`, `hours` | Ca làm thêm và số giờ |
| `crosses_midnight` | Kết thúc từ 00:00 trở đi |
| `rest_fraction_suggested`, `ot_hours_suggested`, `night_hours_suggested` | Kết quả gợi ý theo 3.2 và 3.3 |
| `ot_hours_final`, `night_hours_final` | Giá trị chính thức (mặc định bằng gợi ý, sửa tay được) |
| `overridden_by`, `override_reason`, `overridden_at` | Dấu vết sửa tay |
| `source` | `RULE`, `MANUAL`, `IMPORT_1OFFICE` |
| `period_month` | Tháng tính (sau khi tách theo 3.5) |

**`night_rest_days`** (ngày nghỉ sau ca đêm): `employee_id`, `rest_date`, `fraction` (0,5 hoặc 1), `block_id` (ca đêm liên quan), `created_by`, `reason`. Ngày này không tính công (trừ vào ngày công, mục 4.3) và không dùng quỹ nghỉ bù. Là loại ngày trên bảng công, tách khỏi loại nghỉ "Nghỉ bù" (`COMPENSATORY`).

**Cấu hình:** không có bảng mới. Tham số ở mục 8 lưu trong `config_json.overtimeComp` của phiên bản chính sách OT (`policy_versions`), xem 2.2. `overtime_blocks.policy_version_id` trỏ tới phiên bản đã dùng.

**`timesheet_periods`** (bảng sẵn có): thêm cột `policy_snapshot` (jsonb), ghi khi chốt công.

**`comp_off_ledger`** (chỉ thêm, không sửa; sai thì tạo giao dịch đảo):

| Cột | Ý nghĩa |
|---|---|
| `id`, `employee_id`, `occurred_on` | Khóa, nhân viên, ngày phát sinh |
| `kind` | `ACCRUAL`, `RESERVE`, `USAGE`, `RELEASE`, `ADJUST`, `EXPIRE` |
| `days` | Số ngày (dương hoặc âm), 1 chữ số thập phân |
| `lot_id`, `expires_on` | Lô nguồn; hạn dùng (null nếu không hạn) |
| `period_month` | Tháng bảng công nguồn |
| `source_hours`, `cap_hours`, `excess_hours`, `factor`, `day_basis_hours` | Snapshot công thức |
| `policy_snapshot` (jsonb) | Cấu hình đã dùng, để kỳ đã chốt không đổi khi sửa cấu hình |
| `request_id` | Đơn nghỉ bù liên quan |
| `reason`, `created_by`, `created_at` | Lý do, người thực hiện, thời điểm |
| `idempotency_key` | Khóa nghiệp vụ duy nhất theo (`tenant_id`, `kind`, khóa): ACCRUAL theo (nhân viên, tháng nguồn); RESERVE, USAGE, RELEASE theo (đơn, lô); EXPIRE theo lô. Gọi lại không tạo giao dịch thứ hai. |

Số dư khả dụng = tổng `days` của lô chưa hết hạn, đã trừ giữ chỗ.

**`leave_types`**: thêm `COMPENSATORY` ("Nghỉ bù"): có lương, có quỹ riêng, không trừ phép năm.

## 6. Luồng nghiệp vụ

1. **Tạo đơn làm thêm:** nhân viên nhập các ca. Với ca xuyên đêm, nhập "hôm sau nghỉ: không, nửa ngày, cả ngày". Hệ thống tính gợi ý theo mục 3, lưu vào `overtime_blocks`.
2. **Duyệt đơn:** quản lý duyệt như hiện nay; HR được sửa phân loại (3.7).
3. **Tổng hợp bảng công tháng:** cộng giờ làm thêm và ca đêm theo `*_final`, tách ca xuyên tháng (3.5), áp trần (4.1), trừ ngày nghỉ sau ca đêm khỏi ngày công (4.3).
4. **Chốt công:** lưu `policy_snapshot` vào kỳ (2.2). Từ đây kỳ đọc snapshot, không đọc chính sách hiện tại.
5. **Chuyển đổi nghỉ bù (thủ công):** màn hình liệt kê từng nhân viên: giờ thực tế, giờ tính lương, giờ dư, số ngày đề xuất. HR chỉnh dòng nếu cần rồi xác nhận, tạo `ACCRUAL`. Hủy được khi lô chưa dùng.
6. **Đơn nghỉ bù:** kiểm số dư khả dụng và bội số 0,5 ngày; tạo `RESERVE` theo lô gần hết hạn trước. Khóa dòng khi ghi để hai đơn đồng thời không dùng chung số dư. Duyệt: `RESERVE` thành `USAGE`. Từ chối, rút, hủy: `RELEASE`.
7. **Bảng lương:** lấy giờ làm thêm tính lương, giờ ca đêm; giờ dư không trả tiền.
8. **Hết hạn:** tác vụ nền tạo `EXPIRE` cho lô quá hạn.
9. **Sửa chấm công sau khi đã cộng quỹ:** không xóa lô; tạo giao dịch điều chỉnh. Nếu quỹ đã dùng thì cảnh báo HR xử lý, không tự trừ số âm.

## 7. API, quyền và giao diện

**Quyền mới** (chỉ thêm vào `TENANT_PERMISSION_ACTIONS`, mọi route có `@RequirePermission`): `hrm.comp_off.view`, `hrm.comp_off.convert`, `hrm.comp_off.adjust`, `hrm.overtime.classify` (sửa phân loại ca), `hrm.policy.view`, `hrm.policy.manage` (xem, và tạo hoặc sửa chính sách làm thêm và nghỉ bù). Quyền chuyển đổi, điều chỉnh quỹ và phân loại ca độc lập với quyền quản lý chính sách; quản lý trực tiếp không mặc nhiên có quyền sửa chính sách. Cần đồng bộ vai trò mẫu bằng `seedHrmRoleTemplates?sync=true` sau khi deploy.

**API chính:** cấu hình (xem, sửa); xem trước phân loại một đơn; sửa phân loại ca; xem trước chuyển đổi theo tháng; xác nhận chuyển đổi; danh sách số dư; sổ giao dịch theo nhân viên; điều chỉnh thủ công.

**Giao diện** (dùng `SearchableSelect`, không emoji, chữ tiếng Việt có dấu):
- `/modules/hrm/leave`: thêm tab "Quỹ nghỉ bù": số dư theo nhân viên (đã nhận, đã dùng, giữ chỗ, còn lại, sắp hết hạn), xem sổ giao dịch, màn hình chuyển đổi tháng.
- `/modules/hrm/settings?view=leave`: khối "Nghỉ bù" và "Làm thêm và ca đêm" với các tham số mục 8.
- Form đơn làm thêm: với ca xuyên đêm hiện thêm lựa chọn "Hôm sau nghỉ"; hiện ngay kết quả gợi ý "làm thêm / ca đêm".
- Màn hình HR xem và sửa phân loại từng ca, có cột lý do sửa.
- Form đơn nghỉ: chọn "Nghỉ bù" hiện số dư khả dụng và hạn gần nhất; chặn vượt số dư và số ngày lẻ khác 0,5.

## 8. Tham số cấu hình (`/modules/hrm/settings?view=leave`)

Các tham số dưới đây là nội dung nhóm `overtimeComp` của một phiên bản chính sách OT có `effective_from` (2.2). Màn hình hiển thị chính sách đang hiệu lực, cho tạo phiên bản mới có hiệu lực từ đầu một tháng sau, xem lịch sử các phiên bản, và chỉ hiện tham số liên quan đến chế độ đang chọn.

| Nhóm | Tham số | Mặc định |
|---|---|---|
| Áp dụng | Bật quy tắc trần làm thêm và nghỉ bù (ô tích) | Tắt |
| Giờ chuẩn | Số giờ chuẩn một ngày làm việc | 8 |
| Trần luật | Trần làm thêm theo tháng (giờ) | 40 |
| | Trần làm thêm theo năm (giờ) | 200 |
| Phân loại | Chế độ phân loại (`NIGHT_REST` hoặc `CLOCK_WINDOW`) | `CLOCK_WINDOW` (Savina đặt `NIGHT_REST`) |
| | Cho HR sửa tay phân loại từng ca | Bật |
| | Chỉ ở `NIGHT_REST`: số giờ ca đêm bù cho mỗi ngày nghỉ sau ca đêm | 8 |
| | Chỉ ở `NIGHT_REST`: cho phép nghỉ nửa ngày | Bật |
| | Chỉ ở `NIGHT_REST`: ngày hằng tuần và ngày lễ có tính là ngày nghỉ bù ca đêm không | Không |
| | Chỉ ở `NIGHT_REST`: ca không xuyên đêm | Toàn bộ là làm thêm |
| | Chỉ ở `CLOCK_WINDOW`: khung giờ đêm | 22:00 đến 06:00 |
| | Chỉ ở `CLOCK_WINDOW`: hệ số theo nhóm (ngày thường, đêm, cuối tuần) | Trống |
| Trả lương | Áp trần tháng và năm vào giờ làm thêm tính lương | Theo ô "Áp dụng" |
| | Ca đêm có bị cắt trần không | Không |
| | Tháng cộng quỹ nghỉ bù (cùng tháng hoặc tháng kế tiếp) | Tháng kế tiếp |
| Tăng ca ngày lễ | Bật nhóm "tăng ca ngày lễ" riêng | Bật |
| | Hệ số lương tăng ca ngày lễ | Theo chính sách lương |
| | Có tính vào trần tháng và năm không | Chưa chốt |
| | Có quy đổi nghỉ bù khi vượt trần không | Chưa chốt |
| | Hệ số quy đổi nghỉ bù riêng cho ngày lễ (trống là dùng hệ số chung) | Trống |
| Quy đổi | Hệ số quy đổi giờ dư thành nghỉ bù | 1,5 |
| | Số giờ quy đổi một ngày nghỉ | Bằng giờ chuẩn |
| | Số chữ số thập phân khi lưu | 1 |
| | Phương pháp làm tròn (gần nhất, xuống, lên) | Gần nhất |
| | Bước dùng tối thiểu khi tạo đơn (ngày) | 0,5 |
| Chuyển đổi | Chỉ cho chuyển khi bảng công đã chốt | Bật |
| | Người được chuyển đổi (qua quyền `convert`) | HR |
| Hạn dùng | Hạn dùng theo số tháng từ tháng phát sinh (0 là không hạn) | 0 |
| | Trần tích lũy tối đa (ngày, trống là không giới hạn) | Trống |
| | Thứ tự dùng lô | Gần hết hạn trước |
| Đơn | Giữ chỗ số dư khi gửi đơn | Bật |

Không còn tham số "quy tắc cuối tuần": thứ 7 và chủ nhật theo phân ca của nhân viên.

## 9. Chốt chặn đơn từ

Đã có: hạn mức đơn theo ngày ghi trong đơn (`REQUEST_MONTHLY_QUOTA_EXCEEDED`), chặn đơn vượt tháng (`REQUEST_CROSSES_MONTH`), khóa bảng công chặn tạo đơn của tháng đó.

Còn lại, làm thành việc riêng:
- Tách `requests_closed_at` (hạn nhận đơn) khỏi trạng thái khóa kỳ công; kiểm riêng quyền tạo, sửa, duyệt, tính lại, mở lại.
- Cảnh báo trên giao diện khi chọn khoảng ngày qua hai tháng.
- Đồng bộ quyền duyệt sau deploy: migration lõi `0014` gộp action duyệt; vai trò mẫu cần chạy `?sync=true` từng tenant, ghi nhận tenant đã và chưa đồng bộ.
- Đơn nhập từ 1Office sẽ vi phạm hạn mức và chốt chặn vượt tháng (có đơn 31/08 đến 01/09); xem mục 10.

## 10. Kế hoạch nhập dữ liệu 1Office (tháng 9 và 10/2026)

Script gọi API của hrm-api, không ghi trực tiếp DB; nhận đường dẫn các file Excel qua tham số. File Excel chứa dữ liệu nhân sự thật, không đưa vào repo. Script là công cụ riêng cho Savina, đặt ở thư mục công cụ (`tools/`), không nằm trong module HRM, và bỏ đi sau khi nhập xong; mọi xử lý riêng của 1Office (đoán ghi chú, lỗi nhập liệu) nằm ở đây. Trước khi nhập, tạo dòng chính sách của tenant demo hiệu lực từ tháng 9/2026 với chế độ `NIGHT_REST`; nhập lại bằng cùng script không được tạo bản ghi hay giao dịch quỹ trùng (idempotency).

1. Ánh xạ nhân viên theo mã `NS_xxx`; bỏ qua đơn nháp, thử nghiệm, nghỉ việc, vắng.
2. Phân tích cột "Chi tiết ngày" của đơn làm thêm (hai định dạng `Từ HH:MM DD/MM/YYYY - HH:MM DD/MM/YYYY` và `Từ HH:MM - HH:MM, DD/MM/YYYY`).
3. Lấy ngày nghỉ sau ca đêm từ cột "Ghi chú" của sheet "Làm thêm giờ - Ca đêm" ("Nghỉ N ngày: ...", "Nghỉ nửa ngày ..."). Với mỗi dòng, giải ngày nghỉ từng ca sao cho tổng làm thêm và ca đêm khớp bảng 1Office (thử cách hiểu theo ngày của ca và ngày hôm sau); dòng không giải được thì đưa vào báo cáo cần HR xem.
4. Tách ca xuyên tháng tại 00:00 ngày mùng 1.
5. Xóa dữ liệu tự sinh của tháng 9 và 10; nạp ca, nghỉ, làm thêm, công tác, chấm công vào/ra.
6. Với tenant demo: tạm nâng hạn mức và nới chốt chặn vượt tháng khi nhập.
7. Không nhập số sai của nguồn (lỗi 44 giờ ở mục 3.9); báo để HR sửa.
8. Chạy tổng hợp bảng công, chốt công, bảng lương, xuất file; đối soát với Excel.

Còn thiếu từ phía người dùng: danh sách ngày lễ tháng 9 (2/9) và tháng 10. Dữ liệu seed hiện chỉ đến 31/03/2027.

## 11. Thứ tự triển khai và tiêu chí nghiệm thu

| Giai đoạn | Nội dung | Đầu ra |
|---|---|---|
| 0 | Tài liệu này | Chốt quy tắc |
| 1 | Migration 0077 (`policy_snapshot`, sổ quỹ có khóa idempotency, `overtime_blocks`, `night_rest_days`; cấu hình nằm trong `config_json.overtimeComp` của chính sách OT sẵn có), khung chính sách phân loại (giao diện chung cho hai chế độ), triển khai `NIGHT_REST` trước để khớp Savina và `CLOCK_WINDOW` ở mức cơ bản, hàm trần và quy đổi, test; hàm thuần ở tầng domain | Test đạt trên bộ dữ liệu mẫu ẩn danh; thêm chế độ mới không phải sửa phần tổng hợp; hai chính sách khác nhau cho kết quả khác nhau mà không đổi mã |
| 2 | Sổ quỹ, API, đơn làm thêm với ngày nghỉ sau ca, đơn nghỉ bù, nối bảng công và lương | Luồng đầu cuối ở API |
| 3 | Giao diện tab quỹ, cấu hình, màn hình HR sửa phân loại | Màn hình hoàn chỉnh |
| 4 | Script nhập 1Office và đối soát | Báo cáo chênh lệch |
| 5 | Rà soát giao diện, quyền, đồng bộ vai trò mẫu | Chuẩn bị PR |

**Lưu ý khi tích hợp ở giai đoạn 2 (đã đọc code hiện có):**
- `validateOt` trong `hrm-overtime.ts` đã cho phép một đơn làm thêm qua nửa đêm (tính thành một đơn theo cả khoảng giờ, phần sau 00:00 theo loại ngày của ngày kế tiếp); `NIGHT_REST` không cần nới điều kiện này. Nhưng đơn phải nằm ngoài ca của nhân viên, không chồng nghỉ phép hay công tác (công tác không bật `allow_ot` thì chặn OT trùng giờ), và chịu giới hạn của chính sách OT (`dailyLimitMinutes`, `weeklyLimitMinutes`, `monthlyLimitMinutes`, `yearlyLimitMinutes`). Dữ liệu 1Office có OT dài hơn 4 giờ mỗi ngày và OT trong lúc công tác, nên khi nhập phải đặt giới hạn chính sách đủ cao và bật `allow_ot` cho các đơn công tác nhập vào.
- `ot_requests` hiện lưu một khoảng giờ cho mỗi đơn (`work_date`, `start_time`, `end_time`) và loại `ot_type` (`WEEKDAY`, `WEEKEND`, `HOLIDAY`, `NIGHT`). `overtime_blocks` là bản phân loại chi tiết theo từng ca của đơn, không thay thế cột đó; cách nối với bảng công và bảng lương cần quyết định ở giai đoạn 2.
- Khung giờ đêm đã có sẵn trong chính sách OT; chế độ `CLOCK_WINDOW` của thiết kế này tái dùng đúng khóa đó.

**Tiêu chí nghiệm thu phân loại:** theo ghi chú nghỉ, tối thiểu **90%** số dòng khớp 1Office (đạt 91% trên 157 dòng); khi ngày nghỉ từng ca được ghi đúng thì khớp **97%**. Các dòng còn lại nằm trong mục 3.9 và được HR xử lý bằng sửa tay. Khớp tuyệt đối với 1Office không phải tiêu chí, vì 1Office có nhập sai và ghi chú không nhất quán.

**Bộ test bắt buộc:** ca không xuyên đêm (ngày thường, thứ 7 chiều, chủ nhật), kể cả ca dài hơn 4 giờ; ca xuyên đêm hôm sau làm, nghỉ nửa ngày, nghỉ cả ngày; ca dài hơn 8 giờ khi nghỉ cả ngày; ca kết thúc đúng 00:00; ca xuyên tháng; ca trong ngày lễ; đạt và vượt trần tháng (không xóa giờ khỏi báo cáo); ca đêm không bị cắt trần; nhiều lô khác hạn dùng (gần hết hạn trước); hai đơn nghỉ bù đồng thời; đơn bị rút, từ chối, hủy; đổi hệ số không ảnh hưởng kỳ đã chốt; bước 0,5 ngày; làm tròn 4,3125 thành 4,3; sửa tay phân loại có lưu dấu vết; chọn chính sách theo ngày hiệu lực (phiên bản có `effective_from` lớn nhất không vượt quá ngày đầu tháng), từ chối hiệu lực giữa tháng, báo lỗi khi tháng không có chính sách; đổi chính sách không làm đổi kết quả kỳ đã chốt (đọc `policy_snapshot`); gọi lại chuyển đổi, giữ chỗ và hết hạn không tạo giao dịch trùng; hai chính sách `NIGHT_REST` và `CLOCK_WINDOW` chạy cùng dữ liệu cho kết quả độc lập.

### 11.1. Trạng thái triển khai giai đoạn 2 (đã làm, đã kiểm trên PostgreSQL thật)

| Hạng mục | Cách đã làm |
|---|---|
| Migration 0078 | `ot_requests.next_day_rest` (NONE, HALF, FULL); `leave_types.comp_off` (mỗi tenant tối đa một loại, chỉ mục duy nhất một phần) |
| Đơn làm thêm | Nhận `nextDayRest`; khi duyệt, `syncOvertimeBlocks` ghi `overtime_blocks` (tách theo tháng, mỗi phần dùng chính sách của tháng đó) và `night_rest_days` (ngày làm việc kế tiếp, bỏ qua ngày nghỉ, lễ, Chủ nhật chưa phân ca). Ca đã sửa tay giữ giá trị chính thức khi chạy lại. Đảo đơn xóa ca và ngày nghỉ. Tháng chưa bật quy tắc không ghi gì |
| Chốt công | `lockTimesheetPeriod` chụp `policy_snapshot` (chính sách và số liệu từng nhân viên); mở lại kỳ xóa ảnh chụp. Kỳ không trùng một tháng dương lịch không chụp, lương dùng cách cũ. Chụp xong, đổi chính sách không đổi kỳ đã chốt |
| Bảng lương | Biến hệ thống mới `OT_COUNTED_MINUTES`, `NIGHT_MINUTES`, `OT_EXCESS_MINUTES`, `NIGHT_REST_DAYS`. Chưa bật quy tắc thì `OT_COUNTED_MINUTES` bằng `OT_MINUTES`, ba biến còn lại bằng 0, nên công thức lương cũ không đổi. Công thức của tenant muốn dùng quy tắc mới phải tham chiếu các biến này. Dấu vân tay bảng công có thêm băm của ảnh chụp (chỉ khi có) |
| Sổ quỹ | Giữ chỗ khi gửi đơn (`RESERVE`, lô gần hết hạn trước, khóa nhân viên chống hai đơn đồng thời); duyệt ghi `RELEASE` và `USAGE` cùng giao dịch; từ chối, rút, hủy (kể cả sau duyệt) ghi `RELEASE` phần đơn đang chiếm; mọi giao dịch có khóa idempotency nên gọi lại không ghi thêm |
| Chuyển đổi | Chỉ khi tháng đã chốt và quy tắc đã bật khi chốt. Một nhân viên chuyển đổi một lần cho mỗi tháng (khóa `accrual:nhân viên:tháng`); HR chỉnh số ngày khác đề xuất thì bắt buộc lý do; trần tích lũy cắt số ngày. Sửa sai bằng điều chỉnh, không hủy lô |
| Điều chỉnh, hết hạn | `ADJUST` dương mở lô mới (có hạn riêng), âm trừ theo lô gần hết hạn trước và không để âm; `EXPIRE` ghi một lần cho mỗi lô và mỗi ngày chạy |
| Cấu hình | `PUT /v1/overtime-comp/settings` xuất bản phiên bản mới của chính sách OT chỉ thay nhóm `overtimeComp` (kế thừa giới hạn và hệ số), hiệu lực từ mùng 1, không trùng ngày hiệu lực của phiên bản có sẵn; bật quy tắc thì tạo loại nghỉ "Nghỉ bù" |
| API và quyền | Controller `HrmCompOffController` (`/v1/overtime-comp/*`, `/v1/comp-off/*`); quyền mới `hrm.comp_off.view`, `hrm.comp_off.convert`, `hrm.comp_off.adjust`, `hrm.overtime.classify`, `hrm.policy.view`, `hrm.policy.manage`; vai trò mẫu Chấm công viên có `view`, `convert`, `classify`; Quản trị HRM có tất cả qua `hrm.manage` |

Còn lại sau giai đoạn 2: chưa có lịch chạy tự động cho `EXPIRE` (đang gọi qua `POST /v1/comp-off/expire`); chưa trừ ngày nghỉ sau ca đêm khỏi số công của dòng bảng công (hiện chỉ có biến `NIGHT_REST_DAYS` cho công thức lương và cột tổng hợp); cần chạy `seedHrmRoleTemplates?sync=true` ở từng tenant sau deploy.

Phát hiện khi kiểm thử: không thể xuất bản phiên bản chính sách OT có cùng ngày hiệu lực với phiên bản đã có (quy tắc sẵn của hệ chính sách); muốn bật quy tắc từ đúng ngày một phiên bản đang bắt đầu thì phải chọn tháng sau.

## 12. Câu hỏi còn mở

1. Ca không xuyên đêm trong ngày nghỉ của nhân viên có tính là ca đêm không (mục 3.9).
2. Quy tắc cho trường hợp nghỉ nửa ngày nhưng ra số giờ ca đêm khác 4 (mục 3.9).
3. Ngày nghỉ sau ca đêm có luôn là ngày làm việc kế tiếp, hay có thể là ngày cùng ca (ghi chú ghi không thống nhất). Cần chuẩn hóa cách ghi trên 1Office hoặc trong ERP.
4. Tăng ca ngày lễ: có tính vào trần 40 giờ và 200 giờ không, có quy đổi nghỉ bù không, hệ số bao nhiêu.
5. Hạn dùng quỹ: không hạn, theo số tháng, hay hết hạn cuối năm.
6. Sửa chấm công sau chuyển đổi: cho phép chuyển đổi lại hay chỉ điều chỉnh bằng giao dịch.
7. Có nới hạn mức đơn và chốt chặn vượt tháng cho tenant demo khi nhập dữ liệu không.
8. Hỏi HR của ít nhất một tenant khác cách họ phân loại ca đêm và làm thêm, để biết `NIGHT_REST` đặc thù Savina hay phổ biến, và để kiểm `CLOCK_WINDOW` bằng dữ liệu thật.
9. Pháp chế xác nhận cách tính giờ làm việc ban đêm và làm thêm ban đêm theo luật (mức cộng thêm tiền lương) để cấu hình mặc định của `CLOCK_WINDOW`.
10. Pháp chế xác nhận: trần theo ngành, và việc trả phần ca bù theo giờ đêm trong khi ca đó vượt giờ làm bình thường (về bản chất là giờ làm thêm). Việc quy đổi phần dư sang nghỉ bù không làm giờ đó hợp pháp hơn, vẫn phải báo cáo giờ làm thêm thực tế.
11. Kỳ đã tính nhưng chưa chốt khi chính sách đổi: chỉ cảnh báo và để HR chọn tính lại (đề xuất), hay bắt buộc tính lại.
12. Có cần người thứ hai duyệt khi đổi chính sách không (đề xuất giai đoạn này: không, tenant Admin hoặc HR tự đổi và có lưu người đổi).
13. Ngày hiệu lực giữa tháng: đề xuất không hỗ trợ, chỉ từ đầu tháng. Cần xác nhận tenant chấp nhận giới hạn này.
