# Task Tracking — Enterprise Platform

**Kế hoạch hiện hành:** [5 tính năng theo `doc/requirements_doc.md`](../../../.claude/plans/t-i-c-k-ho-ch-ancient-sunrise.md)

> **Quy ước trạng thái**
> ✅ = đã viết **và** đã chạy build/verify thành công
> 🟨 = code có nhưng chưa verify, hoặc mới xong một phần
> ⏳ = chưa làm
> ❌ = phát hiện hỏng, đang sửa

---

# 🔥 ĐANG LÀM — 5 tính năng theo `doc/requirements_doc.md`

Chia 2 đợt theo module. Quyết định đã chốt: SLA chỉ badge đỏ (không thông báo) · sự cố có gán kỹ thuật viên và tự hoàn thành khi workorder xong · trong ba tuỳ chọn phụ chỉ làm @mention.

## 🚑 Chặn trước — lỗi mất dữ liệu phát hiện khi lập kế hoạch

| Task | Status | Notes |
|------|--------|-------|
| `attachments.instance_id` là `ON DELETE CASCADE` → **mọi lần ghi hồ sơ xoá sạch đính kèm** | ✅ | `synchronizeNormalized` chạy `DELETE FROM instances` mỗi lần ghi. Xác minh trên DB thật: 2 file upload lượt trước **đã mất**, object vẫn mồ côi trong MinIO. Sửa bằng `0006-attachment-survives-writes.sql` (bỏ CASCADE, `DEFERRABLE INITIALLY DEFERRED`) |
| Kiểm chứng đính kèm sống sót qua lần ghi | ✅ | Upload → ghi hồ sơ → còn nguyên 1 file. Đây đúng là phép thử tôi đã bỏ sót ở lượt trước |
| `0005` bị nối thêm sau khi đã áp dụng → checksum mismatch | ✅ | Migration đã chạy thì phải bất biến. Đã khôi phục `0005` về nội dung gốc (checksum khớp `b393bce5…`) và dồn bản vá FK sang `0006` |

## Đợt 1 — Module Quy trình

**Đợt 1 xong — backend và giao diện, verify bằng tài khoản thật SAVINA (19/08).**
Còn nợ đúng một mục: lọc/sắp xếp danh sách theo SLA (AC-SLA-06) — chờ chốt mâu thuẫn #1 bên dưới.

| Kiểm chứng | Kết quả |
|---|---|
| SLA lưu vào bản nháp, còn nguyên sau khi ghi lại | ✅ |
| SLA `0` / `2.5` | ✅ bị chặn |
| Khởi tạo hồ sơ → B1 nhận hạn +1h, B2 chưa có hạn | ✅ |
| Chuyển bước → B2 nhận hạn +4h, B1 đóng băng | ✅ |
| Trả về bước trước → bước đích nhận **khung SLA mới**; bước bị trả về giữ hạn cũ ở trạng thái đóng băng | ✅ |
| Người có mặt trong hồ sơ nhưng **không giữ vai trò bước hiện tại** gửi được trao đổi | ✅ (trước đây không thể) |
| Người ngoài hồ sơ gửi trao đổi / xem tệp | ✅ 403 cả hai |
| Quản trị xem tệp mọi hồ sơ | ✅ |
| Nội dung rỗng · gửi lặp cùng idempotencyKey | ✅ chặn · chỉ ghi 1 lần |
| Upload `.exe` · đuôi và content-type không khớp | ✅ chặn cả hai |
| **SLA sống sót khi bấm một ô RACI** (phễu `toStepInput`) | ✅ B1=6h, B2=12h giữ nguyên |
| Đổi SLA một bước · xoá SLA (để trống) | ✅ đúng cả hai |


### 1.1 SLA cho task
| Task | Status | Notes |
|------|--------|-------|
| Contract: `slaHours` (step definition + input), `slaDueAt` (instance step) | ✅ | Phải là trường contract — cột chuẩn hoá sẽ bị `synchronizeNormalized` xoá |
| Helper `evaluateStepSla` dùng chung API + UI | ✅ | Ngưỡng 🟢>4h · 🟡≤4h · 🔴 quá hạn · `—` không SLA |
| Tính deadline ở 3 điểm gán `startedAt` | ✅ | `startInstance:389`, `advance():921`, `returnToPreviousStep():968-979` |
| `createDefinition` + `updateDefinition` mang theo `slaHours` | ✅ | **Cả hai**, thiếu một là mất dữ liệu |
| `toStepInput()` trong `rcsi-board.tsx` | ✅ | Phễu duy nhất của mọi thao tác sửa — quên là mất SLA mỗi lần bấm ô RACI |
| Validate `slaHours` trong definition policy | ✅ | Giờ nguyên 1–8760. Verify: `0` và `2.5` đều bị chặn |
| UI: ô nhập SLA, badge trên thẻ đơn + thẻ bước | ✅ | Badge dùng chung helper `evaluateStepSla`. **Lọc/sắp xếp theo SLA (AC-SLA-06) chưa làm** — xem mâu thuẫn #1 |

### 1.2 File đính kèm theo giai đoạn
| Task | Status | Notes |
|------|--------|-------|
| Migration `0006` (chặn trước) | ✅ | Xem mục 🚑 |
| Danh sách trắng content-type | ✅ | jpg/png/pdf/docx/xlsx/txt. `sizeBytes` do client gửi và **không kiểm chứng được** — ghi rõ giới hạn trong code |
| `create()` kiểm quyền actor + server tự đóng dấu `stepInstanceId` | ✅ | Hiện **không kiểm gì cả**, và tin `stepInstanceId` client gửi |
| `list()` kiểm quyền | ✅ | **Hiện bất kỳ user nào trong tenant cũng liệt kê được file của mọi hồ sơ** — rò rỉ thật. Luật đúng (chốt 19/08): file thuộc về từng workorder, **chỉ người có mặt trong workorder đó mới xem được**; admin xem được toàn bộ workorder nên đương nhiên xem được file. Dùng chung vị từ `isProcedureParticipant` với `getWorkspace` — ai thấy hồ sơ thì thấy file của hồ sơ đó, không hơn |
| Tab `📎 Tệp đính kèm` + lọc theo giai đoạn | ✅ | Chưa có primitive tab nào trong feature package |
| Bỏ giới hạn chỉ tải đính kèm cho hồ sơ `running` | ✅ | Trái AC-ATT-05 (xem được sau khi hồ sơ đóng) |

### 1.3 Chat trên workorder
| Task | Status | Notes |
|------|--------|-------|
| Tách vị từ `isProcedureParticipant` dùng chung | ✅ | `getWorkspace` đang inline; đọc và ghi phải cùng một luật |
| Endpoint riêng `POST /instances/:id/comments` | ✅ | **Không nới `availableActions`** — nó điều khiển hàng nút hành động, nới ra làm loãng nghĩa RACI |
| `canComment` / `canReadFeed` trong authorization | ✅ | Hôm nay vai trò `I` và người nhận đầu việc E(x) **không bình luận được** |
| Bỏ phép sắp lại feed thành cũ-nhất-trước | ✅ | AC-CHT-06 yêu cầu mới nhất lên trên; server đã `unshift` |
| Tab `💬 Trao đổi` + ô nhập + Ctrl+Enter | ✅ | Kèm icon/màu theo loại hành động, ngăn cách theo ngày, “Xem thêm” 20 mục/lần |
| @mention (chỉ tô đậm, không thông báo) | ✅ | Người dùng đã chọn bỏ thông báo → mention chỉ có giá trị đọc lại |

## Đợt 2 — Module Bảo trì

Bắt đầu 19/08. Khác Đợt 1 (phần lớn nối dây trên hạ tầng có sẵn), đợt này **phải đổi schema** vì `occurrences` đang gắn cứng vào `schedules`.

### 2.0 Nền — schema và sửa lỗi có sẵn
| Task | Status | Notes |
|------|--------|-------|
| Tái hiện lỗi `assetCode` luôn rỗng | ✅ | Đo trước khi sửa: cả 4 phiếu đều trả `assetCode: ""`. Nguyên nhân: `read()` không select `s.asset_code` nhưng `mapOccurrence` lại đọc `row.asset_code` |
| Migration `0003-incident-and-history.sql` | ✅ | `schedule_id` nullable; thêm `kind/code/title/asset_code/description/procedure_definition_id/assignee_*/completion_note/completed_by*/created_by*`; CHECK `kind`, CHECK hình dạng theo `kind`; thêm status `in_progress`; 3 index. Đã áp cho minhlong + savina |
| Không đụng `UNIQUE (schedule_id, due_at)` | ✅ | Postgres coi NULL là khác nhau trong unique btree nên nhiều sự cố cùng thời điểm vẫn chèn được — không cần sửa |
| Status `in_progress` riêng, không mượn `planned` | ✅ | KPI "Sắp đến hạn" đếm theo `planned`; sự cố đang xử lý mà dùng chung sẽ thổi phồng con số đó |
| Sửa `read()`: thêm `asset_code`, `INNER JOIN` → `LEFT JOIN` | ✅ | **Kiểm chứng canary**: trước sửa cả 4 phiếu `assetCode: ""`, sau sửa ra đúng `MBA-T1` / `RELAY-901`. Dùng `COALESCE(o.asset_code, s.asset_code)` để định kỳ lấy từ lịch, sự cố dùng của chính nó |
| Sửa `reconcileStuckDispatches` cũng `LEFT JOIN` | ✅ | Kèm `COALESCE(o.procedure_definition_id, s.procedure_definition_id)` — sự cố giữ quy trình xử lý trên chính nó |

### 2.1 Contracts
| Task | Status | Notes |
|------|--------|-------|
| `MaintenanceOccurrenceKind`, mở rộng `MaintenanceOccurrence` | ✅ | `scheduleId`/`scheduleTitle` thành optional vì sự cố không có lịch cha |
| `MaintenanceHistoryFilter` / `MaintenanceHistoryPage` | ✅ | Phân trang keyset `<dueAt>\|<id>` thay OFFSET — ổn định khi dữ liệu đang đổi |
| `CreateMaintenanceIncidentRequest`, `CompleteMaintenanceOccurrenceRequest` | ✅ | |
| `ProcedureInstanceCompletedEventPayload` | ✅ | |
| `metrics.openIncidents` | ✅ | Đếm `kind='incident' AND status<>'completed'`; đã trả về API |

### 2.2 Store + Application + Controller
| Task | Status | Notes |
|------|--------|-------|
| `readHistory` có lọc + phân trang | ✅ | **Không** dùng lại `read()`: hàm đó không giới hạn và đang bị 5 endpoint dùng chung |
| `findOccurrence`, `completeOccurrence` | ✅ | Đóng rồi không mở lại được (AC-HST-06) |
| `createIncident` | ✅ | Tái dùng nguyên vẹn `dispatchToProcedure`; khoá `incident:<uuid>` |
| Validate mã thiết bị qua `AssetDirectory` | ✅ | Kho hỏng thì bỏ qua kiểm, theo đúng cách `getMatrix` đang xuống thang |
| 4 endpoint: history / chi tiết / incident / complete | ✅ | |

**Kiểm chứng 2.2 (19/08, tài khoản admin@savina.local):**

| Kịch bản | Kết quả |
|---|---|
| Mã thiết bị không có thật | ✅ chặn — "Không tìm thấy thiết bị KHONG-CO-THAT trong Kho" |
| Thiếu tiêu đề | ✅ chặn |
| Sự cố **không** kèm quy trình | ✅ `INC-2026-F4BD`, `in_progress`, không có `schedule_id` |
| Sự cố **có** kèm quy trình | ✅ `INC-2026-B2BF` → tự mở workorder `PR-20260819-C2483C` |
| Lịch sử gộp cả định kỳ và sự cố | ✅ 6 phiếu |
| Lọc `kind=incident` · `assetCode~MBA` | ✅ 2 sự cố · 4 phiếu |
| Phân trang keyset `limit=2` | ✅ trả `nextCursor` |
| Đóng phiếu kèm ghi chú | ✅ `completed`, ghi chú lưu đúng |
| Đóng lần hai | ✅ chặn — "Phiếu này đã được đánh dấu hoàn thành" |
| `metrics.openIncidents` | ✅ = 1 |

### 2.3 Tự hoàn thành sự cố
| Task | Status | Notes |
|------|--------|-------|
| Phát `procedure.instance.completed` từ `appendEvents` | ✅ | Procedure hiện **chỉ phát đúng 1 loại event** (`definition.published`) — đã kiểm trên outbox SAVINA |
| Worker: binding + handler | ✅ | `rejected`/`cancelled` phải ghi `failed`, **không** được ghi `completed` — bảo trì không hề được thực hiện |
| Dọn binding `maintenance.procedure-start.requested` | ✅ | Không nơi nào phát; hoặc bỏ, hoặc ghi chú rõ là nhánh dự phòng |

**Kiểm chứng 2.3 (19/08):**

| Kịch bản | Kết quả |
|---|---|
| Sự cố `INC-2026-B2BF` có workorder `PR-20260819-C2483C` | trạng thái `generated` |
| Chạy workorder tới `completed` → chờ worker | ✅ **sự cố tự đóng**, ghi chú "Tự động hoàn thành khi workorder kết thúc." |
| `rejected`/`cancelled` ghi `failed` chứ không `completed` | ✅ theo nhánh riêng trong handler — bảo trì không hề diễn ra thì không được tính là xong |

### 2.4 Giao diện
| Task | Status | Notes |
|------|--------|-------|
| Tab Lịch sử + bộ lọc | ✅ | Fetch riêng, không gộp vào `reload()` để lọc không kéo theo refetch cả workspace |
| Panel chi tiết + đánh dấu hoàn thành | ✅ | Gom theo ngày, keyset "Xem thêm", link mở workorder |
| Form Tạo sự cố, hiện ở mọi tab | ✅ | AC-INC-01 |
| Badge phân biệt sự cố / định kỳ + KPI sự cố đang mở | ✅ | AC-INC-05, AC-INC-06 |

### 2.5 Dọn giao diện
| Task | Status | Notes |
|------|--------|-------|
| Bỏ emoji dùng làm icon trên toàn source | ✅ | 8 chỗ: nhãn tab, tiêu đề panel, icon dòng trao đổi, chip liên kết, icon thiết bị, log khởi động 4 service. Emoji hiển thị khác nhau tuỳ hệ điều hành, không theo bảng màu sáng/tối, và không thêm nghĩa gì so với chữ bên cạnh. Dòng trao đổi chuyển sang **chấm màu** theo loại hành động. Giữ `✓ ✕ ▾ ▸ ← →` vì là ký tự typography của giao diện, không phải emoji |

## 🐞 Lỗi tự gây, đã sửa

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| **Gõ `@` không hiện gợi ý tên** (19/08) | Tôi mới làm phần tô đậm khi hiển thị, chưa làm bộ chọn lúc gõ | Thêm danh sách gợi ý nổi trên ô nhập, khớp theo tiền tố sau `@`. Không dừng ở khoảng trắng đầu tiên vì tên tiếng Việt có dấu cách; chỉ nhận `@` đứng đầu dòng hoặc sau khoảng trắng để không bắt nhầm email. Dùng `onMouseDown` chứ không `onClick` — click xảy ra sau blur, lúc đó danh sách đã đóng |
| **Thiếu bộ lọc "Đã huỷ"** (19/08) | `Filter` liệt kê tay 4 giá trị, sót `cancelled` → 2 đơn đã huỷ không lọc tới được, tổng các tab không khớp "Tất cả" | Suy ra danh sách tab **từ `STATUS_LABEL`** thay vì liệt kê tay. Kiểm chứng: 12 = 8 running + 1 completed + 1 rejected + 2 cancelled |
| **Không liên kết được quy trình A → B** (19/08) | `linkedDefinitionId` có đủ trong contract, application và DB nhưng **không dòng code nào dùng lúc chạy**, và không có giao diện nào đặt nó | Nối vào `advance()`: bước xong thì mở hồ sơ cho quy trình nối tiếp, `sourceType='auto_from_parent'`, `sourceId` trỏ hồ sơ cha, khoá idempotency theo `linked:<parent>:<step>`. Quy trình đích còn nháp hoặc đã gỡ thì **ghi chú vào nhật ký thay vì làm vỡ bước** — hồ sơ cha không nên chết vì một liên kết cấu hình sai. Thêm ô chọn trên dòng bước trong ma trận |
| **Không thêm/xoá được vai trò trên ma trận** (19/08) | Luật "E chỉ gán cấp đơn vị" đặt nhầm vào `validateDefinitionDraft`. `writeCell` PATCH **cả bản nháp** mỗi lần bấm một ô, nên một ô E cũ (`E→user` trong `QT-BT-MBA`) làm hỏng mọi thao tác trên mọi ô khác — kể cả thao tác sửa chính ô đó. Deadlock | Chuyển sang `validateDefinitionForPublish`, đúng chỗ của các luật ngữ nghĩa RACI khác (E-cần-C, thứ tự rollback). Thêm chặn ngay ở popover: nút E bị vô hiệu trên cột không phải đơn vị, kèm tooltip giải thích |

**Bài học:** thêm luật chặt hơn phải cân nhắc dữ liệu đã có vi phạm nó. Với màn hình lưu cả bản nháp mỗi lần sửa một ô, luật draft-time biến một dòng dữ liệu cũ thành cái khoá toàn bộ màn hình.

## 🔧 Sửa theo phản hồi khi test LAN (19/08)

| Vấn đề | Nguyên nhân | Sửa |
|---|---|---|
| Đăng nhập được qua localhost nhưng **không được qua IP LAN** | 4 web app chạy chế độ dev; Next 16 chặn request dev từ origin khác localhost nên trang không hydrate, form rơi về submit GET thuần (dấu `?` cuối URL). Backend hoàn toàn bình thường — curl qua LAN trả 200 đủ cookie | Chuyển sang **production build** cho bản team test; thêm `allowedDevOrigins` để chạy dev qua LAN cũng được. Tắt `module_old` đang chiếm cổng 3000/3001 |
| `crypto.randomUUID is not a function` khi tạo đơn | `crypto.randomUUID` **chỉ có trong secure context** (HTTPS hoặc localhost). Qua IP LAN bằng HTTP thuần thì undefined → mọi thao tác ghi vỡ ngay ở trình duyệt | `newIdempotencyKey()` dùng `crypto.getRandomValues` dựng UUID v4 khi thiếu. Kiểm 20000 khoá: 0 sai định dạng, 0 trùng. Đã quét: không dùng API secure-context nào khác |
| Vai trò A trả lại chỉ về được bước liền trước | `returnToPreviousStep` chỉ đọc `fixedRollbackStepId` của C, còn lại luôn `currentIndex - 1` | Thêm `returnToStepId` cho hành động `return`. **A chọn được bước** (họ là người duyệt cuối, nhìn thấy toàn hồ sơ); **C vẫn cố định** theo cấu hình lúc thiết kế — đó là ý nghĩa của C(x). Chọn bước sau bước hiện tại bị chặn |

**Bài học kiểm thử:** kiểm bằng curl không chạy JavaScript nên cả hai lỗi đầu đều không lộ ra dù mọi endpoint đều trả 200. Với lỗi chỉ xảy ra trong trình duyệt, phải kiểm nội dung HTML và bundle, không chỉ mã trạng thái HTTP.

## 🏷️ Nhóm quy trình + bộ lọc workorder (19/08)

Yêu cầu: ma trận lọc theo 6 nhóm quy trình; workorder ngoài 6 nhóm còn lọc theo ngày và thuộc tính khác.

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| 6 nhóm trong contract | ✅ | `PROCEDURE_CATEGORIES` + `PROCEDURE_CATEGORY_LABEL` + `PROCEDURE_CATEGORY_HINT` (đơn vị chủ trì + ví dụ) dùng chung API/UI, không khai báo hai nơi |
| `category` trên quy trình | ✅ | Trường trên contract nên nằm trong `versions.snapshot`, sống sót qua `synchronizeNormalized` |
| `definitionCategory` trên hồ sơ | ✅ | **Bắt buộc chép lúc khởi tạo**: người không phải designer nhận `definitions: []`, workspace sẽ không tra ngược được nhóm |
| Gán nhóm cho quy trình **đã công bố** | ✅ | Endpoint riêng `PATCH /definitions/:id/category`. Không đi qua `updateDefinition` (chỉ cho bản nháp) |
| Lọc theo nhóm trên ma trận | ✅ | Ô chọn nhóm ở đầu bảng + ô chọn từng dòng, chỉ hiện với người có quyền `design` |
| Lọc workorder | ✅ | Nhóm quy trình · tình trạng SLA · nguồn tạo · khoảng ngày (từ/đến) + nút xoá lọc. **Hoàn tất AC-SLA-06 còn nợ từ Đợt 1** |

**Vì sao tách endpoint riêng:** ban đầu tôi để `category` đi chung `updateDefinition`, kết quả cả 3 quy trình đang chạy của SAVINA đều báo *"Chỉ bản nháp mới sửa được"*. Nhóm chỉ là nhãn để lọc, không đổi ngữ nghĩa thực thi — bắt "mở lại bản nháp → công bố lại" chỉ để gắn nhãn là đưa quy trình ra khỏi vận hành vô cớ. Ngoại lệ này được ghi chú ngay tại `setDefinitionCategory`.

Kiểm chứng bằng tài khoản SAVINA thật: gán nhóm cho 3 quy trình `published` → OK; nhóm không hợp lệ → bị chặn; bỏ trống → gỡ nhãn; hồ sơ mới tạo mang đúng `definitionCategory`.

## ⚠️ Mâu thuẫn giữa tài liệu và kiến trúc — cần PO xác nhận

| # | Vấn đề |
|---|---|
| 1 | **SLA Flow B giả định có danh sách toàn bộ workorder.** `getWorkspace` chỉ trả hồ sơ mà người dùng có tham gia — người giám sát không giữ vai trò RACI nào sẽ không thấy gì. Bộ lọc SLA đã làm xong (19/08) nhưng chỉ lọc trong phạm vi hồ sơ người đó thấy; muốn giám sát toàn tenant cần endpoint riêng |
| 2 | **AC-HST-05 / AC-INC-01 chưa khả thi với mô hình quyền hiện tại.** Guard map **mọi** request non-GET vào `maintenance.manage`, nên "Kỹ thuật viên" không đánh dấu hoàn thành hay tạo sự cố được nếu không có quyền quản lý lịch. Hằng số `maintenance.occurrence.manage` đã có trong contract nhưng chưa dùng |
| 3 | Tài liệu §4.3 cho phép admin xoá file đính kèm — đã chốt **không làm**, nên UI sẽ không có nút xoá |
| 4 | AC-CHT-02 nới quyền bình luận rộng hơn RACI hiện tại: vai trò `I` và người nhận đầu việc E(x) sẽ bình luận được |

---

<details>
<summary>📦 ĐÃ XONG — Triển khai 3 Module Inventory/Maintenance/Procedure (commit <code>7a722fe</code>)</summary>


## 📋 Pha 0: Contract Packages

| Task | Status | Notes |
|------|--------|-------|
| Create `contracts-inventory` | ✅ | Rewrite theo AMM: Asset, Material, Warehouse, MaterialInventory, InventoryTransaction, Reservation |
| Update `contracts-procedure-engine` | ✅ | Thêm CreateProcedureInstanceRequest cho cross-module |
| Update `contracts-maintenance` | ✅ | Bỏ Asset/JobPlan, `assetId`→`assetCode`, thêm `priority`, `assetName` thành optional |

---

## 🚀 Pha 1: Track 1 — Inventory Module

| Task | Status | Notes |
|------|--------|-------|
| `migrations/tenant/inventory/0001-inventory.sql` | ✅ | 13 bảng AMM, ledger-only |
| Đăng ký migration trong migrator + TenantProvisioning | ✅ | |
| `packages/contracts/inventory` | ✅ | Build pass |
| `packages/modules/inventory` | ✅ | **Đã rewrite** theo contract AMM, build pass |
| — store port | ✅ | Bỏ StockReceipt/Issue/Transfer; dùng ledger `transaction.append` + `reservation` |
| — postgres store | ✅ | Query đúng bảng AMM, có mapper snake_case→camelCase, pessimistic lock khi reserve |
| — application | ✅ | receive/issue/transfer qua ledger; transfer sinh 2 dòng OUT+IN |
| — controller | ✅ | REST + endpoint nội bộ task-template |
| `apps/inventory-api` | ✅ | **Đã chạy thật trên cổng 3336**, mọi endpoint verify OK. Scaffold cũ viết sai convention (project.json + esbuild) → làm lại theo mẫu procedure-api (package.json + webpack) |
| `0002-inventory-balance-unique.sql` | ✅ | Sửa bug UNIQUE với `location_id` NULL (xem dưới) |
| `packages/features/inventory` (UI) | ⏳ | |
| `apps/inventory-web` | ⏳ | |
| `architecture-boundary.spec.ts` | ⏳ | |

### Đã verify chạy thật (2026-08-18)
| Kiểm thử | Kết quả |
|---|---|
| GET warehouses / materials / assets | ✅ trả camelCase đúng |
| GET internal task-template | ✅ trả `task_template` của asset |
| Nhập kho 50 → xuất 20 → nhập 10 → xuất 15 | ✅ tồn 25, đúng từng bước |
| Giữ vật tư 10 | ✅ tồn 25, giữ 10, khả dụng 15 |
| Giữ vượt tồn khả dụng | ✅ chặn 400, báo đúng số khả dụng |
| Chuyển kho 5 (WH-01→WH-02) | ✅ sinh 2 dòng ledger OUT+IN, số dư 2 kho đúng |
| Chuyển về chính nó | ✅ chặn 400 |

### Bug nghiêm trọng đã sửa: UNIQUE với cột NULL
`material_inventory` có `UNIQUE(warehouse_id, location_id, material_id)`, nhưng trong UNIQUE index của Postgres **NULL được coi là khác nhau**. Tồn ở cấp kho có `location_id = NULL` → `ON CONFLICT` **không bao giờ khớp** → mỗi giao dịch chèn một dòng số dư mới thay vì cộng dồn.

Triệu chứng thực tế đã bắt được: xuất 20 nhưng tồn vẫn báo 50, DB có 2 dòng (50 và −20). Số tồn bị chia nhỏ, `LIMIT 1` trả về dòng bất kỳ → **báo cáo tồn kho sai âm thầm**. Loại bug này sẽ làm hỏng số liệu kho ở production và rất khó truy.

Sửa: migration `0002` gộp các dòng đã bị tách rồi đổi sang `UNIQUE NULLS NOT DISTINCT` (Postgres 15+).

### Xác thực & multi-tenant (đã xong, verify 2026-08-18)
| Kịch bản | Kết quả |
|---|---|
| GET không xác thực | ✅ 401 (trước đó trả thẳng dữ liệu) |
| POST không xác thực | ✅ 403 CSRF_INVALID |
| Route internal + service token | ✅ 200, tenant DB phân giải động qua platform |
| Route internal thiếu token | ✅ 401 SERVICE_IDENTITY_INVALID |
| Route internal thiếu X-Tenant-ID | ✅ 403 MISSING_TENANT |

- `InventoryAccessGuard` theo đúng mẫu maintenance/procedure: JWKS + access-decision + CSRF, route `/v1/internal/` đi nhánh service token (fail-closed).
- Store chuyển sang `TenantDatabaseRegistry`/`PostgresPoolRegistry`, mỗi method nhận `tenantId` — bỏ hẳn `connectionString` cố định.
- Application nhận `InventoryActor`; thao tác ghi yêu cầu `canManage`. Actor nội bộ đặt `canManage: false` (chỉ đọc task template).
- Đăng ký module `inventory` vào registry + entitlement 3 tenant, thêm quyền `inventory.read`/`inventory.manage`. **Thiếu bước này thì guard từ chối 100% request** (`MODULE_NOT_ENTITLED`).

### Hạn chế còn lại của Inventory
- **Task template vật tư chưa hỗ trợ.** Schema AMM không có `material_compatibilities`, `materials` cũng không có cột jsonb → chỉ resolve được ở cấp **asset** (`assets.task_template`). Muốn hỗ trợ cấp vật tư phải thêm migration.
- **Chưa có test tự động.**
- **Chưa có `inventory-web`** và `packages/features/inventory`.

---

## 🔧 Pha 1: Track 2 — Maintenance Module

| Task | Status | Notes |
|------|--------|-------|
| `migrations/tenant/maintenance/0002-inventory-integration.sql` | ✅ | Drop assets/job_plans, `assetId`→`assetCode`, thêm priority, idempotent |
| Bỏ CRUD asset/jobPlan khỏi application + controller | ✅ | |
| `generateDueOccurrences` gọi HTTP sang Procedure | ✅ | **Đã chạy thật, verify end-to-end** |
| Tách 2 pha: transaction rồi mới HTTP | ✅ | Bản cũ gọi HTTP trong transaction → khi fail thì transaction abort, câu UPDATE "mark failed" cũng fail theo. Nay commit occurrence trước, dispatch sau |
| Route internal cho scheduler | ✅ | `POST /v1/internal/scheduler/run`, xác thực bằng service token |
| Cập nhật seed data | ✅ | |

---

## 📚 Pha 1: Track 3 — Procedure Module

> **Ngữ nghĩa vai trò:** S = Submit (trình), R = Review (xem xét), E = Executor (thực hiện),
> C = Check (kiểm tra), A = Approve (phê duyệt), I = Inform (thông báo).
> Khớp `PROCEDURE_STAGE_ORDER = [S, R, E, C, A]`.

### Mô hình quyền (đã sửa 2026-08-18)

Trước đây guard yêu cầu `procedure.manage` cho **mọi** thao tác ghi, mà `isOverride = có procedure.manage`. Nên ai thao tác được cũng là override → **RACI không ràng buộc ai cả**. Kiểm chứng: user `myRoles: []` vẫn complete được bước.

Nay tách 4 quyền:

| Quyền | Cho phép |
|---|---|
| `procedure.read` | Xem workspace — **chỉ** work order mình tham gia |
| `procedure.act` | Thao tác **theo đúng vai trò được giao** |
| `procedure.design` | Xem và sửa ma trận quy trình — chỉ tenant admin |
| `procedure.manage` | Override, làm mọi bước bất kể vai trò |

**Ba role tenant:**

| Role | Quyền | Dùng cho |
|---|---|---|
| `tenant-admin` | tất cả (11) | Mặc định là quản lý quy trình luôn |
| `procedure-manager` | 4 quyền procedure | Giám đốc điều hành ma trận RACI — cấp được cho nhiều người mà **không** kèm quyền quản trị tenant/CRM/Inventory |
| `procedure-participant` | `read` + `act` | Người tham gia hồ sơ theo vai trò được giao |

Kiểm chứng `procedure-manager`: chỉ có đúng 4 quyền `procedure.*`, **không có quyền nào khác**; thấy đủ ma trận (7 quy trình) và mọi work order, `canOverrideActions: true`.

**Kiểm chứng bằng 2 tài khoản thật:**

| Kịch bản | Kết quả |
|---|---|
| Nhân viên xem ma trận quy trình | ✅ `definitions: 0` — không thấy gì |
| Nhân viên chưa được giao vai trò | ✅ `work orders: 0` |
| Nhân viên là R bước 2, hồ sơ đang ở bước 1 | ✅ **thấy** hồ sơ, nhưng `myRoles: []`, `actions: []` |
| Nhân viên thao tác khi chưa tới lượt | ✅ **bị chặn** — "Vai trò RCSI hiện tại không cho phép…" |
| Admin (S) hoàn thành bước 1 → sang bước 2 (R) | ✅ nhân viên có `myRoles: ['R']`, `actions: [comment, complete]` |
| Nhân viên hoàn thành bước 2 | ✅ instance completed |

Lưu ý: nhân viên chỉ nhận đúng hành động của vai trò R — **không** có `cancel`/`reject`/`return` vì đó là đặc quyền override.

### Uỷ quyền (verify 2026-08-18)
| Kịch bản | Kết quả |
|---|---|
| Admin uỷ vai trò R cho nhân viên | ✅ ghi DB: `roles={R}`, lý do, `step_instance_id` |
| Nhân viên (chỉ read+act) nhận uỷ quyền | ✅ `myRoles:['R']`, `isDelegated:true`, `isOverride:false` |
| Hành động khả dụng | ✅ đúng bộ vai trò R (`comment`,`complete`) — **không** phải bộ override |
| Thực thi bằng quyền được uỷ | ✅ instance completed |
| Uỷ cho chính mình | ✅ chặn |
| Uỷ vai trò mình không giữ | ✅ chặn |

> Lỗi bắt được khi test: bộ lọc `getWorkspace` ban đầu quên delegation nên người được uỷ **không thấy hồ sơ**. Lần đo đầu trông như đạt chỉ vì tài khoản test khi đó còn là override — phải hạ về `procedure-participant` mới lộ ra.

### Phân rã công việc vai trò E (verify 2026-08-18)
| Kịch bản | Kết quả |
|---|---|
| Seed từ template đóng băng (không kèm `items`) | ✅ 2 đầu việc từ `EQ-001`, tổng 100 |
| Tổng 90 / tổng 120 | ✅ chặn, báo đúng số hiện tại |
| `33.33+33.33+33.34` | ✅ **chấp nhận** — so sánh theo phần trăm ×100, cộng float thuần sẽ ra `100.00000000000001` và bị từ chối oan |
| Trọng số âm | ✅ chặn |
| Hoàn thành 1 đầu việc | ✅ tiến độ theo trọng số 33.33%, lưu đúng DB |
| Người không giữ vai trò E | ✅ chặn |
| **Chặn đóng bước khi đầu việc còn dở** | ✅ "Còn 2 đầu việc chưa xong (66.67% khối lượng)…" |
| Huỷ đầu việc không cần nữa rồi đóng bước | ✅ stage chuyển `E → C` trong cùng bước, đúng `PROCEDURE_STAGE_ORDER` |

> **Thay đổi hành vi:** trước đây E đóng bước được dù đầu việc còn dở, tức quy tắc tổng = 100 chỉ để trang trí. Nay phải giải quyết hết. "Giải quyết" gồm cả **huỷ** (`POST .../subtasks/:id/cancel`) — nếu bắt buộc phải hoàn thành thì người dùng sẽ đánh dấu xong giả để đi tiếp, làm hỏng chính dữ liệu tiến độ.

Chuỗi khép kín cả 3 module: Inventory `task_template` → đóng băng vào `e_task_config` lúc publish → seed thành subtask lúc chạy.

### Workspace hợp nhất (verify 2026-08-18)
`getWorkspace` lọc work order theo assignment ở **bất kỳ bước nào**, không chỉ bước hiện tại — người duyệt ở bước 4 thấy hồ sơ đang tiến tới mình từ bước 2. Tính cả delegation. `definitions` chỉ trả khi `canDesign`.

| Kiểm chứng | Kết quả |
|---|---|
| Gộp nguồn `manual` + `maintenance_occurrence` | ✅ cùng một danh sách: 1 hồ sơ bảo trì + 7 thủ công, `myRoles` đúng từng cái |
| Có thật sự lọc không | ✅ DB có **22**, nhân viên thấy **8** |
| Override thấy toàn bộ | ✅ admin thấy đủ **22** |
| 14 hồ sơ bị lọc | ✅ đều là những cái nhân viên không giữ vai trò nào |

Đây là yêu cầu cốt lõi của plan: người dùng đăng nhập vào Procedure thấy mọi work order mình tham gia, không phân biệt do bảo trì sinh ra hay tạo thủ công.

| Task | Status | Notes |
|------|--------|-------|
| Validate E-after-C | ✅ | **Đã sửa lỗi**: bản cũ có thân vòng lặp rỗng nên không validate gì. Nay: step có E bắt buộc phải có C |
| Validate AND-logic nhiều R | ✅ | Chặn trùng subject trong cùng role R |
| E(x) phân rã công việc + weight = 100 | ✅ | **Đã làm mới hoàn toàn + verify**. Bảng `subtasks` vốn có sẵn nhưng **không có dòng code nào** dùng tới. Nay: `POST /v1/instances/:id/subtasks` (seed được từ template đóng băng) và `.../subtasks/:id/complete`. Validate ở runtime, đúng chỗ — lúc publish chưa có subtask nào |
| `createInstance()` cho module ngoài | ✅ | Đã test: tạo được instance, idempotency đúng (gọi 2 lần trả cùng id) |
| Endpoint `POST /v1/internal/instances` | ✅ | Xác thực service token, có token → 201, không token → 401 |
| Ghi `source_type`/`source_id` vào instance | ✅ | **Sửa bug**: 2 cột này trước đây không được ghi gì, nguồn gốc work order mất trắng. `initiated_by` cũng bị nhồi chuỗi vào cột uuid |
| Workspace hợp nhất theo assignee | ✅ | **Đã verify bằng 2 tài khoản thật** — xem bảng dưới |
| Role E lấy đầu việc từ Inventory | ✅ | **Đã verify**: publish gọi `/v1/internal/assets/:code/task-template`, đóng băng vào `e_task_config`. Kiểm chứng: sửa asset ở Inventory sau khi publish → definition đã publish **không đổi** |
| Ghi `e_task_config` xuống DB | ✅ | **Sửa bug**: cột này trước đây không được ghi gì cả |
| Escalation | ✅ | **Đã nối vào runtime + verify**. Đơn vị không có trưởng → trách nhiệm lên tổ tiên gần nhất có trưởng. Trả cờ `isEscalated` để UI hiển thị. 8 test unit + kiểm chứng HTTP với cây tổ chức thật (OM không trưởng → LAB có trưởng) |
| Delegation | ✅ | **Đã làm + verify**. `POST /v1/instances/:id/delegations`. Vai trò được uỷ ghi lại **tại thời điểm uỷ** (migration `0004` thêm cột `roles`) vì đơn vị của người uỷ không truy được về sau. Trả cờ `isDelegated`. Gỡ `buildDelegationMetadata` vốn là code chết |
| Sửa `synchronizeNormalized` (bảng actions) | ✅ | **Đã sửa + verify**. Bảng `actions` trước đây bị xoá mỗi lần ghi state mà không dựng lại → mất sạch lịch sử duyệt. Nay dựng lại từ `activity`, có `ON CONFLICT (idempotency_key) DO NOTHING`. Kiểm chứng: 0 → 29 dòng (backfill toàn bộ lịch sử cũ), giữ nguyên qua 6 lượt ghi state tiếp theo |
| Frontend (RsacieMatrixView, ExecutionPanel) | ⏳ | |

---

## ✅ Pha 2: Tích hợp & E2E Test

| Task | Status | Notes |
|------|--------|-------|
| Khởi động 3 API server (3333/3334/3335) | ✅ | Chạy được |
| Đường xác thực service-to-service | ✅ | Thêm `GET /platform/internal/v1/tenant-databases/:id?moduleKey=`, guard 2 app đi nhánh service token |
| Seed definition + schedule | ✅ | Seed bằng SQL, dựng đúng `versions.snapshot` |
| **E2E: schedule → occurrence → instance** | ✅ | **Đã chạy thật**: scheduler `{generated:1}`, occurrence `status=generated` link đúng instance, instance `source_id` trỏ ngược về occurrence (KHỚP) |
| Không sinh trùng khi chạy lại | ✅ | Lần 2 trả `{generated:0}` |
| E2E: execute → complete (các bước RACI) | ✅ | Đã test với 2 tài khoản thật: S→R→C→A→completed, return, reject, và chặn khi chưa tới lượt |

### Đã gỡ xong blocker
1. ~~CSRF chặn POST~~ → route `/v1/internal/` nay xác thực bằng `x-service-token`, fail-closed khi biến môi trường chưa set.
2. ~~Seed data~~ → seed SQL dựng đúng snapshot. Lưu ý: `raci_assignments.subject_id` là **uuid**, không nhận chuỗi kiểu `'user:abc'`.

### Nhất quán giữa 2 service — đã xử lý
Không có distributed transaction giữa Maintenance và Procedure, nên vẫn tồn tại cửa sổ: tiến trình chết giữa lúc gọi HTTP và lúc ghi kết quả sẽ để occurrence kẹt `dispatch_pending` trong khi instance có thể đã được tạo.

**Cơ chế hội tụ (đã verify 2026-08-18):**
- `reconcileStuckDispatches()` quét occurrence `dispatch_pending` chưa có instance và cũ hơn 5 phút, gửi lại. Chạy trong tick 60s của scheduler + route `POST /v1/internal/scheduler/reconcile` cho cron.
- An toàn khi retry vì `idempotencyKey` tất định `maintenance:{scheduleId}:{dueAt}`.

| Kiểm thử | Kết quả |
|---|---|
| Occurrence kẹt 10 phút | ✅ `{recovered:1}`, chuyển sang `generated` |
| Instance **đã tồn tại** từ lần gọi lỗi | ✅ nối vào **đúng instance cũ**, tổng số instance vẫn là 1 — không sinh work order trùng |
| Occurrence mới tinh (`created_at=now`) | ✅ bỏ qua, tránh giẫm chân scheduler đang chạy |
| Gọi reconcile lặp lại | ✅ `{recovered:0}`, idempotent |

> Trong DB dev còn 1 instance mồ côi `PR-20260818-F756B2` trỏ tới occurrence đã rollback — rác từ lần chạy lỗi trước khi tách 2 pha. Reconcile **không** dọn được loại này (occurrence không còn tồn tại); cần dọn thủ công nếu thấy phiền.

---

## 📊 Tổng kết trung thực

| Hạng mục | Tình trạng |
|---|---|
| Contracts (Pha 0) | ✅ Xong, build pass |
| Schema + migrations | ✅ Xong |
| Code 3 module | ✅ Build pass cả 3 |
| Luồng Maintenance → Procedure | ✅ **Đã verify chạy thật end-to-end** |
| Máy trạng thái RACI (S→R→C→A, return, reject) | ✅ Đã verify chạy thật |
| Phân quyền theo vai trò RACI | ✅ Đã tách quyền, verify bằng 2 tài khoản thật |
| Inventory chạy thật | ✅ **Đã verify**: ledger, reservation, transfer, task-template |
| Escalation (đơn vị không trưởng → cấp cha) | ✅ Đã verify với cây tổ chức thật |
| Uỷ quyền vai trò | ✅ Đã verify: uỷ, nhận, thực thi, và các ràng buộc |
| E(x) phân rã + trọng số = 100 | ✅ Đã verify, kèm chặn đóng bước khi còn dở |
| Workspace hợp nhất theo assignee | ✅ Đã verify: gộp 2 nguồn, lọc thật (8/22) |
| Audit trail bảng `actions` | ✅ Đã sửa: 0 → 29 dòng, backfill hồi tố |
| **Giao diện** | ❌ **Chưa có màn hình nào** — toàn bộ verify đều qua API |

**Việc tiếp theo nên làm, theo thứ tự:**
1. **Giao diện** — `inventory-web`, `packages/features/inventory`, `RsacieMatrixView`, `ExecutionPanel`. Đây là việc lớn nhất còn lại: hệ thống hiện chỉ dùng được qua curl
2. Thu hồi uỷ quyền — bảng `delegations` chưa có cột `revoked_at`, uỷ rồi không rút lại được
3. Test tự động cho Inventory + `architecture-boundary.spec.ts`
4. Task template cấp vật tư — schema AMM chưa có chỗ chứa, cần migration
5. Dọn instance mồ côi `PR-20260818-F756B2` trong DB dev


**Đã xong:** ~~Access guard + multi-tenant cho inventory-api~~, ~~nối Procedure → Inventory~~, ~~job quét occurrence kẹt~~

---

## 🚢 Chuẩn bị build cho team test qua LAN

Cập nhật 2026-08-18 sau khi làm UI Inventory.

### ✅ Đã xong

| # | Việc | Kết quả |
|---|---|---|
| 1 | Inventory vào hạ tầng | `inventory-api` (3336) + `inventory-web` (3005) trong `compose.full.yml`; upstream + route `/api/inventory/`, `/modules/inventory/` trong nginx. `docker compose config` và `nginx -t` đều pass. 18 service |
| 2 | Health endpoint | Thêm `HealthController` (`/health/live`, `/health/ready`); Dockerfile trước đó trỏ `/api/inventory/v1/health` — đường dẫn không tồn tại nên container sẽ không bao giờ healthy |
| 3 | Giao diện Inventory | `packages/features/inventory` + `apps/inventory-web`, đủ 8 tab theo template, bảng màu lấy từ `platform-shell.module.css` |
| 5 | URL service-to-service | **3 biến mới của phiên này chưa có trong compose** → trong container sẽ trỏ `localhost` và fail: `PLATFORM_TENANT_DATABASE_URL`, `PROCEDURE_API_URL`, `INVENTORY_API_URL`. Đã thêm vào compose + `.env.example` |
| — | Dockerfile Inventory | Viết lại theo mẫu `procedure-api` (pnpm fetch + `nx run inventory-api:prune`); bổ sung 3 target `prune*` mà Dockerfile gọi |
| — | 3 endpoint danh sách | Tab Serial/Giữ chỗ/Sổ cái trước đó **không có API nào** để lấy dữ liệu. Thêm `GET /serials`, `/reservations`, `/transactions?limit=` |
| — | **`docker build` thành công** | `inventory-api` và `inventory-web` build ra image thật, không chỉ `nx serve` |
| — | Tài khoản demo trong seed | `quanly@minhlong.local` (procedure-manager) và `nhanvien@minhlong.local` (procedure-participant). Trước đó tôi tạo tay bằng SQL nên provision mới sẽ không có |

### ⚠️ Hư hại đã xảy ra và đã khắc phục
Seed `E2E_MAINT` bằng SQL trực tiếp vào `definitions`/`versions` khiến `readNormalized` lấy bảng chuẩn hoá làm nguồn (bỏ qua `runtime_state` chứa data mẫu), rồi `synchronizeNormalized` xoá sạch và ghi lại chỉ state đó → **mất 3 quy trình mẫu**. `seedProcedure` không tự khôi phục vì có điều kiện chỉ ghi khi `instances=0 và definitions<=1`.

**Bài học:** không seed thẳng vào bảng chuẩn hoá của Procedure. Phải đi qua API, hoặc ghi vào `runtime_state`.

### ❌ Đánh giá sai trước đó
Mục #4 "cookie `secure` sẽ chặn đăng nhập" — **không đúng**. `AUTH_COOKIE_SECURE` đã mặc định `false` sẵn trong cả `compose.full.yml` (`${AUTH_COOKIE_SECURE:-false}`) và `.env.example`.

### 🔴 Đóng gói Docker: backend chạy được, frontend + worker chưa

Chạy thật `docker compose up` (project `enterprise-platform-full`, cổng 8090) lôi ra loạt lỗi mà build image, `compose config`, `nginx -t` **đều không bắt được**.

**Đã chạy được trong container:**
```
migrator          Exited (0)  "Migrations and tenant provisioning completed"
api               healthy
procedure-api     healthy
maintenance-api   healthy
inventory-api     healthy
5 DB + rabbitmq + minio  healthy
```

| Lỗi | Nguồn | Trạng thái |
|---|---|---|
| `Cannot find package 'pg'` — migrator + 4 service | có sẵn | ✅ **Sửa được**: khai `pg` trực tiếp ở từng app. `inventory-api` thoát vì tôi viết mới nên khai đủ |
| FK `tenant_memberships_tenant_id_fkey` | **do tôi** | ✅ Sửa: chèn membership demo trước khi tenants tồn tại; DB có sẵn thì chạy được, DB mới thì fail |
| Build 4 Next.js app song song hết RAM | môi trường | ✅ Build tuần tự |
| `MODULE_NOT_FOUND: @swc/helpers` — 4 web app | có sẵn | ❌ **Chưa sửa được** |
| `MODULE_NOT_FOUND: adapter-events` — worker | có sẵn | ❌ **Chưa sửa được** |

**Hai lỗi cuối tôi đã thử sai hướng.** Thêm `@swc/helpers` vào dependencies của app không có tác dụng: Next resolve nó từ **thư mục riêng của chính Next** trong `.pnpm`, pnpm cô lập nghiêm ngặt nên app khai cũng vô ích. Đã gỡ để không để lại rác.

Với worker, sửa `adapter-events` trỏ `main` vào `dist` (khớp `adapter-database`) là **đúng hướng nhưng chưa đủ** — lỗi chuyển từ "không thấy `src/index.js`" sang "không thấy chính module đó", tức bản prune không link được nó.

Cả hai đều là vấn đề của cơ chế `pnpm prune` + `file:` deps trong Dockerfile, **có từ trước phiên này**. Cần người hiểu rõ cơ chế đóng gói xử lý, không nên vá tiếp bằng cách đoán.

### ✅ Bản test LAN đang chạy — phương án A (host + gateway)

```
http://192.168.88.233:8080
```

| Đường dẫn | Kết quả qua IP LAN |
|---|---|
| `/` core portal | HTTP 200 |
| `/modules/procedure` | HTTP 200 |
| `/modules/maintenance` | HTTP 200 |
| `/modules/inventory` | HTTP 200 |
| Đăng nhập `admin@minhlong.local` | ✅ |
| `procedure/v1/workspace` | 3 quy trình, 4 hồ sơ |
| `maintenance/v1/workspace` | 1 lịch, 1 phiếu |
| `inventory/v1/*` | 5 kho, 6 vật tư, 4 tài sản, 6 giao dịch, 3 serial, 1 phiếu giữ chỗ |

**Mảnh bắt buộc đã bổ sung:** `infrastructure/nginx/nginx.conf` (bản local, proxy `host.docker.internal`) **thiếu inventory hoàn toàn** — trước đó tôi chỉ thêm vào `nginx.docker.conf`. Web app không có rewrite trong `next.config.js` nên **phải đi qua gateway**; mở thẳng cổng riêng (3005…) thì trang hiện ra nhưng mọi API call đều trượt.

**Cách khởi động:**
```bash
docker compose -f infrastructure/docker/compose.local.yml --env-file .env up -d   # DB + gateway
pnpm dev                                                                          # 6 app
pnpm nx run inventory-api:serve      # cổng 3336, cần DATABASE_URL
pnpm nx run inventory-web:dev        # cổng 3005
```

Hạn chế: chạy tay trên máy host, không tự khởi động lại khi crash.

### ❌ Đóng gói Docker chưa xong (không chặn phương án A)
`@swc/helpers` cho 4 web app và `adapter-events` cho worker vẫn lỗi trong bản prune. Tôi đã thử 2 hướng và **cả hai đều sai**:
- Thêm `@swc/helpers` vào dependencies của app: vô ích, Next resolve từ thư mục riêng của nó trong `.pnpm`
- Trỏ `adapter-events` `main` sang `dist`: **làm hỏng cả dev local** vì `dist/` chỉ có file khai báo type, **không có `index.js`**. Đã hoàn nguyên

Cần người nắm rõ cơ chế `pnpm prune` + `file:` deps xử lý.

### 🟡 Còn lại trước khi giao team### 🟡 Còn lại trước khi giao team

| # | Việc | Ghi chú |
|---|---|---|
| 1 | Bí mật vẫn là giá trị mẫu | `INTERNAL_SERVICE_TOKEN`, `SEED_*_PASSWORD` đều là chuỗi `replace-with-...`. **Việc duy nhất bắt buộc phải làm trước khi giao team** |
| — | ~~Dữ liệu rác~~ | ✅ Đã dọn: xoá 13 definition + 22 instance test, khôi phục 3 quy trình mẫu (`QT_MSTB`, `EXEC_QT_MSTB`, `QT_THANH_TOAN`) + 4 hồ sơ. Giữ nguyên data mẫu Inventory |
| — | ~~Build image~~ | ✅ **Toàn bộ 10 image build thành công** |
| 5 | Chưa xác nhận trực quan UI | Playwright thiếu browser binary nên không chụp được màn hình. Trang trả HTTP 200 và API đủ dữ liệu, nhưng **chưa ai nhìn tận mắt** |

### 🟢 Không chặn
Thu hồi uỷ quyền; test tự động Inventory + `architecture-boundary.spec.ts`; task template cấp vật tư; `RsacieMatrixView`/`ExecutionPanel`.

---

### Cách đăng nhập để test thủ công
```bash
curl -X POST http://localhost:3333/api/auth/v1/login -H "Content-Type: application/json" -c cookies.txt \
  -d '{"email":"admin@minhlong.local","password":"<SEED_TENANT_ADMIN_PASSWORD>","portal":"tenant"}'
# portal là bắt buộc ('platform' | 'tenant'), thiếu sẽ trả 400
CSRF=$(grep ep_csrf cookies.txt | awk '{print $7}')
curl -X POST http://localhost:3334/api/procedure/v1/... -b cookies.txt -H "x-csrf-token: $CSRF"
```


</details>
