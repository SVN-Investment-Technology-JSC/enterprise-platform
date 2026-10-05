# KẾ HOẠCH HOÀN THIỆN CHỨC NĂNG ĐƠN TỪ HRM VÀ KẾT NỐI PROCEDURE ENGINE (HRM_FIX_05_DONTU_PE_PLAN.md)

Ngày lập: 05/10/2026. Nguồn: đọc mã nhánh `hai`, issue ISS-BE-001, yêu cầu nghiệp vụ do chủ sản phẩm bổ sung ngày 05/10/2026.
Phạm vi: 7 loại đơn (nghỉ, OT, công tác, đổi ca, giải trình công, tạm ứng, chỉnh sửa hồ sơ), module HRM và Procedure Engine (PE).
Trạng thái: đang triển khai theo 5 đợt. Nhật ký tiến độ để tiếp tục khi phiên bị ngắt: HRM_FIX_05_PROGRESS.md.

Chỉ đạo bổ sung của chủ sản phẩm (05/10/2026), thay thế các phần mâu thuẫn bên dưới:
- Quy trình cũ không cần script đồng bộ (bỏ rủi ro số 2 ở mục 6).
- Chặn người khởi tạo tự duyệt ở chế độ PE đã do node S (phân cấp quản lý trực tiếp, `initiator_manager`) đảm nhiệm; không sửa PE cho việc này (bỏ gạch cuối của FIX-E-07 và rủi ro số 6).
- Các module không được truy cập DB của nhau, chỉ qua API. Mọi truy vấn `procedure_schema.*` từ HRM (kể cả `hrm-procedure-links.ts`, reconcile, tiến độ) phải thay bằng API nội bộ của PE.

---

## 1. Yêu cầu đã chốt

1. Platform là SaaS đa tenant. Tenant có thể bật PE, bật HRM, hoặc bật cả hai.
2. PE là bộ quy trình duyệt cho hầu hết chức năng. Đơn từ gắn với PE bằng thao tác thủ công của quản trị.
3. "Tạo đồng thời": khi đơn nối với PE, nhân viên điền form tạo đơn thì đơn xuất hiện ngay trong lịch sử đơn của HRM, và quy trình duyệt xuất hiện trong module PE.
4. Tiến độ duyệt phải cập nhật trong chi tiết đơn.
5. Mỗi loại đơn có form riêng và gắn PE riêng.
6. Điều kiện động ở bước S (bước đầu) của PE phải liên kết được với các trường của form tạo đơn.
7. Khi không có PE: mặc định duyệt trực tiếp (DIRECT).
8. Khi tạo đơn và gửi thành công, bước S của quy trình tự hoàn thành. Người nộp không phải quay lại PE để "duyệt bước S đầu tiên".

---

## 2. Luồng xử lý đích

### 2.1. Khi đơn nối với PE (binding chế độ PROCEDURE)

```
Nhân viên mở form tạo đơn
  |  (form = trường cốt lõi của loại đơn + thuộc tính động lấy từ định nghĩa PE đã gắn,
  |   chọn theo loại đơn VÀ mã loại con)
  v
Nhân viên bấm Gửi
  v
[HRM - giao dịch 1]
  1. Kiểm tra nghiệp vụ (số dư phép, kỳ khóa công, trùng ngày...)
  2. Ghi đơn (status PENDING) + ghi procedure_links (START_PENDING, chụp phiên bản định nghĩa)
  3. Đơn đã hiện trong "Lịch sử đơn" với nhãn "Đang khởi tạo quy trình"
  v
[HRM -> PE, gọi ngay sau commit]
  4. Tạo instance PE từ định nghĩa đã chụp, truyền giá trị thuộc tính từ form
  5. PE hoàn thành bước S ngay trong cùng giao dịch của PE (cờ autoCompleteInitiatorStep):
       - kiểm tra thuộc tính bắt buộc của bước S
       - ghi nhật ký "Người nộp hoàn thành bước S khi gửi đơn"
       - đánh giá cổng điều kiện (dùng giá trị form) và chuyển sang bước duyệt đầu tiên
  6. PE trả instance_code, bước hiện tại, người xử lý bước hiện tại
  v
[HRM - giao dịch 2]
  7. Ghi link RUNNING, ghi vào đơn: current_step_name, current_assignee, workflow_status
  8. Lịch sử đơn đổi nhãn sang "Đang chờ [tên người / vai] duyệt - [tên bước]"
  v
Người duyệt xử lý trong PE (hoặc ngay trong HRM qua endpoint actions, mục E-06)
  v
[PE phát sự kiện mỗi lần chuyển bước và khi kết thúc]
  9. Worker HRM cập nhật tiến độ vào đơn; khi PE kết thúc thì áp kết quả nghiệp vụ
     (trừ phép, duyệt OT...) trong một giao dịch như hiện nay
```

Điểm khác với hiện tại: bước 5 (tự hoàn thành S), bước 7 và 9 (tiến độ ghi vào đơn khi chuyển bước, không chỉ khi kết thúc).

Nếu PE lỗi ở bước 4: đơn vẫn tồn tại ở trạng thái "Đang khởi tạo quy trình" (link `START_PENDING` hoặc `FAILED`), worker thử lại mỗi phút như hiện nay. Người dùng thấy đơn trong lịch sử, không phải điền lại. Không thể bảo đảm "tất cả hoặc không gì cả" giữa hai dịch vụ; cách trên là at-least-once, có khóa idempotency, và đơn không bao giờ mất.

### 2.2. Khi không có PE (binding DIRECT)

```
Nhân viên điền form (chỉ trường cốt lõi, không có thuộc tính động)
  v
Bấm Gửi -> HRM ghi đơn PENDING, không có procedure_links
  v
Đơn hiện ở "Lịch sử đơn" và ở hàng chờ của người duyệt hợp lệ
  v
Người duyệt bấm Duyệt / Từ chối trong màn Duyệt đơn của HRM
  v
HRM áp kết quả nghiệp vụ ngay (trừ phép...)
```

Quy tắc người duyệt DIRECT (chặn ISS-BE-001):
- Người duyệt phải là quản lý trực tiếp, hoặc trưởng đơn vị chứa nhân viên, hoặc có quyền `*.approve.all`.
- Không ai được duyệt đơn của chính mình (403 `SELF_APPROVAL_FORBIDDEN`), trừ khi tenant bật ngoại lệ (mặc định tắt).
- Danh sách đơn chờ chỉ gồm đơn trong phạm vi của người duyệt.

### 2.3. Chọn chế độ theo tenant

| Tình huống tenant | Hành vi |
|---|---|
| Chỉ có HRM, không có PE | Mọi loại đơn tự động chế độ DIRECT. Giao diện cấu hình ẩn tùy chọn PROCEDURE. |
| Có HRM và PE | Quản trị gắn từng loại đơn (và mã loại con) với một định nghĩa PE đã công bố; không gắn thì DIRECT. |
| Tenant mới cấp HRM | Hệ thống tự tạo 7 binding DIRECT khi cấp module. Không còn lỗi 409 "Chưa cấu hình chế độ duyệt". |
| Đang gắn PROCEDURE rồi PE bị tắt | Không tự hạ sang DIRECT (tránh lách kiểm soát). Gửi đơn trả 409 kèm thông báo rõ; quản trị thấy cảnh báo ở màn cấu hình và phải tự chuyển sang DIRECT. |

---

## 3. Khoảng trống hiện tại so với luồng đích

| # | Khoảng trống | Vị trí |
|---|---|---|
| G1 | Bước S không tự hoàn thành; instance dừng ở bước đầu chờ người nộp xử lý trong PE | `procedure-engine.application.ts` (startInstance), `hrm-procedure-bridge.service.ts` (startHrmProcedure) |
| G2 | Tiến độ chỉ cập nhật khi PE kết thúc; `current_step_name`, `current_assignee_id`, `workflow_status` không bao giờ được ghi | `postgres-procedure-store.ts:271-282` (chỉ phát sự kiện completed), `hrm-procedure-sync.ts` |
| G3 | Màn Duyệt đơn không hiện các bước; không có nút duyệt theo PE ngay trong HRM | `approvals-screen.tsx`, `hrm-request.controller.ts:755-779` |
| G4 | Ba loại đơn (đổi ca, giải trình công, chỉnh sửa hồ sơ) hiển thị trường động nhưng không gửi `attributes` | `requests-screen.tsx` ~1428-1560 |
| G5 | Form động tải theo binding mặc định, không truyền mã loại con | `requests-screen.tsx:1193`, `getBindingDefinitionWithAttributes` |
| G6 | Liên kết trường form với điều kiện PE chỉ qua quy ước trùng mã, giá trị hệ thống ghi đè giá trị người dùng nhập; thiếu phòng ban, chức danh, loại nhân viên, phép còn lại; `condition_rules` bỏ không | `hrm-submission.ts:29-85` |
| G7 | Tenant mới không nộp được đơn (409) | `hrm-procedure-links.ts:191-192` |
| G8 | HRM không biết PE có khả dụng không; mã loại con nhập tay | `hrm-capabilities.controller.ts`, `operations-screen.tsx` |
| G9 | Duyệt DIRECT không giới hạn đơn vị, cho tự duyệt; lỗi trigger DB trả thô | ISS-BE-001 |
| G10 | HRM đọc thẳng bảng `procedure_schema.instances` của PE | `hrm-procedure-bridge.service.ts:181-187` |

---

## 4. Các task

Quy ước mã: FIX-E-xx. Mỗi task có tiêu chí nghiệm thu riêng. Thứ tự đề xuất ở mục 5.

### FIX-E-01. Bước S tự hoàn thành khi gửi đơn (G1)

Phía PE:
- Thêm tham số tùy chọn `autoCompleteInitiatorStep` cho API nội bộ tạo instance (chỉ chấp nhận khi `sourceType = 'hrm_request'` và gọi bằng service token).
- Khi bật, sau khi tạo instance và nạp giá trị thuộc tính, PE thực hiện hành động `complete` cho bước đầu với người khởi tạo là actor, trong cùng giao dịch. Dùng lại logic `applyAction`: `requireAttributesFilled`, `moveToNextStep` (cổng điều kiện dùng đúng giá trị form).
- Nhật ký hoạt động ghi "Hoàn thành bước S khi gửi đơn (tự động)".
- Điều kiện áp dụng: bước đầu của định nghĩa chỉ có vai S và người khởi tạo khớp phân công S. Nếu không, bỏ qua và để instance ở bước đầu (không lỗi), kèm cảnh báo trong kết quả.

Phía HRM:
- `startHrmProcedure` truyền cờ này cho mọi đơn.
- Khi lưu binding PROCEDURE, kiểm tra bước đầu của định nghĩa là bước S của người nộp; nếu không, hiện cảnh báo rõ cho quản trị ("Bước đầu không phải bước S, đơn sẽ dừng chờ người nộp").
- Phản hồi API tạo đơn trả thêm `currentStepName`, `currentAssigneeName` (nếu có).

Nghiệm thu:
- Gửi đơn nghỉ: instance PE xuất hiện, bước S ở trạng thái hoàn thành, bước hiện tại là bước duyệt đầu tiên, người dùng không phải mở PE.
- Cổng điều kiện sau bước S rẽ nhánh đúng theo số ngày nghỉ nhập trong form.
- Thiếu thuộc tính bắt buộc của bước S thì đơn không gửi được, báo rõ trường nào.
- Test PE: hoàn thành S tự động, không tự động khi bước đầu không phải S, idempotent khi gọi lại cùng khóa.

### FIX-E-02. Ghi tiến độ duyệt vào đơn (G2, G10)

- PE phát thêm sự kiện `procedure.instance.step_changed` (payload: instanceId, sourceType, sourceId, stepId, stepName, assignees, status) mỗi lần đổi bước, trong cùng giao dịch lưu trạng thái (outbox).
- Worker HRM đăng ký sự kiện này vào hàng `hrm.integrations.v1`. Khi nhận: ghi vào `inbox`, rồi cập nhật `current_step_name`, `current_assignee_id`, `workflow_status` của đơn; không đụng trạng thái nghiệp vụ (chỉ sự kiện `completed` làm việc đó như hiện nay).
- Bù khi mất sự kiện: `reconcile` đọc bước hiện tại của instance đang chạy và cập nhật lại.
- Thay việc đọc thẳng bảng PE bằng API nội bộ của PE trả tiến độ (có service token) để tôn trọng ranh giới module.
- Danh sách đơn có bộ lọc "Đang chờ ai duyệt" và "Bước hiện tại".

Nghiệm thu:
- Duyệt bước 1 trong PE, trong vòng 5 giây chi tiết đơn và lịch sử đơn hiện bước 2 và người xử lý mới, không cần mở lại hay làm mới.
- Mất sự kiện (tắt worker rồi bật lại): đối soát cập nhật đúng bước.
- Không có truy vấn trực tiếp `procedure_schema.*` từ module HRM (thêm test kiến trúc).

### FIX-E-03. Chi tiết đơn và màn Duyệt đơn hiển thị tiến độ (G3)

- Chi tiết đơn nhân viên: giữ khối bước hiện có, thêm làm mới tự động (poll nhẹ 15 giây khi đơn còn chạy hoặc dùng thông báo đẩy nếu có sẵn) và hiển thị trạng thái "Đang khởi tạo quy trình" / "Đồng bộ lỗi - đang thử lại".
- Màn Duyệt đơn: chi tiết đơn hiện danh sách bước, người xử lý, SLA. Với đơn PE, người duyệt có nút Duyệt / Từ chối / Trả lại gọi `POST requests/:kind/:id/actions`; PE vẫn là nơi kiểm quyền. Dùng Popconfirm cho Từ chối và Hủy.
- Cột "Quy trình" hiển thị mã instance, bước hiện tại, người đang chờ.

Nghiệm thu: người được giao bước duyệt xử lý được đơn ngay trong HRM; người không được giao nhận lỗi quyền từ PE và thấy thông báo thân thiện.

### FIX-E-04. Form tạo đơn đồng bộ với thuộc tính PE (G4, G5)

- API `procedure-definitions/binding` nhận thêm `subTypeCode` và áp dụng cùng quy tắc chọn binding như lúc gửi (ưu tiên binding mã loại con, rồi mặc định). Khi chỉ có binding mã loại con mà chưa chọn loại con, form hiển thị thông báo "Chọn loại đơn con để tải biểu mẫu" thay vì nuốt lỗi.
- Form tải lại thuộc tính động mỗi khi người dùng đổi loại phép, loại OT, loại công tác.
- Cả 7 loại đơn gửi `attributes`. Bổ sung cho đổi ca, giải trình công, chỉnh sửa hồ sơ.
- `DynamicAttributeForm` hỗ trợ đúng kiểu `file` (tải tệp qua MinIO) và `user` (SearchableSelect chọn nhân viên).
- Thay danh sách `excludeCodes` viết cứng bằng cấu hình ánh xạ (E-05).
- Lưu `attributes` vào bản nháp và khôi phục khi mở lại bản nháp.

Nghiệm thu: với mỗi loại đơn và mỗi loại con có binding riêng, form hiển thị đúng bộ thuộc tính của định nghĩa PE thật sự sẽ được dùng; dữ liệu đến đúng PE.

### FIX-E-05. Liên kết trường form với điều kiện PE (G6)

- Bảng mới `request_procedure_field_mappings` (tenant_id, binding_id, hrm_field, attribute_code, transform, mode). `mode` gồm `OVERWRITE` (giá trị hệ thống thắng) và `PREFILL` (chỉ gợi ý, người nộp được sửa).
- Danh mục trường HRM có thể ánh xạ, theo loại đơn:
  - trường form: từ ngày, đến ngày, số ngày/giờ/tiền, loại con, lý do;
  - ngữ cảnh nhân viên: phòng ban, chức danh, cấp bậc, loại hợp đồng, người quản lý;
  - ngữ cảnh nghiệp vụ: số phép còn lại, số giờ OT đã dùng trong tháng.
- Giao diện cấu hình ngay trong màn gắn quy trình: sau khi chọn định nghĩa PE, hiển thị danh sách thuộc tính của bước S và cấp quy trình, mỗi thuộc tính một ô chọn trường HRM. Cảnh báo thuộc tính bắt buộc chưa được ánh xạ hoặc không nhập được.
- Giữ tương thích: bảng mã cố định hiện có (`so_ngay_nghi`, `so_tien`...) được nạp làm ánh xạ mặc định khi tạo binding, không đổi hành vi các cấu hình cũ.
- PE: màn thiết kế điều kiện hiển thị nguồn của thuộc tính ("lấy từ đơn HRM: số ngày nghỉ") để người thiết kế quy trình biết thuộc tính nào do HRM cấp.
- Bỏ cột `condition_rules` không dùng (hoặc dùng làm chỗ lưu cấu hình trên nếu muốn tránh bảng mới).

Nghiệm thu: tạo quy trình có cổng "nếu số ngày nghỉ >= 3 thì qua Giám đốc", ánh xạ `so_ngay_nghi`; đơn nghỉ 2 ngày đi nhánh A, đơn nghỉ 5 ngày đi nhánh B. Tương tự với điều kiện theo phòng ban.

### FIX-E-06. Gắn PE thủ công đầy đủ và chọn chế độ theo tenant (G7, G8)

- Mã loại con: danh sách chọn lấy từ danh mục loại phép, loại OT, loại công tác (SearchableSelect), không nhập tay.
- Khi cấp module HRM cho tenant, tự tạo 7 binding DIRECT (migration cho tenant hiện có và bước provisioning cho tenant mới). Bỏ lỗi 409 "Chưa cấu hình chế độ duyệt" cho trường hợp chưa có cấu hình.
- Cờ `procedureAvailable` trong `GET /v1/capabilities` (dựa trên entitlement `procedure-engine` còn hiệu lực và PE API trả lời). Giao diện ẩn lựa chọn PROCEDURE khi false; API lưu binding từ chối PROCEDURE khi false.
- Khi PE đang tắt mà binding PROCEDURE còn đó: gửi đơn trả 409 mã `PROCEDURE_UNAVAILABLE`; màn cấu hình hiện banner cảnh báo kèm nút chuyển sang DIRECT có xác nhận.
- Hỗ trợ gắn lại thủ công cho đơn đang ở trạng thái `FAILED`/`CONFLICT` (nút "Gắn lại quy trình" có Popconfirm, ghi audit).

Nghiệm thu: tenant mới nộp được đơn ngay (DIRECT); tắt PE entitlement thì tùy chọn PE biến mất và cảnh báo hiện; bật lại thì khôi phục.

### FIX-E-07. Duyệt DIRECT đúng phạm vi và chặn tự duyệt (G9, ISS-BE-001)

- Tạo `hrm-approval-policy.ts` với `assertCanDecide(actor, request, kind)`, dùng chung cho 6 nhóm endpoint duyệt (nghỉ, OT, công tác, tạm ứng, giải trình công, chỉnh sửa hồ sơ, đổi ca).
- Quy tắc: chặn tự duyệt; chỉ duyệt trong phạm vi đơn vị của mình (manager chain từ Platform, hoặc đơn vị người đó làm trưởng); quyền `*.approve.all` hoặc quản trị tenant được duyệt toàn tenant.
- Lọc danh sách đơn chờ theo phạm vi ở tầng SQL.
- Đơn đang có quy trình PE đang chạy: trả 409 `PROCEDURE_IN_PROGRESS` thân thiện (thay vì lỗi trigger DB thô). Trigger DB vẫn giữ làm lớp bảo vệ cuối.
- Với đơn PE: kiểm tra PE có chặn người khởi tạo tự duyệt chính bước duyệt của mình không; nếu chưa, thêm quy tắc "người khởi tạo không được xử lý bước duyệt" trong PE (có thể tắt theo định nghĩa).

Nghiệm thu (đúng theo issue): unit test chính sách (tự duyệt 403, khác đơn vị 403, cùng đơn vị 200, quyền approve.all 200, đơn có quy trình đang chạy 409); chạy lại kịch bản RBAC của issue để RUN-RBAC-001/002 chuyển sang Đạt.

### FIX-E-08. Kiểm thử đầu cuối và dữ liệu mẫu

- Test tích hợp: gửi đơn PROCEDURE -> instance PE xuất hiện, bước S hoàn thành, bước hiện tại đúng; duyệt trong PE -> tiến độ cập nhật; kết thúc -> trừ phép đúng; PE lỗi -> đơn vẫn có, retry thành công; gửi trùng nhấp đúp -> một đơn một instance.
- Kịch bản UAT cho HR: 7 loại đơn x 2 chế độ (DIRECT, PROCEDURE).
- Cập nhật tài liệu hướng dẫn cho quản trị: cách gắn PE, ánh xạ trường, ý nghĩa các trạng thái.

---

## 5. Thứ tự và phụ thuộc

| Đợt | Task | Lý do |
|---|---|---|
| 1 | E-07 (duyệt DIRECT), E-06 (mặc định DIRECT, cờ PE) | Đóng rủi ro kiểm soát nội bộ và lỗi chặn tenant mới; độc lập với phần PE |
| 2 | E-01 (S tự hoàn thành), E-04 (form đồng bộ) | Thay đổi hành vi cốt lõi khi gửi đơn |
| 3 | E-02 (tiến độ vào đơn), E-03 (giao diện tiến độ và duyệt trong HRM) | Phụ thuộc sự kiện chuyển bước từ PE |
| 4 | E-05 (ánh xạ trường) | Lớn nhất, cần thiết kế giao diện cấu hình và danh mục trường |
| 5 | E-08 (kiểm thử đầu cuối, UAT) | Chốt sau cùng |

Migration dự kiến: bảng ánh xạ trường (E-05), seed binding DIRECT cho tenant hiện có (E-06), cột bổ sung nếu cần cho trạng thái hiển thị (E-02). Chưa ghi số thứ tự migration; xác định khi triển khai để không trùng 0021-0026 đã dùng.

---

## 6. Rủi ro và điểm cần lưu ý

1. Cờ tự hoàn thành S nằm ở PE: ảnh hưởng module PE dùng chung. Chỉ bật cho `sourceType = 'hrm_request'` và kèm test hồi quy trên các luồng khác.
2. Đơn đã chạy trước khi triển khai E-01 vẫn đứng ở bước S. Cần script tùy chọn hoàn thành bước S cho các instance HRM đang chờ ở bước đầu (chạy một lần, có sao lưu, do quản trị quyết định).
3. Sự kiện chuyển bước làm tăng lưu lượng RabbitMQ; cần idempotency theo (instanceId, stepId, sequence) và bỏ qua sự kiện cũ hơn trạng thái đã ghi.
4. Chế độ "tạo đồng thời" chỉ bảo đảm ở mức at-least-once. Nếu cần bảo đảm tuyệt đối "PE lỗi thì không tạo đơn", phải chuyển sang gọi PE đồng bộ trong giao dịch HRM, đánh đổi bằng việc người dùng mất đơn khi PE sập. Kế hoạch này chọn giữ đơn.
5. Đổi thứ tự chọn binding theo mã loại con có thể làm đơn đang là nháp tải form khác. Khi mở bản nháp phải tải lại biểu mẫu theo binding hiện hành và báo nếu thuộc tính thay đổi.
6. Chưa có thông tin về cách PE hiện chặn người khởi tạo tự duyệt; cần đọc thêm mã PE khi thực hiện E-07.

---

## 7. Trạng thái triển khai

| Task | Trạng thái | Ghi chú |
|---|---|---|
| FIX-E-01 | Một phần | Code + test đơn vị xong (PE tự hoàn thành S, HRM truyền cờ/cảnh báo); chưa build/restart, chưa chạy tích hợp; xem HRM_FIX_05_PROGRESS.md |
| FIX-E-02 | Một phần | Code + test đơn vị xong (step_changed qua outbox, API nội bộ PE, HRM bỏ đọc procedure_schema, worker ghi tiến độ vào đơn); migration 0029 chưa chạy, chưa build/restart; xem Báo cáo FIX-E-02 trong HRM_FIX_05_PROGRESS.md |
| FIX-E-03 | Một phần | Code + test xong (panel tiến độ dùng chung, poll 15 giây, nút Duyệt/Từ chối/Trả lại qua PE); chưa chạy thử giao diện thực tế; xem HRM_FIX_05_PROGRESS.md |
| FIX-E-04 | Một phần | |
| FIX-E-05 | Một phần | Phía HRM xong code + test đơn vị (bảng ánh xạ + API + UI cấu hình + form động theo ánh xạ + vá tồn đọng đợt 3: revision/instance id ở 7 danh sách, canAct, bộ lọc assignee/currentStep); migration 0030 chưa chạy; xem Báo cáo FIX-E-05 (HRM) trong HRM_FIX_05_PROGRESS.md |
| FIX-E-06 | Một phần | |
| FIX-E-07 | Một phần | Code, test đơn vị, migration 0028 (chưa chạy) xong; xem HRM_FIX_05_PROGRESS.md |
| FIX-E-08 | Một phần | Đã sửa các integration spec lỗi thời (chưa chạy được vì không có DB), thêm test mô phỏng đầu cuối 6 luồng, viết HRM_FIX_05_UAT.md và HRM_FIX_05_ADMIN_GUIDE.md; còn chạy integration spec trên DB thật và UAT thực tế; xem Báo cáo FIX-E-08 trong HRM_FIX_05_PROGRESS.md |
