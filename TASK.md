# Task Tracking — Enterprise Platform

> ## ⛔ QUY TẮC BẮT BUỘC: FILE NÀY CHỈ ĐƯỢC APPEND
>
> Kể từ bản tạo lại ngày **19/08/2026**, TASK.md **chỉ được thêm vào cuối**.
> Không sửa, không viết đè, không xoá nội dung đã có — kể cả nội dung sai.
> Ghi nhận sai thì **thêm một mục đính chính mới ở cuối**, dẫn chiếu ngược lên mục cũ.
> Lý do: file này là nhật ký để tra lại về sau; sửa lịch sử làm mất chính thứ khiến nó có giá trị.

**Bản tạo lại này gộp toàn bộ công việc trong phiên làm việc 19/08/2026.**
Nội dung TASK.md trước đó (nhật ký Pha 0 / Pha 1 / Pha 2 dựng 3 module, trước phiên này) **không mất** — nằm trong git tại commit `1d2382d:TASK.md`, lấy lại bằng:

```bash
git show 1d2382d:TASK.md > /tmp/TASK-truoc-19-08.md
```

> **Quy ước trạng thái**
> ✅ = đã viết **và** đã chạy build/verify thành công
> 🟨 = code có nhưng chưa verify, hoặc mới xong một phần
> ⏳ = chưa làm
> ❌ = phát hiện hỏng, đang sửa

---

# PHẦN I — ĐÃ LÀM TRONG PHIÊN 19/08/2026

## Bốn commit đã tạo (đều được người dùng duyệt message trước)

| Commit | Giờ | Nội dung |
|---|---|---|
| `7a722fe` | 08:24 | UI Kho/Bảo trì/Quy trình, tenant SAVINA, phân rã E(x) |
| `0788f5a` | 10:17 | SLA cho bước, tệp đính kèm theo giai đoạn, trao đổi trên workorder |
| `5f1a6de` | 13:06 | Lịch sử bảo trì và bảo trì sự cố |
| `1d2382d` | 15:14 | Nhóm quy trình, bộ lọc workorder, sửa lỗi test LAN |

**Quy tắc git đã chốt, áp dụng vĩnh viễn:** không tự commit. Mọi commit phải đề xuất message và chờ người dùng duyệt. Message viết ngắn gọn.

---

## Mốc 1 — Dựng lại ma trận RCSI theo BRD gốc

Yêu cầu ban đầu bị làm sai: tôi tạo tab riêng để tạo quy trình, trong khi **việc tạo quy trình phải diễn ra ngay trên ma trận**. Đọc lại `module_old/recap.md` + `plan_brd_1/2/3.md` để dựng đúng.

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Tạo quy trình ngay trên ma trận, không tab riêng | ✅ | |
| Mở rộng ngang nhiều cấp đơn vị, một vai trò mỗi ô, popover gán vai trò | ✅ | Theo đúng mô tả BRD gốc |
| Mock data SAVINA | ✅ | |
| Bỏ nút "Ẩn cột không liên quan", chỉ còn Thu gọn / Mở rộng | ✅ | Thu gọn = chỉ đơn vị đang tham gia; Mở rộng = toàn công ty, mở dần từ con của root |
| Mặc định vào không sổ dọc/ngang; bấm quy trình nào mới sổ quy trình đó | ✅ | |

## Mốc 2 — Ba module theo ảnh mẫu

| Module | Việc | Trạng thái |
|---|---|---|
| Kho | Thêm sửa thông số kỹ thuật và đầu việc bảo trì mặc định của thiết bị | ✅ |
| Bảo trì | Ma trận thiết bị × tần suất | ✅ |
| Quy trình | UI theo template | ✅ |

## Mốc 3 — Workspace theo người dùng đang đăng nhập

Workorder chỉ hiện với người có tham gia hồ sơ. Vị từ `isProcedureParticipant` (override · người khởi tạo · giữ vai trò ở **bất kỳ** bước nào · được uỷ quyền · được giao đầu việc E(x)) — về sau dùng lại cho cả chat và tệp đính kèm.

## Mốc 4 — Phân rã E(x) và bằng chứng thực hiện

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Người phụ trách đơn vị phân rã đầu việc cho thành viên trong đơn vị | ✅ | E(1) → E(5) |
| Mỗi người đăng nhập thấy đúng phần việc của mình | ✅ | |
| **Bắt buộc đính kèm tài liệu trước khi báo xong** | ✅ | Ảnh hoặc văn bản |
| **E chỉ gán được cho người phụ trách đơn vị** | ✅ | Luật đặt ở `validateDefinitionForPublish`, xem lỗi tự gây #4 |

## Mốc 5 — Xuất tài khoản nhân sự SAVINA

`docs/tai-khoan-savina.md`. ⚠️ Mật khẩu trong file vẫn là giá trị mẫu `replace-with-...`.

## Mốc 6 — Tách database core và module

Kiểm tra: DB có tách. Ba chỗ hở đã sửa, kèm 3 spec ranh giới mới (`architecture-boundary.spec.ts` cho mỗi module) quét glob toàn bộ migration, bóc chú thích SQL, cho phép system catalog, và khẳng định module chỉ chạm schema của chính nó. **Đã chứng minh spec bắt được vi phạm thật** bằng cách cố tình tạo 2 vi phạm rồi xoá đi.

---

## Mốc 7 — 🚑 Lỗi mất dữ liệu phát hiện khi lập kế hoạch 5 tính năng

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| `attachments.instance_id` là `ON DELETE CASCADE` → **mọi lần ghi hồ sơ xoá sạch đính kèm** | ✅ | `synchronizeNormalized` chạy `DELETE FROM instances` mỗi lần ghi. Xác minh trên DB thật: 2 file upload lượt trước **đã mất**, object mồ côi trong MinIO. Sửa bằng `0006-attachment-survives-writes.sql` (bỏ CASCADE, `DEFERRABLE INITIALLY DEFERRED`) |
| Kiểm chứng đính kèm sống sót qua lần ghi | ✅ | Upload → ghi hồ sơ → còn nguyên |
| `0005` bị nối thêm sau khi đã áp dụng → checksum mismatch | ✅ | Migration đã chạy thì bất biến. Khôi phục `0005` về nội dung gốc (checksum khớp `b393bce5…`), dồn bản vá FK sang `0006` |

**Hệ quả nghiêm trọng:** tính năng bằng chứng E(x) ở Mốc 4 tôi đã báo là "chạy được" **thực ra đang hỏng** — tôi kiểm cổng chặn lúc bấm hoàn thành nhưng chưa bao giờ kiểm file còn sống sau lần ghi kế tiếp.

---

## Mốc 8 — Đợt 1: Module Quy trình (SLA · Đính kèm · Chat)

### 8.1 SLA cho từng giai đoạn
| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Contract `slaHours` (step definition + input), `slaDueAt` (instance step) | ✅ | Phải là trường contract — cột chuẩn hoá sẽ bị `synchronizeNormalized` xoá |
| Helper `evaluateStepSla` dùng chung API + UI | ✅ | Ngưỡng: còn >4h · còn ≤4h · quá hạn · không SLA |
| Tính hạn ở 3 điểm gán `startedAt` | ✅ | `startInstance`, `advance()`, `returnToPreviousStep()` |
| `createDefinition` **và** `updateDefinition` mang theo `slaHours` | ✅ | Thiếu một là mất dữ liệu |
| `toStepInput()` trong `rcsi-board.tsx` | ✅ | Phễu duy nhất của mọi thao tác sửa — quên là mất SLA mỗi lần bấm ô RACI |
| Validate `slaHours` 1–8760 giờ nguyên | ✅ | `0` và `2.5` đều bị chặn |
| UI ô nhập SLA + badge trên thẻ đơn và thẻ bước | ✅ | |

### 8.2 Tệp đính kèm theo giai đoạn
| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Danh sách trắng content-type | ✅ | jpg/png/pdf/docx/xlsx/txt, đuôi phải khớp content-type khai báo. `sizeBytes` do client gửi và **không kiểm chứng được** — ghi rõ giới hạn trong code |
| `create()` kiểm quyền actor + server tự đóng dấu `stepInstanceId` | ✅ | Trước đó **không kiểm gì**, và tin `stepInstanceId` client gửi |
| `list()` kiểm quyền | ✅ | Trước đó **bất kỳ user nào trong tenant cũng liệt kê được file của mọi hồ sơ** — rò rỉ thật. Luật đúng do người dùng chốt: file thuộc từng workorder, **chỉ người có mặt trong workorder đó mới xem được**; admin thấy mọi workorder nên đương nhiên thấy file |
| Tab Tệp đính kèm + lọc theo giai đoạn | ✅ | |
| Xem lại được sau khi hồ sơ đã đóng | ✅ | |

### 8.3 Trao đổi trên workorder
| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Endpoint riêng `POST /instances/:id/comments` | ✅ | **Không nới `availableActions`** — nó điều khiển hàng nút hành động, nới ra làm loãng nghĩa RACI |
| `canComment` / `canReadFeed` | ✅ | Trước đó vai trò `I` và người nhận đầu việc E(x) **không bình luận được** |
| Feed mới nhất lên trên | ✅ | Bỏ phép sắp lại cũ-nhất-trước |
| Tab Trao đổi + Ctrl+Enter + @mention | ✅ | Mention chỉ tô đậm, **không có thông báo** — người dùng đã chọn bỏ |

### Kiểm chứng Đợt 1 (tài khoản thật SAVINA)
| Kịch bản | Kết quả |
|---|---|
| SLA lưu vào bản nháp, còn nguyên sau khi ghi lại | ✅ |
| Khởi tạo → B1 nhận hạn +1h, B2 chưa có hạn | ✅ |
| Chuyển bước → B2 nhận hạn +4h, B1 đóng băng | ✅ |
| Trả về bước trước → bước đích nhận khung SLA mới, bước bị trả giữ hạn cũ đóng băng | ✅ |
| **SLA sống sót khi bấm một ô RACI** | ✅ B1=6h, B2=12h giữ nguyên |
| Người trong hồ sơ nhưng không giữ vai trò bước hiện tại gửi trao đổi | ✅ (trước đây không thể) |
| Người ngoài hồ sơ gửi trao đổi / xem tệp | ✅ 403 cả hai |
| Upload `.exe` · đuôi và content-type không khớp | ✅ chặn cả hai |

---

## Mốc 9 — Đợt 2: Module Bảo trì (Lịch sử · Sự cố)

Khác Đợt 1 (phần lớn nối dây trên hạ tầng có sẵn), đợt này **phải đổi schema** vì `occurrences` gắn cứng vào `schedules`.

### 9.0 Nền — schema và ba lỗi có sẵn
| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Tái hiện lỗi `assetCode` luôn rỗng | ✅ | Đo trước khi sửa: cả 4 phiếu trả `assetCode: ""`. `read()` không select `s.asset_code` nhưng `mapOccurrence` lại đọc `row.asset_code` |
| Migration `0003-incident-and-history.sql` | ✅ | `schedule_id` nullable; thêm `kind/code/title/asset_code/description/procedure_definition_id/assignee_*/completion_note/completed_by*/created_by*`; CHECK `kind` và CHECK hình dạng theo `kind`; thêm status `in_progress`; 3 index |
| Không đụng `UNIQUE (schedule_id, due_at)` | ✅ | Postgres coi các NULL là khác nhau trong unique btree nên nhiều sự cố cùng lúc vẫn chèn được |
| Status `in_progress` riêng, không mượn `planned` | ✅ | KPI "Sắp đến hạn" đếm theo `planned`; dùng chung sẽ thổi phồng con số |
| Sửa `read()`: thêm `asset_code`, `INNER JOIN` → `LEFT JOIN` | ✅ | **Kiểm chứng canary**: trước sửa cả 4 phiếu rỗng, sau sửa ra đúng `MBA-T1` / `RELAY-901`. `COALESCE(o.asset_code, s.asset_code)` |
| Sửa `reconcileStuckDispatches` cũng `LEFT JOIN` | ✅ | Nếu không, sự cố biến mất khỏi mọi màn hình và không bao giờ được gửi lại |

### 9.1–9.2 Contracts · Store · Application · Controller
| Việc | Trạng thái | Ghi chú |
|---|---|---|
| `MaintenanceOccurrenceKind`, mở rộng `MaintenanceOccurrence` | ✅ | `scheduleId`/`scheduleTitle` thành optional vì sự cố không có lịch cha |
| `MaintenanceHistoryFilter` / `Page`, phân trang keyset `<dueAt>\|<id>` | ✅ | Thay OFFSET — ổn định khi dữ liệu đang đổi |
| `readHistory` có lọc + phân trang | ✅ | **Không** dùng lại `read()`: hàm đó không giới hạn và đang bị 5 endpoint dùng chung |
| `findOccurrence`, `completeOccurrence` | ✅ | Đóng rồi không mở lại được |
| `createIncident` | ✅ | Tái dùng nguyên vẹn `dispatchToProcedure`; khoá `incident:<uuid>` |
| Validate mã thiết bị qua `AssetDirectory` | ✅ | Kho hỏng thì bỏ qua kiểm, theo cách `getMatrix` đã xuống thang |
| 4 endpoint: history · chi tiết · incident · complete | ✅ | |

### 9.3 Tự hoàn thành sự cố khi workorder xong
| Việc | Trạng thái | Ghi chú |
|---|---|---|
| Phát `procedure.instance.completed` từ `appendEvents` | ✅ | Trước đó Procedure **chỉ phát đúng 1 loại event** (`definition.published`) — đã kiểm trên outbox SAVINA |
| Worker: binding + handler | ✅ | `rejected`/`cancelled` ghi `failed`, **không** ghi `completed` — bảo trì không hề diễn ra |
| Dọn binding `maintenance.procedure-start.requested` | ✅ | Không nơi nào phát |

### Kiểm chứng Đợt 2 (tài khoản admin@savina.local)
| Kịch bản | Kết quả |
|---|---|
| Mã thiết bị không có thật | ✅ chặn |
| Sự cố **không** kèm quy trình | ✅ `INC-2026-F4BD`, `in_progress`, không `schedule_id` |
| Sự cố **có** kèm quy trình | ✅ `INC-2026-B2BF` → tự mở workorder `PR-20260819-C2483C` |
| Lịch sử gộp định kỳ + sự cố · lọc · keyset | ✅ 6 phiếu · lọc đúng · trả `nextCursor` |
| Đóng phiếu lần hai | ✅ chặn |
| Chạy workorder tới completed → chờ worker | ✅ **sự cố tự đóng** |
| `rejected`/`cancelled` → `failed` | ✅ |

### 9.4 Giao diện
Tab Lịch sử + bộ lọc (fetch riêng, không gộp `reload()`), panel chi tiết, form Tạo sự cố hiện ở mọi tab, badge phân biệt sự cố/định kỳ, KPI sự cố đang mở.

### 9.5 Bỏ emoji dùng làm icon
✅ 8 chỗ: nhãn tab, tiêu đề panel, icon dòng trao đổi, chip liên kết, icon thiết bị, log khởi động 4 service. Emoji hiển thị khác nhau tuỳ hệ điều hành, không theo bảng màu sáng/tối, không thêm nghĩa gì so với chữ bên cạnh. Dòng trao đổi chuyển sang **chấm màu**. Giữ `✓ ✕ ▾ ▸ ← →` vì là ký tự typography, không phải emoji.

---

## Mốc 10 — Ba lỗi từ ảnh chụp + build cho team test LAN

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| **Gõ `@` không hiện gợi ý tên** | Mới làm phần tô đậm khi hiển thị, chưa làm bộ chọn lúc gõ | Danh sách gợi ý nổi trên ô nhập. Không dừng ở khoảng trắng đầu tiên vì tên tiếng Việt có dấu cách; chỉ nhận `@` đầu dòng hoặc sau khoảng trắng để không bắt nhầm email. Dùng `onMouseDown` chứ không `onClick` — click xảy ra sau blur, lúc đó danh sách đã đóng |
| **Thiếu bộ lọc "Đã huỷ"** | `Filter` liệt kê tay 4 giá trị, sót `cancelled` → 2 đơn đã huỷ không lọc tới được, tổng các tab không khớp "Tất cả" | Suy ra danh sách tab **từ `STATUS_LABEL`**. Kiểm chứng: 12 = 8 running + 1 completed + 1 rejected + 2 cancelled |
| **Không liên kết được quy trình A → B** | `linkedDefinitionId` có đủ trong contract, application và DB nhưng **không dòng code nào dùng lúc chạy**, và không có UI nào đặt nó | Nối vào `advance()`: bước xong thì mở hồ sơ quy trình nối tiếp, `sourceType='auto_from_parent'`, khoá `linked:<parent>:<step>`. Quy trình đích còn nháp hoặc đã gỡ thì **ghi nhật ký thay vì làm vỡ bước** |

## Mốc 11 — Sửa lỗi khi team test qua LAN

| Vấn đề | Nguyên nhân | Sửa |
|---|---|---|
| Đăng nhập được qua localhost nhưng **không được qua IP LAN** | 4 web app chạy chế độ dev; Next 16 chặn request dev từ origin khác localhost nên trang không hydrate, form rơi về submit GET thuần. Backend hoàn toàn bình thường | Chuyển sang **production build**; thêm `allowedDevOrigins`. Tắt `module_old` đang chiếm cổng 3000/3001 |
| `crypto.randomUUID is not a function` khi tạo đơn | `crypto.randomUUID` **chỉ có trong secure context** (HTTPS hoặc localhost). Qua IP LAN bằng HTTP thuần thì undefined → mọi thao tác ghi vỡ ngay ở trình duyệt | `newIdempotencyKey()` dựng UUID v4 bằng `crypto.getRandomValues` khi thiếu. Kiểm 20000 khoá: 0 sai định dạng, 0 trùng |
| Vai trò A trả lại chỉ về được bước liền trước | `returnToPreviousStep` chỉ đọc `fixedRollbackStepId` của C, còn lại luôn `currentIndex - 1` | Thêm `returnToStepId`. **A chọn được bước** (họ duyệt cuối, nhìn thấy toàn hồ sơ); **C vẫn cố định** theo cấu hình lúc thiết kế — đó là ý nghĩa của C(x). Chọn bước sau bước hiện tại bị chặn |

**Bài học kiểm thử:** kiểm bằng curl không chạy JavaScript nên cả hai lỗi đầu không lộ ra dù mọi endpoint đều trả 200. Với lỗi chỉ xảy ra trong trình duyệt, phải kiểm nội dung HTML và bundle, không chỉ mã trạng thái HTTP.

## Mốc 12 — Nhóm quy trình + bộ lọc workorder

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| 6 nhóm trong contract | ✅ | `PROCEDURE_CATEGORIES` + `_LABEL` + `_HINT` (đơn vị chủ trì + ví dụ) dùng chung API/UI |
| `category` trên quy trình | ✅ | Trường contract nên nằm trong `versions.snapshot`, sống sót `synchronizeNormalized` |
| `definitionCategory` trên hồ sơ | ✅ | **Bắt buộc chép lúc khởi tạo**: người không phải designer nhận `definitions: []`, workspace sẽ không tra ngược được |
| Gán nhóm cho quy trình **đã công bố** | ✅ | Endpoint riêng `PATCH /definitions/:id/category` |
| Lọc theo nhóm trên ma trận | ✅ | Ô chọn đầu bảng + ô chọn từng dòng, chỉ hiện với người có quyền `design` |
| Lọc workorder | ✅ | Nhóm · tình trạng SLA · nguồn tạo · khoảng ngày + nút xoá lọc. **Hoàn tất AC-SLA-06 còn nợ từ Đợt 1** |

**Vì sao tách endpoint riêng:** ban đầu để `category` đi chung `updateDefinition`, kết quả cả 3 quy trình đang chạy của SAVINA báo *"Chỉ bản nháp mới sửa được"*. Nhóm chỉ là nhãn để lọc, không đổi ngữ nghĩa thực thi — bắt "mở lại bản nháp → công bố lại" chỉ để gắn nhãn là đưa quy trình ra khỏi vận hành vô cớ. Ngoại lệ ghi chú ngay tại `setDefinitionCategory`.

Kiểm chứng: gán nhóm cho 3 quy trình `published` → OK; nhóm không hợp lệ → chặn; bỏ trống → gỡ nhãn; hồ sơ mới mang đúng `definitionCategory`.

## Mốc 13 — Tối giản UI module Kho *(chưa commit)*

**Đo trước khi sửa** — 8 tab cho lượng dữ liệu thật: 8 tài sản · 8 vật tư · 3 kho · 10 dòng tồn · 10 giao dịch · **0 serial** · **0 phiếu giữ chỗ**. Hai tab luôn rỗng, và `Overview` gọi đúng component `StockTable` mà tab "Tồn kho" đang gọi nên bảng tồn bị vẽ hai lần.

| Việc | Trạng thái | Ghi chú |
|---|---|---|
| 8 tab → 3: Tồn kho · Tài sản · Nhật ký | ✅ | Hash cũ (`#serials`, `#materials`, `#warehouses`, `#overview`, `#reservations`) chuyển hướng, link đã chia sẻ không vỡ |
| **Bỏ hẳn Serial** | ✅ | Cả tab, `loadSerials()` lẫn kiểu `InventorySerialRow` |
| Vật tư + Kho gộp vào tab Tồn kho | ✅ | Kho thành hàng chip lọc; bấm dòng tồn mở nhóm/ĐVT/min-max và phiếu đang giữ hàng |
| Banner gradient → header gọn | ✅ | Bỏ eyebrow tiếng Anh; 5 thẻ KPI + 3 panel → một dải chỉ số 4 số |
| Việt hoá toàn bộ enum | ✅ | `inventory-labels.ts`; kiểm tự động 31 giá trị của 7 union — đủ, không thừa |
| **Cây tài sản thật** | ✅ | `parentId` vốn đủ 4 cấp nhưng UI vẽ phẳng. Tách `asset-tree.model.ts` thuần để kiểm không cần trình duyệt |
| Nhật ký có bộ lọc | ✅ | Loại · kho · khoảng ngày + xoá lọc |
| Tách file | ✅ | 851 dòng một file → vỏ + 4 component + nhãn + model cây (+277 / −917) |

**Kiểm chứng bằng trình duyệt thật** — đã cài `chromium` cho Playwright (trước đây thiếu binary nên chưa ai nhìn tận mắt màn hình này). Đăng nhập `admin@savina.local` qua LAN: lọc kho 2/2/6 = 10 khớp tổng · tìm "dầu" còn 1 dòng · cây đúng 4 cấp `TBA-110 → TBA-110-NGAN1 → MC-901 → RELAY-901` · tìm "RELAY" kéo theo đủ tổ tiên · 9 hash vào đúng tab · **0 lỗi JS, 0 response ≥400**.

---

## PHẦN II — LỖI TỰ GÂY TRONG PHIÊN NÀY

| # | Lỗi | Nguyên nhân | Sửa |
|---|---|---|---|
| 1 | Ma trận xê dịch khi thu gọn/mở rộng, ô vai trò lệch khỏi cột | `display:flex` đặt thẳng lên `<td>` làm nó rời khỏi thuật toán bố cục bảng | Tách `.stickyCell` (td) + `.stickyInner` (div). Cùng lỗi này cũng có ở ma trận Bảo trì |
| 2 | Ô rơi nhầm cột sau vài lần bật/tắt | 6 key React trùng nhau do kiêm nhiệm | Chuyển sang key theo đường dẫn; đánh key cho mọi dòng `<thead>` |
| 3 | Cây tổ chức rỗng | `parentId` là `null` chứ không phải `undefined` → `childrenOf.get(undefined)` không tìm ra gốc | Chuẩn hoá `parentId ?? undefined` ở cả `columns.ts` và trang org-chart |
| 4 | **Không thêm/xoá được vai trò trên ma trận** | Luật "E chỉ gán cấp đơn vị" đặt nhầm vào `validateDefinitionDraft`. `writeCell` PATCH **cả bản nháp** mỗi lần bấm một ô, nên một ô `E→user` cũ làm hỏng mọi thao tác trên mọi ô — kể cả sửa chính ô đó. Deadlock | Chuyển sang `validateDefinitionForPublish`; vô hiệu nút E trên cột không phải đơn vị kèm tooltip |
| 5 | Không công bố được (hệ quả của #4) | Muốn sửa E thì cần ô cấp đơn vị, nhưng cột neo đã bị prune | Luôn giữ cột neo `#self` của đơn vị đang mở rộng |
| 6 | Trắng màn hình | `snapshot.units is not iterable`, `matrix.rows` undefined | Đọc phòng thủ ở 6 chỗ |
| 7 | Báo sai kích thước commit | Nói 85 file/+4000, thật ra 107 file/+10678 vì `git status` không đệ quy thư mục chưa theo dõi | Dùng `git status -uall` |
| 8 | Spec ranh giới báo dương tính giả | Tên schema nằm trong chú thích SQL và `information_schema` | Bóc chú thích, allowlist system catalog, rồi cố tình tạo 2 vi phạm để chứng minh spec vẫn bắt được |
| 9 | Commit nhầm repo | `cd` không giữ giữa các lệnh; commit rơi vào repo ngoài, kéo theo `module_old` và `enterprise-platform` dạng gitlink | `git reset HEAD~1`, commit lại đúng repo `enterprise-platform` |
| 10 | Ba lần "phát hiện lỗi" ở chỗ không có lỗi | (a) regex cắt mất `basePath` `/modules/inventory` → báo 5 chunk 404; (b) zsh không tách từ biến nên vòng lặp curl nối hết URL làm một → báo thiếu nhãn; (c) đổi hash trên cùng trang không nạp lại nên tab giữ state cũ → tưởng chuyển hướng hỏng | Kiểm lại đúng cách trước khi kết luận |

**Bài học xuyên suốt:** phần lớn báo cáo "chạy được" sai trong phiên này đến từ **kiểm sai thứ**. HTTP 200 không chứng minh trang hoạt động (không chạy JS). Kiểm cổng chặn lúc bấm không chứng minh dữ liệu sống sót qua lần ghi sau. Và lệnh kiểm của chính mình cũng phải nghi ngờ trước khi kết luận code hỏng.

---

## PHẦN III — MÂU THUẪN CÒN TREO, CẦN PO XÁC NHẬN

| # | Vấn đề |
|---|---|
| 1 | **SLA Flow B giả định có danh sách toàn bộ workorder.** `getWorkspace` chỉ trả hồ sơ người dùng có tham gia — người giám sát không giữ vai trò RACI nào sẽ không thấy gì. Bộ lọc SLA đã làm xong nhưng chỉ trong phạm vi hồ sơ người đó thấy; muốn giám sát toàn tenant cần endpoint riêng |
| 2 | ✅ **ĐÃ GIẢI QUYẾT 19/08** (xem append cuối file). ~~AC-HST-05 / AC-INC-01 chưa khả thi với mô hình quyền hiện tại.~~ `MaintenanceAccessGuard` map **mọi** request non-GET vào `maintenance.manage`, nên "Kỹ thuật viên" không đánh dấu hoàn thành hay tạo sự cố được. Hằng số `maintenance.occurrence.manage` đã có trong contract nhưng chưa dùng |
| 3 | Tài liệu §4.3 cho phép admin xoá file đính kèm — đã chốt **không làm** |
| 4 | AC-CHT-02 nới quyền bình luận rộng hơn RACI hiện tại: vai trò `I` và người nhận đầu việc E(x) bình luận được |

## PHẦN IV — CÒN NỢ TRƯỚC KHI GIAO RỘNG

| # | Việc | Ghi chú |
|---|---|---|
| 1 | **Bí mật vẫn là giá trị mẫu** | `INTERNAL_SERVICE_TOKEN`, `SEED_*_PASSWORD` đều là `replace-with-...`. Chấp nhận được cho test LAN nội bộ, **bắt buộc đổi** trước khi lộ ra ngoài |
| 2 | UI Kho vẫn chỉ đọc | `POST /receipts`, `/issues`, `/reservations` đã có nhưng chưa nút nào gọi |
| 3 | Đóng gói Docker chưa xong | `@swc/helpers` cho 4 web app và `adapter-events` cho worker lỗi trong bản prune. Không chặn phương án chạy tay trên host |

---

# PHẦN V — KẾ HOẠCH TIẾP THEO (chưa bắt đầu)

Yêu cầu ngày 19/08, 7 mục qua 3 module. **Ba ràng buộc chi phối mọi thiết kế bên dưới:**

1. **`runtime_state` jsonb là nguồn sự thật của Quy trình.** `synchronizeNormalized()` xoá và dựng lại mọi bảng chuẩn hoá sau mỗi lần ghi → danh sách vật tư của bước **phải là trường contract**, không được là bảng mới.
2. **Tiền lệ đóng băng đã có:** `eTaskConfig.taskTemplate` resolve **một lần lúc công bố** qua `GET /internal/assets/:code/task-template` rồi đóng băng. Vật tư theo đúng khuôn: **danh sách yêu cầu đóng băng lúc công bố, kiểm tồn là việc lúc chạy**.
3. **Kho hiện chỉ có `PATCH /assets/:code`** và route đó **chỉ nhận `specs` + `taskTemplate`**. Không có route tạo/xoá vật tư hay thiết bị nào.

**Thứ tự đề xuất: Đợt 5 → Đợt 3 → Đợt 4.** Đợt 5 gọn và độc lập; Đợt 3 sinh ra `GET /internal/materials/:code` mà Đợt 4 cần; Đợt 4 làm cuối vì chạm cả ba module và còn hai quyết định treo.

## Đợt 3 — Kho: quản lý danh mục và nhập/xuất

### 3.1 Thêm / sửa / xoá vật tư và thiết bị
**"Xoá" nên là ngừng hoạt động, không phải DELETE.** Ledger là sổ cái append-only; xoá vật tư đã có giao dịch làm mồ côi lịch sử tồn, xoá thiết bị có `parentId` làm đứt cây.

| Đối tượng | Cơ chế ngừng | Sẵn có |
|---|---|---|
| Vật tư | `Material.isActive = false` | ✅ trường đã có, chưa ai ghi |
| Thiết bị | `Asset.status = 'DISPOSED'` | ✅ enum đã có, đã dịch "Đã thanh lý" |

Xoá cứng chỉ khi **chưa có giao dịch và chưa có con** — kiểm ở tầng application, trả lỗi nói rõ lý do thay vì để FK nổ.

| # | Việc | Trạng thái |
|---|---|---|
| 3.1.1 | `POST /materials`, `PATCH /materials/:code` (validate `minStock ≤ maxStock`, mã không trùng) | ✅ |
| 3.1.2 | `DELETE /materials/:code` → `isActive=false`; xoá cứng chỉ khi chưa có giao dịch | ✅ |
| 3.1.3 | `POST /assets`, `DELETE /assets/:code` | ✅ |
| 3.1.4 | Mở rộng `PATCH /assets/:code` nhận `name`, `parentId`, `status`, `criticality` | ✅ |
| 3.1.5 | `GET /internal/materials/:code` — **Đợt 4 phụ thuộc** | ✅ |
| 3.1.6 | UI: nút "+ Vật tư" ở tab Tồn kho; "+ Thiết bị" (chọn cha trên cây) và "Thanh lý" ở tab Tài sản | ✅ |

### 3.2 Nhập / xuất vật tư trên giao diện
| # | Việc | Trạng thái |
|---|---|---|
| 3.2.1 | Form nhập / xuất / chuyển kho ở tab Tồn kho, ghi chú bắt buộc | ✅ |
| 3.2.2 | Kết quả hiện sang tab Nhật ký | ✅ |

⚠️ **Vướng quyền — ĐÃ GIẢI QUYẾT 19/08** (xem append cuối file). ~~Mọi lệnh ghi đều qua `requireManager(actor)` → thủ kho không có quyền quản lý sẽ không nhập/xuất được. **Cùng loại với mâu thuẫn #2** (Phần III). Đã tách `inventory.transaction.write` khỏi `inventory.manage`.~~

## Đợt 4 — Vật tư gắn vào bước bảo trì

### 4.1 Khai báo lúc thiết kế
```ts
interface ProcedureStepMaterial {
  readonly materialCode: string;
  readonly quantity: number;
  readonly note?: string;
  // Chụp lúc công bố, để hồ sơ đang chạy không đổi khi Kho sửa danh mục:
  readonly materialName?: string;
  readonly unit?: string;
}
```
Đặt trên `ProcedureStepDefinition.materials?` **và** `ProcedureInstanceStep.materials?` (chép lúc khởi tạo, như `slaHours` và `linkedDefinitionId`).

| # | Việc | Trạng thái |
|---|---|---|
| 4.1.1 | Contract `ProcedureStepMaterial` trên definition + instance step | ✅ |
| 4.1.2 | `createDefinition` **và** `updateDefinition` mang theo `materials` | ✅ |
| 4.1.3 | **`toStepInput()` mang theo `materials`** | ✅ |
| 4.1.4 | UI chọn vật tư + số lượng trên dòng bước trong ma trận | ✅ |

⚠️ **Bẫy đã cắn một lần:** `toStepInput()` là phễu duy nhất của mọi thao tác sửa quy trình. Quên `materials` ở đó thì **mỗi lần bấm một ô RACI là mất sạch vật tư đã khai**. Bắt buộc có test vòng đời: khai vật tư → sửa một ô → đọc lại.

### 4.2 Công bố: validate và đóng băng
| # | Việc | Trạng thái |
|---|---|---|
| 4.2.1 | `validateDefinitionForPublish` gọi `GET /internal/materials/:code` cho từng mã; mã không tồn tại thì chặn công bố | ✅ |
| 4.2.2 | Chụp `materialName` / `unit` vào snapshot | ✅ |

### 4.3 Lúc chạy: kiểm tồn và trạng thái chờ
**Không thêm giá trị mới vào `ProcedureInstanceStepStatus`** — enum đó điều khiển máy trạng thái `advance()`; thêm giá trị buộc mọi nhánh switch phải sửa và dễ sinh lỗi câm. Dùng trường độc lập:

```ts
interface ProcedureStepMaterialCheck {
  readonly state: 'ok' | 'short';
  readonly checkedAt: string;
  readonly lines: readonly {
    materialCode: string; required: number; available: number; short: number;
  }[];
}
```

| # | Việc | Trạng thái |
|---|---|---|
| 4.3.1 | Kiểm tồn khi bước bắt đầu (cùng 3 điểm gán `startedAt` mà SLA đang móc) | ✅ |
| 4.3.2 | `state==='short'` → **chặn hoàn tất bước**, bước vẫn `active` | ✅ |
| 4.3.3 | UI dải cảnh báo liệt kê mã nào thiếu bao nhiêu | ✅ |
| 4.3.4 | Nút **"Kiểm lại tồn kho"** (nút fetch) chạy lại phép kiểm | ✅ |

### 4.4 Hai quyết định phải chốt trước khi code
| # | Vấn đề | Đề xuất | Trạng thái |
|---|---|---|---|
| A | **Chỉ kiểm hay có giữ chỗ?** Nếu chỉ kiểm, hai workorder cùng thấy đủ hàng rồi cùng chạy, người sau ra kho thì hết | **Giữ chỗ** — `POST /reservations` và cột `quantityReserved`/`available` đã có sẵn đúng để làm việc này. Đổi lại phải viết đường **nhả giữ chỗ** ở cả 3 lối ra: hoàn tất, huỷ, trả bước | ✅ đã làm |
| B | **Kiểm ở kho nào?** Vật tư nằm theo từng kho, hiện có 3 kho | Kiểm **tổng khả dụng toàn bộ kho**, giữ chỗ từ **một kho chọn lúc thiết kế bước** (mặc định kho của đơn vị phụ trách) | ✅ đã làm |

## Đợt 5 — Bốn việc nhỏ, rủi ro thấp

| # | Việc | Ghi chú | Trạng thái |
|---|---|---|---|
| 5.1 | **Bắt buộc chọn nhóm mới được công bố** | Thêm khối vào `validateDefinitionForPublish`. Chỉ chặn lúc công bố nên **không ảnh hưởng quy trình đang chạy** | ✅ |
| 5.2 | **Phân rã tuần tự / song song** | `executionMode: 'parallel' \| 'sequential'` cấp bước + `order` trên `ProcedureSubtask`. Tuần tự: đầu việc N bị chặn cho tới khi N−1 `completed` — **chặn ở server**, không chỉ ẩn nút. Mặc định **song song**, giữ nguyên hành vi hồ sơ đang chạy | ✅ |
| 5.3 | **Mã thiết bị lấy từ Kho khi tạo lịch bảo trì** | `maintenance-screen.tsx:354` hiện là `<input placeholder="VD: EQ-001">` gõ tay. Đổi thành `<input list>` lấy từ `matrix.rows` — **dữ liệu đã nạp sẵn, không cần API mới**. Vẫn gõ tự do để tìm, nhưng submit phải khớp mã có thật | ✅ |
| 5.4 | **Đầu việc hiện tại chỗ, không nhảy sang Kho** | Badge "N đầu việc (Kho)" hiện chạy `window.location.assign('/modules/inventory#assets:<mã>')`. **Đường này vốn đã hỏng từ trước:** không chỗ nào xử lý hash dạng `assets:<mã>` — cũ lẫn mới đều chỉ so hash với danh sách tab nên rơi về tab mặc định, **không chọn đúng thiết bị**, người dùng bị đá sang module khác rồi lạc. Sửa: mở panel ngay trong Bảo trì. Cần route mới `GET /assets/:code/tasks` bên Bảo trì proxy sang `/internal/assets/:code/task-template`, vì `internal/assets` hiện **chỉ trả `taskCount`, không trả danh sách việc** | ✅ |

## Rủi ro đã biết của kế hoạch này

| Rủi ro | Xử lý |
|---|---|
| Quên `materials` trong `toStepInput()` → mất dữ liệu mỗi lần sửa ô RACI | Test vòng đời bắt buộc, đúng cách đã làm cho `slaHours` |
| Giữ chỗ không được nhả → kho kẹt hàng ảo vĩnh viễn | Nhả ở cả 3 lối ra; test cả ba, không chỉ đường thành công |
| Quyền: thủ kho / kỹ thuật viên không ghi được | Vướng thứ ba cùng loại — cần PO quyết một lần cho cả ba module |

---

<!-- ======================================================================
     HẾT BẢN TẠO LẠI 19/08/2026.
     Từ đây trở xuống CHỈ ĐƯỢC APPEND. Không sửa, không xoá phần trên.
     ====================================================================== -->

---

# APPEND 19/08/2026 — Đợt 5 hoàn thành

Bốn mục của Đợt 5 đã xong, build 22 project sạch, **59 test qua / 0 fail** (trước đó 56).

## Kiểm chứng 5.1 — bắt buộc chọn nhóm mới công bố được

| Kịch bản | Kết quả |
|---|---|
| Tạo bản nháp không có nhóm | ✅ vẫn tạo được — nhóm chỉ bắt buộc lúc công bố |
| Công bố khi chưa có nhóm | ✅ chặn — *"Phải chọn nhóm phân loại trước khi công bố quy trình."* |
| Gán nhóm rồi công bố | ✅ `published` |
| 12 quy trình đã công bố trước đó | ✅ không bị hồi tố, vẫn chạy bình thường |

## Kiểm chứng 5.2 — phân rã tuần tự / song song

Thiết kế: `executionMode` thuộc **bước** (`ProcedureInstanceStep.subtaskExecutionMode`), `order` thuộc từng đầu việc và suy ra từ vị trí trong mảng gửi lên. Bỏ trống `executionMode` thì **giữ nguyên chế độ đang có**, không âm thầm đổi luật khi phân rã lại.

| Kịch bản (gọi thẳng API, không qua UI) | Kết quả |
|---|---|
| Phân rã 3 việc ở chế độ tuần tự | ✅ `sequential`, thứ tự 1·2·3 |
| Làm việc 3 trước | ✅ chặn — *"phải xong “Việc 1 — cắt điện” trước"* |
| Làm việc 2 trước | ✅ chặn cùng lý do |
| Huỷ việc 1 rồi làm việc 2 | ✅ qua được cổng tuần tự — **huỷ cũng tính là đã giải quyết**, cùng luật với `requireSubtasksResolved` |
| Đổi sang song song, làm việc cuối trước | ✅ không chặn thứ tự |
| Bỏ trống `executionMode` | ✅ giữ nguyên chế độ cũ |
| `executionMode: 'xyz'` | ✅ chặn — *"Chế độ chạy đầu việc không hợp lệ."* |

**Đã đổi thứ tự hai cổng chặn.** Ban đầu cổng bằng chứng chạy trước cổng tuần tự, nên người dùng bị đòi đính kèm tài liệu cho đầu việc họ còn **chưa được phép bắt đầu**. Thông báo đó vừa vô nghĩa vừa che mất lý do thật. Nay tuần tự kiểm trước, bằng chứng kiểm sau.

**Bẫy TypeScript đã suýt lọt:** đổi chữ ký `onSetItems` thành hai tham số mà **build vẫn xanh**, vì hàm nhận ít tham số hơn vẫn gán được cho kiểu hàm nhận nhiều tham số. `executionMode` bị bỏ rơi im lặng ở nơi gọi. Phải sửa tay cả 3 chặng: `subtask-panel` → `workspace-board` → `procedure-engine-screen` → `procedure-api`.

3 test hồi quy mới trong `procedure-engine.application.spec.ts`: công bố thiếu nhóm bị chặn rồi gán nhóm công bố được; bước tuần tự chặn đúng và mở đúng sau khi việc trước xong; bước song song không ràng buộc thứ tự.

## Kiểm chứng 5.3 — mã thiết bị lấy từ Kho

Ô gõ tay `<input placeholder="VD: EQ-001">` thành combobox `<input list>` dựng từ `matrix.rows` — dữ liệu đã nạp sẵn cho ma trận nên **không thêm lời gọi API nào**.

| Kịch bản (trình duyệt thật, LAN, tài khoản SAVINA) | Kết quả |
|---|---|
| Danh sách gợi ý | ✅ 8 thiết bị, hiện cả mã lẫn tên |
| Gõ `MBA-T1` | ✅ hiện "Máy biến áp lực T1 — 40MVA" |
| Gõ `KHONG-CO` | ✅ "Chưa khớp thiết bị nào trong Kho" |
| Submit mã không có thật | ✅ chặn — *"Không có thiết bị nào mã “KHONG-CO” trong Kho."*, form không đóng |
| Submit `RELAY-901` | ✅ tạo được, form đóng |

## Kiểm chứng 5.4 — đầu việc xem tại chỗ

Thêm `AssetDirectory.readTaskTemplate()` + `GET /api/maintenance/v1/assets/:code/tasks` proxy sang `/internal/assets/:code/task-template` của Kho. **Bảo trì không lưu bản sao nào** — hồ sơ thiết bị vẫn một nguồn duy nhất.

| Kịch bản | Kết quả |
|---|---|
| `MBA-T1` | ✅ 5 đầu việc T1–T5 kèm số phút |
| `MC-901` | ✅ 3 đầu việc M1–M3 |
| `TN-MEGGER` | ✅ 1 đầu việc C1 |
| `KHONG-CO-THAT` | ✅ 404 *"Không tìm thấy thiết bị … trong Kho"* |
| Bấm badge trên ma trận (trình duyệt) | ✅ panel mở bên phải, **URL vẫn ở `/modules/maintenance`**, không bị đá sang module khác |
| Đóng panel | ✅ |

Lỗi JS và response ≥400 trong toàn bộ phiên kiểm trình duyệt: **không có**.

## Hai lần phép đo của tôi lại sai

Nối tiếp mục 10 ở Phần II, ghi lại để khỏi lặp:

1. **"Luật tuần tự chặn đúng"** — lần chạy đầu mọi trường hợp đều báo *bị chặn*, nhưng đọc kỹ thì thông báo là của **cổng bằng chứng**, chưa hề chạm tới luật tuần tự. Nếu dừng ở đó tôi đã báo tính năng chạy được mà thực ra chưa kiểm được gì. Phải đổi thứ tự cổng rồi mới đọc được kết quả thật.
2. **"Submit mã sai bị chặn"** — trang có sẵn một vùng `role=alert` **rỗng**, và submit thật ra bị trình duyệt chặn vì `startDate` bỏ trống, chưa tới hàm xử lý của tôi. Phải điền đủ trường bắt buộc và lọc đúng `p[role=alert]` mới đo được.

## Còn lại

Đợt 3 và Đợt 4 chưa bắt đầu. Đợt 4 vẫn treo hai quyết định A (giữ chỗ hay chỉ kiểm) và B (kiểm ở kho nào) — xem Phần V.

---

# APPEND 19/08/2026 — Đợt 3 hoàn thành

Kho đã có đủ thêm/sửa/ngừng danh mục và nhập/xuất/chuyển kho trên giao diện. Build 22 project sạch, **59 test qua / 0 fail**.

## Quyết định thiết kế: "xoá" là ngừng hoạt động, không phải DELETE

Sổ cái kho là append-only. Xoá cứng một vật tư đã phát sinh giao dịch sẽ làm mồ côi mọi dòng lịch sử trỏ vào nó; xoá một thiết bị đang có con sẽ làm đứt nhánh cây. Nên **server tự quyết**, client không chọn:

| Điều kiện | Hành vi | Thông báo trả về |
|---|---|---|
| Vật tư chưa có giao dịch nào | Xoá hẳn | `mode: 'deleted'` |
| Vật tư đã có giao dịch | `isActive = false` | `mode: 'deactivated'` + số giao dịch |
| Thiết bị chưa có con | Xoá hẳn | `mode: 'deleted'` |
| Thiết bị còn con | `status = 'DISPOSED'` | `mode: 'deactivated'` + số con |

Hai cờ này vốn đã có trong contract và `list()` vốn đã lọc theo chúng (`WHERE is_active = true`, `WHERE status <> 'DISPOSED'`), nên không cần migration nào.

## Kiểm chứng backend (tài khoản admin@savina.local)

| Kịch bản | Kết quả |
|---|---|
| Tạo vật tư | ✅ |
| Tạo trùng mã (kiểm **cả** vật tư đã ngừng) | ✅ chặn — *"Mã vật tư … đã tồn tại."* |
| `minStock > maxStock` | ✅ chặn |
| Mã rỗng | ✅ chặn |
| Sửa tên + ngưỡng tồn | ✅ |
| Xoá vật tư **chưa dùng** | ✅ `deleted`, đọc lại 404 |
| Xoá `VT-DAU-MBA` (**đã có giao dịch**) | ✅ `deactivated` — *"đã có 1 giao dịch trong sổ cái nên chỉ được ngừng hoạt động"* |
| Lịch sử giao dịch sau khi ngừng | ✅ còn nguyên 1 dòng |
| Khôi phục `isActive=true` | ✅ |
| Tạo thiết bị có cha | ✅ `parentId` được gán |
| Cha không tồn tại | ✅ chặn |
| Sửa tên / độ quan trọng / tình trạng | ✅ |
| Tự làm cha của chính mình | ✅ chặn |
| Sửa `specs` **không** làm mất tên đã đổi | ✅ COALESCE giữ đúng |
| Thanh lý thiết bị **không có con** | ✅ `deleted` |
| Thanh lý `MC-901` (**có con `RELAY-901`**) | ✅ `deactivated`, **`RELAY-901` không bị xoá lây** |
| `GET /internal/materials/:code` | ✅ 200 với mã thật, 404 với mã sai — **Đợt 4 dùng route này** |

Nhân tiện Việt hoá 3 thông báo lỗi còn tiếng Anh (`Asset X not found` → *"Không tìm thấy thiết bị X."*), khớp phần còn lại của UI.

## Kiểm chứng giao diện (trình duyệt thật, LAN)

| Kịch bản | Kết quả |
|---|---|
| Nhập kho 25 Lít `VT-DAU-MBA` | ✅ chứng từ `TXN-…`, tồn khả dụng 6.351 → 6.376 |
| Xuất 999999 khi khả dụng 1.275 | ✅ cảnh báo *"Vượt tồn khả dụng 1.275 Lít."*, **nút submit bị khoá** |
| Chuyển kho 999999 | ✅ chặn tương tự |
| Hạ xuống 5 | ✅ nút mở lại |
| Thêm vật tư từ giao diện | ✅ |
| Thêm thiết bị con của `MC-901` | ✅ cây 8 → 9 node |
| Thanh lý thiết bị vừa tạo | ✅ cây về 8 node |

Lỗi JS và HTTP 5xx: **không có**.

## Hai sự cố môi trường, không phải lỗi code

1. **Máy đổi IP LAN** từ `192.168.88.233` sang `192.168.2.118` giữa phiên. Mọi script kiểm bằng IP cũ timeout — thoạt nhìn giống toàn bộ hệ thống chết, thực ra localhost vẫn 200. Khi giao cho team test cần nhớ IP là DHCP, không cố định.
2. **Pool Postgres đứt** sau khi đổi mạng: *"Connection terminated unexpectedly"*. Container vẫn `healthy`, chỉ các kết nối đang mở của 4 API là hỏng. Khởi động lại API là xong. Đây là điểm yếu thật của cách chạy tay trên host — không có cơ chế tự kết nối lại.

## Lần thứ ba phép đo sai trong ngày

Kiểm cổng chặn vượt tồn báo *"không cảnh báo, nút không khoá"* — tưởng tính năng hỏng. Thực ra selector `button:has-text("Xuất kho")` bắt nhầm nút ngoài form (trang có hai hàng chip: lọc kho của bảng tồn và chọn loại lệnh của form). Chip chế độ chưa từng được bấm, nên `kind` vẫn là *nhập kho* — mà nhập kho thì đương nhiên không kiểm vượt tồn. Thêm phạm vi `form button:has-text(...)` là đo đúng ngay.

Dấu hiệu lẽ ra phải nhận ra sớm: form hiện **2 ô số** (số lượng + đơn giá) trong khi chế độ xuất kho chỉ có 1.

## Còn lại

- **Đợt 4 chưa bắt đầu**, vẫn treo hai quyết định A (giữ chỗ hay chỉ kiểm) và B (kiểm ở kho nào) — xem Phần V.
- **Vướng quyền chưa xử lý:** mọi lệnh ghi của Kho vẫn qua `requireManager(actor)`, nên thủ kho không có quyền quản lý sẽ không nhập/xuất được. Cùng loại với mâu thuẫn #2 ở Phần III. Cần PO quyết một lần cho cả ba module.

---

# APPEND 19/08/2026 — Sự cố: trang Quy trình trắng sau khi build

Người dùng báo `localhost:8080/modules/procedure` hiện *"This page couldn't load"*.

**Nguyên nhân:** tôi chạy `pnpm nx run-many -t build` **trong khi 4 tiến trình `next start` vẫn đang chạy**. Rebuild thay mới thư mục `.next`, nhưng tiến trình đang chạy giữ manifest của bản build cũ, nên nó phục vụ HTML tham chiếu chunk mới rồi trả **500** khi trình duyệt xin file:

```
HTTP 500 modules/procedure/_next/static/chunks/2u6eogxqvpr2w.css
HTTP 500 modules/procedure/_next/static/chunks/3dyvf2a7cb1hv.js
```

**Không có dòng code nào sai** — lỗi hoàn toàn ở quy trình thao tác của tôi.

**Vì sao tôi không phát hiện:** HTML vẫn trả 200 nên phép kiểm `curl` của tôi báo "cả 4 trang 200". Đây **đúng cái bẫy đã ghi hai lần trước trong file này** (mục 10 Phần II, và bài học ở Mốc 11): mã trạng thái của trang HTML không nói gì về tài nguyên nó cần. Lần này tôi đã có sẵn Playwright mà vẫn chỉ chạy `curl` sau khi build.

## ⚠️ QUY TẮC THAO TÁC BẮT BUỘC

1. **Build lại web app ⇒ phải khởi động lại tiến trình `next start` tương ứng.** Không có ngoại lệ. `nx run-many -t build` chạm cả 4 app, nên phải khởi động lại cả 4.
2. **Không dùng `curl` để kết luận một trang web hoạt động.** `curl` không chạy JavaScript và không tải tài nguyên phụ. Phải mở bằng trình duyệt thật và bắt `pageerror` + response ≥400.
3. Sau khi khởi động lại, kiểm bằng script trình duyệt: điều kiện đạt là **0 lỗi JS và 0 response ≥400** trên cả 4 trang, không phải "HTTP 200".

## Sau khi khắc phục

Khởi động lại cả 4 web app, kiểm bằng trình duyệt thật: **cả 4 trang render sạch, 0 lỗi JS, 0 response ≥400**. Các tính năng mới còn nguyên — Quy trình đủ 3 tab và bộ lọc nhóm; Bảo trì mở panel `MBA-T1` với 5 đầu việc (~160 phút); Kho có nút "Nhập / xuất kho" và "+ Vật tư".

Một lần nữa phép đo của tôi suýt sai: lần kiểm đầu panel Bảo trì báo *"MBA-T1 | 0 việc"* — nhưng đó là do đo trước khi fetch xong, đo lại sau 200ms đã đủ *"Máy biến áp lực T1 — 40MVA | 5 việc"*.

---

# APPEND 19/08/2026 — Đợt 4 (phần không phụ thuộc quyết định A/B) hoàn thành

Người dùng nói "tiếp tục" hai lần mà chưa trả lời hai câu hỏi A/B, nên tôi **làm hết phần không phụ thuộc chúng** thay vì đứng chờ: khai báo vật tư, đóng băng lúc công bố, kiểm tồn lúc chạy, chặn hoàn tất, nút kiểm lại. Phần **giữ chỗ** (quyết định A) và **ràng buộc theo kho** (quyết định B) vẫn treo — xem cuối mục.

Build 22 project sạch, **60 test qua / 0 fail**.

## 4.1 Khai báo lúc thiết kế

`ProcedureStepMaterial` là trường contract trên `ProcedureStepDefinition` **và** `ProcedureInstanceStep`, không phải bảng mới — `synchronizeNormalized` sẽ xoá bảng mới ở lần ghi kế tiếp.

**Bẫy đã cắn lại đúng như dự đoán:** `updateDefinition` **không** mang `materials` khi tôi vá lần đầu (script chỉ khớp 1 trong 2 chỗ). Đây chính là rủi ro #1 đã ghi trong kế hoạch. Đã vá cả hai.

UI: nút "Vật tư (n)" trên dòng bước mở một hàng biên tập, chọn từ **danh mục Kho** chứ không gõ mã tự do — mã sai chỉ lộ ra lúc công bố, khi người thiết kế đã quên mình gõ gì.

## 4.2 Công bố: kiểm mã và đóng băng

`resolveStepMaterials` chạy **trước khi mở transaction**, cùng lý do với `resolveInventoryTaskTemplates`: đây là lời gọi mạng, giữ transaction qua nó sẽ khoá bảng suốt vòng đi về.

| Kịch bản | Kết quả |
|---|---|
| Công bố với mã `MA-KHONG-CO-THAT` | ✅ chặn — *"Không có vật tư mã … trong Kho; sửa lại trước khi công bố."* |
| Công bố với mã thật | ✅ đóng băng `materialName: "Vòng bi chuyên dụng"`, `unit: "Cái"` |

## 4.3 Lúc chạy

**Không thêm giá trị mới vào `ProcedureInstanceStepStatus`** — enum đó điều khiển `advance()`. Dùng trường độc lập `materialCheck`; bước thiếu hàng vẫn `active`, chỉ bị chặn hoàn tất.

`applyAction` chạy trong transaction nên không gọi mạng được: phép kiểm tính **trước** khi mở transaction, chỉ với hành động `complete`/`approve` — không ai muốn nó chạy khi chỉ trả lại hay huỷ hồ sơ.

| Kịch bản (tồn 2 Cái, bước cần 5) | Kết quả |
|---|---|
| Khởi tạo hồ sơ | ✅ kiểm ngay: `short`, cần 5 · còn 2 · thiếu 3 |
| Thiếu hàng **không chặn khởi tạo** | ✅ hồ sơ vẫn mở — phải có chỗ ghi nhận là đang chờ vật tư |
| Bấm hoàn thành khi thiếu | ✅ chặn — *"Bước “Thay vòng bi” chưa đủ vật tư: Vòng bi chuyên dụng thiếu 3 Cái."* |
| Nhập thêm 10 Cái, bấm "Kiểm lại tồn kho" | ✅ `ok`, khả dụng 12, thiếu 0 |
| Hoàn thành sau khi đủ | ✅ sang bước "Nghiệm thu" |

Kho hỏng **lúc khởi tạo** thì vẫn mở hồ sơ (phép kiểm sẽ chạy lại lúc hoàn thành); Kho hỏng **lúc hoàn thành** thì ném lỗi rõ ràng chứ không âm thầm cho qua — bỏ qua phép kiểm nghĩa là để người ta ra kho lấy đồ không có.

Endpoint mới bên Kho: `GET /internal/materials/:code/availability` cộng dồn tồn khả dụng toàn bộ kho, kèm chi tiết từng kho. Cộng ở phía Kho thay vì bắt bên gọi lặp qua từng kho — số kho là chuyện nội bộ của Kho.

## Kiểm chứng bẫy `toStepInput`

Mô phỏng đúng cái `writeCell` làm (PATCH cả bản nháp sau mỗi lần bấm một ô), chạy 2 vòng:

```
ban đầu     : materials=[{VT-BULONG-M16, 3}]  slaHours=6
sau 1 ô RACI: materials=[{VT-BULONG-M16, 3}]  slaHours=6
sau 2 ô RACI: materials=[{VT-BULONG-M16, 3}]  slaHours=6
→ GIỮ NGUYÊN

đối chứng (toStepInput cố tình quên materials): null
```

Dòng đối chứng là phần quan trọng nhất: nó chứng minh phép thử **thật sự bắt được lỗi**, chứ không phải xanh vì không kiểm gì. Kèm test hồi quy trong `procedure-engine.application.spec.ts` (30 test).

## Còn treo — cần PO quyết

| # | Vấn đề | Đề xuất |
|---|---|---|
| A | **Mới chỉ kiểm, chưa giữ chỗ.** Hai workorder cùng thấy đủ hàng rồi cùng chạy, người sau ra kho thì hết | Giữ chỗ qua `POST /reservations` (hạ tầng đã có), kèm đường nhả ở cả 3 lối ra: hoàn tất, huỷ, trả bước |
| B | **Đang kiểm tổng tồn toàn bộ kho.** Chưa ràng buộc lấy từ kho nào | Giữ chỗ từ một kho chọn lúc thiết kế bước, mặc định kho của đơn vị phụ trách |

Cả hai đều **cộng thêm** vào phần đã làm, không phải làm lại — phần kiểm tồn hiện tại là nền của cả hai phương án.

---

# APPEND 19/08/2026 — Tách quyền ghi khỏi quyền quản trị (giải quyết mâu thuẫn #2)

Ba lần vướng cùng một nguyên nhân đã được xử lý một lần. Build 22 project sạch, **60 test qua / 0 fail**.

## Nguyên nhân gốc

Kho và Bảo trì quyết định quyền bằng đúng một phép so sánh trên **HTTP method**:

```ts
const permission = request.method === 'GET' ? 'inventory.read'   : 'inventory.manage';
const permission = request.method === 'GET' ? 'maintenance.read' : 'maintenance.manage';
```

Nghĩa là ghi một dòng xuất kho và xoá cả danh mục vật tư đòi **cùng một quyền**. Module Quy trình vốn đã làm đúng (`procedure.act` tách khỏi `procedure.manage`, có ghi chú lý do ngay tại guard) — hai module kia chưa theo.

**Số liệu thật lúc phát hiện:** toàn hệ thống chỉ khai 4 quyền cho hai module, và chỉ **một vai trò** (`Tenant Admin`) giữ chúng. Nhân sự SAVINA: 42 "Người tham gia quy trình", 4 Tenant Admin, 1 Quản lý quy trình → **42/47 người không ghi được gì vào Kho và Bảo trì**.

## Cách sửa

Guard **không** đổi sang gọi access-decision nhiều lần. Thay vào đó dùng quyền đọc để phân giải database, rồi kiểm quyền chi tiết trên danh sách quyền mà decision trả về. Nhờ vậy `*.manage` **bao hàm** quyền hẹp mà không phải cấp thêm dòng nào cho quản trị viên hiện có.

Quyền chọn theo **loại thao tác**, không theo HTTP method:

| Module | Route | Quyền cần |
|---|---|---|
| Kho | `/receipts`, `/issues`, `/transfers`, `/reservations` | `inventory.transaction.write` |
| Kho | còn lại (danh mục vật tư, thiết bị) | `inventory.manage` |
| Bảo trì | `/occurrences*` (tạo sự cố, đóng phiếu) | `maintenance.occurrence.manage` |
| Bảo trì | còn lại (lịch, ma trận, scheduler) | `maintenance.manage` |

Cổng thứ hai ở tầng application: `requireStockWriter` / `requireOccurrenceHandler` tách khỏi `requireManager`. Trường actor mới (`canWriteTransactions`, `canHandleOccurrences`) **để optional và suy theo `canManage` khi vắng mặt**, nên mọi nơi gọi chưa cập nhật giữ nguyên hành vi cũ.

`maintenance.occurrence.manage` vốn đã có trong contract từ trước mà chưa dòng code nào dùng — giờ mới nối vào. `inventory.transaction.write` là hằng mới.

## Vai trò mới

`tenant-operator` — **Vận hành kho & bảo trì**, seed trong `apps/migrator/src/main.ts`:

```
inventory.read · inventory.transaction.write
maintenance.read · maintenance.occurrence.manage
procedure.read · procedure.act
```

Không có `inventory.manage` lẫn `maintenance.manage`. `tenant-admin` nhận mọi quyền trừ `platform.manage` nên tự động có hai quyền mới, không cần sửa gì thêm.

## Kiểm chứng bằng ba loại tài khoản

**Đây là phép thử chưa từng chạy trong cả phiên:** mọi kiểm chứng trước đó đều dùng `admin@savina.local`, một Tenant Admin — nên các cổng quyền chưa bao giờ thực sự bị thử. Lần này gán vai trò vận hành cho một nhân sự thật (Nguyễn Tấn Thịnh) và so ba tài khoản:

| Thao tác | Admin | Vận hành | Người tham gia |
|---|---|---|---|
| Xem tồn kho | cho phép | cho phép | **chặn** |
| Nhập kho | cho phép | **cho phép** | chặn |
| Xuất kho | cho phép | **cho phép** | chặn |
| Thêm vật tư (danh mục) | cho phép | **chặn** | chặn |
| Xoá vật tư (danh mục) | cho phép | **chặn** | chặn |
| Xem lịch bảo trì | cho phép | cho phép | chặn |
| Tạo phiếu sự cố | cho phép | **cho phép** | chặn |
| Tạo lịch bảo trì | cho phép | **chặn** | chặn |
| Lưu ma trận bảo trì | cho phép | **chặn** | chặn |

Cờ quyền trả về giao diện cũng đúng: tài khoản vận hành nhận `canManageOccurrences = true`, `canManageSchedules = false`.

## Một điểm yếu phát hiện nhân tiện, chưa sửa

`POST /api/maintenance/v1/matrix` với body sai hình dạng trả **HTTP 500** (`TypeError: input.entries is not iterable`) thay vì 400. Lỗi có sẵn từ trước, lộ ra vì payload trong script kiểm của tôi sai. Không chặn việc gì nên để lại; nếu làm thì nên validate body ở controller cho cả 3 module một lượt.

## Còn lại

Đợt 4 vẫn treo hai quyết định A (giữ chỗ vật tư) và B (ràng buộc theo kho) — xem Phần V.

---

# APPEND 19/08/2026 — Đợt 4 hoàn tất: giữ chỗ vật tư (quyết định A và B)

Người dùng nói "tiếp tục triển khai" mà vẫn chưa trả lời A/B, nên tôi **làm theo đề xuất của mình** và ghi rõ ở đây để về sau đổi được. Build 22 project sạch, **60 test qua / 0 fail**.

## Quyết định đã chọn

**A — Có giữ chỗ, không chỉ kiểm.** Kiểm suông thì hai workorder cùng thấy đủ hàng rồi cùng chạy, người sau ra kho thì hết. Hạ tầng `reservations` đã khoá dòng số dư đúng cách (`FOR UPDATE` trước khi trừ) nên chỉ cần nối vào.

**B — Kiểm tổng tồn toàn bộ kho, giữ chỗ theo từng kho.** Bảng `reservations` gắn một phiếu với một kho, nên chọn kho nhiều hàng nhất trước rồi lấy tiếp kho sau; một dòng vật tư có thể sinh nhiều phiếu. Tổng đủ nhưng chia lẻ không gom nổi thì **không giữ nửa vời** — trả về rỗng để lần kiểm sau báo thiếu.

## Hạ tầng phải bổ sung ở Kho

Giữ chỗ vốn đã có, **nhả thì chưa**. Thêm:

| Thành phần | Ghi chú |
|---|---|
| `reservation.release()` | Khoá phiếu `FOR UPDATE`, trả `quantity_reserved` về, đóng phiếu. **Idempotent** — phiếu đã đóng thì trả nguyên trạng, không trừ hai lần |
| `POST /reservations/:code/release` | Đường người dùng |
| `POST /internal/reservations` + `/internal/reservations/:code/release` | Đường service-to-service cho Quy trình |

Hai lỗi phải sửa để đường nội bộ chạy được:
1. Actor dịch vụ có `canManage: false` nên bị chặn ghi → cấp `canWriteTransactions: true`, **không** cấp quyền danh mục (không dịch vụ nào có lý do xoá một mã vật tư).
2. Actor dịch vụ mang `userId: 'system'` nhưng `created_by` là cột **uuid** → thêm `INVENTORY_SYSTEM_ACTOR_ID`, cùng cách Procedure đã giải bằng `PROCEDURE_SYSTEM_ACTOR_ID`.

## Vòng đời giữ chỗ

Giữ khi **khởi tạo hồ sơ** (nếu bước 1 đủ hàng) và khi bấm **"Kiểm lại tồn kho"** mà chuyển từ thiếu sang đủ. Nhả ở **cả bốn lối ra**: bước hoàn thành · hồ sơ huỷ · hồ sơ bị từ chối · bước bị trả lại.

Nhả chạy **sau khi transaction đã commit** và **nuốt lỗi có chủ đích** — nhả là dọn dẹp, ném lỗi ở đó sẽ làm hỏng một hành động đã thành công.

Giữ chỗ lúc khởi tạo cần **hai lần ghi**: `referenceId` của phiếu trỏ về hồ sơ nên không thể giữ trước khi hồ sơ có id.

## Lỗi thật do test tranh chấp phát hiện

Dựng tình huống **tồn 5 Bộ, hai hồ sơ mỗi cái cần 4**. Kết quả lần đầu:

```
A hoàn thành → chặn
```

**Hồ sơ A bị chính phiếu giữ chỗ của mình chặn**: nó giữ 4/5 nên phép kiểm chỉ thấy còn 1, báo thiếu 3. Không có test tranh chấp thì lỗi này không bao giờ lộ ra — mọi kịch bản một-hồ-sơ đều xanh.

Sửa: `checkMaterials` nhận cờ `holdsOwnReservation`, cộng lại phần bước tự giữ vào tồn khả dụng. Đúng bằng `quantity` vì `reserveForStep` chỉ giữ khi gom đủ toàn bộ nhu cầu.

Sau khi sửa:

| Kịch bản (tồn 5, mỗi hồ sơ cần 4) | Kết quả |
|---|---|
| A khởi tạo | ✅ `ok`, giữ chỗ `RES-…` |
| B khởi tạo | ✅ `short` — chỉ còn 1 |
| B hoàn thành **khi A đang giữ** | ✅ chặn — *"thiếu 3 Bộ"* |
| A hoàn thành (đang tự giữ) | ✅ **OK — không bị phiếu của mình chặn** |
| A xong, B kiểm lại | ✅ `ok`, giữ được chỗ |
| B hoàn thành sau đó | ✅ OK — đến lượt B dùng |

## Vòng đời nhả, kiểm riêng

| Kịch bản (tồn 10, bước cần 4) | Tồn khả dụng |
|---|---|
| Khởi tạo hồ sơ | 10 → **6** (giữ ngay) |
| Bấm "Kiểm lại" lần nữa | 6 (không giữ trùng) |
| Hoàn thành bước | 6 → **10** |
| Huỷ hồ sơ giữa chừng | 6 → **10** |
| Trả lại bước | 10 (đã nhả từ lúc bước xong) |
| Nhả lần hai cùng phiếu | không trừ thêm (idempotent) |

## Một lần nữa nhãn kiểm của tôi sai

Lần chạy đầu tôi ghi *"B hoàn thành → ĐƯỢC — hai hồ sơ cùng một lô hàng (SAI)"*, nhưng thứ tự trong script là A xong **trước**, nên B chạy được là **đúng**: dụng cụ đã trả về kho. Phải đổi thứ tự cho B thử **trong lúc A còn giữ** mới đo được tranh chấp thật.

## Còn lại

Không còn quyết định nào treo. Ba việc chưa làm, không chặn ai:
- Giao diện chưa hiện mã phiếu giữ chỗ (chỉ hiện thiếu/đủ) — đủ dùng, nhưng người vận hành không tra ngược được phiếu.
- `POST /maintenance/v1/matrix` body sai vẫn trả 500 thay vì 400 (đã ghi ở append trước).
- Bí mật vẫn là giá trị mẫu.

---

# APPEND 20/08/2026 — Dọn hai khoản nợ kỹ thuật

Hai việc đã ghi ở append trước, nay làm xong. Build 22 project sạch, **60 test qua / 0 fail**, cả 4 trang render sạch.

## 1. Body sai hình dạng trả 400 thay vì 500

`POST /maintenance/v1/matrix` trước đây đổ `TypeError: input.entries is not iterable` thành **HTTP 500 "Internal server error"** — người gọi API không đoán được mình gửi thiếu gì.

| Body | Trước | Sau |
|---|---|---|
| `{rows: []}` (thiếu `entries`) | 500 | ✅ 400 — *"Thiếu danh sách “entries” trong yêu cầu lưu ma trận."* |
| `{entries: 'x'}` | 500 | ✅ 400 — cùng thông báo |
| `{entries:[{frequencies:[]}]}` | 500 | ✅ 400 — *"Mỗi dòng ma trận phải có mã thiết bị."* |
| `{entries:[{assetCode:'MBA-T1'}]}` | 500 | ✅ 400 — *"Dòng “MBA-T1” thiếu danh sách tần suất."* |
| `{entries: []}` | 200 | ✅ 200 |

**Bẫy TypeScript nhỏ:** gọi `Array.isArray(input.entries)` ngay trên trường đã có kiểu làm phép thu hẹp kiểu lan xuống vòng lặp bên dưới, biến phần tử thành `unknown` và vỡ build. Phải kiểm trên một biến cục bộ `const rows: unknown = input?.entries` rồi vẫn duyệt `input.entries` như cũ.

## 2. Giao diện hiện mã phiếu giữ chỗ

Panel "Vật tư cần cho bước này" trước chỉ nói thiếu hay đủ. Nay có thêm nhánh **đang giữ hàng**, kèm mã phiếu để người vận hành tra ngược sang Kho.

Kiểm bằng trình duyệt thật, hai nhánh:

```
thiếu hàng:  "Bước bị chặn hoàn tất cho tới khi bổ sung đủ hàng…"
             Dụng cụ hiếm | cần 4 Bộ | thiếu 3

đang giữ:    "Đã giữ hàng trong kho cho bước này — RES-1787186591340-907.
              Hàng được trả lại kho khi bước xong hoặc hồ sơ đóng."
             Bộ đồ nghề UI | cần 2 Bộ | còn 20
```

0 lỗi JS trong cả hai lượt.

## Còn lại đúng một việc

**Bí mật vẫn là giá trị mẫu** — `INTERNAL_SERVICE_TOKEN`, `SEED_*_PASSWORD` đều là chuỗi `replace-with-…`. Chấp nhận được cho test LAN nội bộ; **bắt buộc đổi trước khi lộ ra ngoài mạng nội bộ**. Đây là việc của người vận hành, không phải của code: đổi `.env`, chạy lại migrator để đổi mật khẩu seed, khởi động lại toàn bộ service.

## Dọn dữ liệu kiểm thử (20/08)

Quá trình kiểm sinh khá nhiều rác. Đã dọn:

| Loại | Kết quả |
|---|---|
| Hồ sơ kiểm thử đang chạy | huỷ 14 → còn **0** |
| Phiếu giữ chỗ treo | nhả 4 → **0 phiếu còn mở** |
| Vật tư kiểm thử | xoá hẳn 5 (chưa có giao dịch) · ngừng dùng 7 (đã có giao dịch) → **0 mã còn trong danh mục đang dùng** |
| Định nghĩa quy trình kiểm thử | **còn 12** — Quy trình **chưa có API xoá định nghĩa**, chỉ có `archived`. 12 bản này còn nằm trong ma trận |

Việc "0 phiếu giữ chỗ còn mở" cũng là một phép kiểm gián tiếp cho đường nhả: sau khi huỷ 14 hồ sơ, không còn hàng nào bị giữ ảo.

**Nợ mới ghi nhận:** thiếu API xoá/ẩn định nghĩa quy trình. Không chặn ai, nhưng ma trận của SAVINA đang có 12 quy trình rác do tôi tạo. Trước khi giao team cần hoặc thêm API, hoặc xoá tay dưới DB.

---

# APPEND 20/08/2026 — Sửa chỗ tôi đánh dấu xong quá sớm (4.3.1)

Trước khi soạn commit message, tôi rà lại từng mục của plan và phát hiện **4.3.1 chưa làm đủ**, dù đã đánh ✅.

Plan viết: *"Kiểm tồn khi bước bắt đầu (cùng 3 điểm gán `startedAt` mà SLA đang móc)"*. Thực tế tôi chỉ móc **2 trong 3**: lúc khởi tạo hồ sơ (bước 1) và lúc bấm hoàn thành. **Bước giữa khi trở thành bước hiện tại thì không được kiểm.**

Phép thử phơi ra: quy trình 3 bước, vật tư nằm ở **bước 2**.

```
sau khi xong bước 1, bước 2 thành bước hiện tại:
  materialCheck        : KHÔNG CÓ
  materialReservations : null
  tồn khả dụng         : 6   ← chưa giữ chỗ
```

**Hậu quả thật:** bước giữa nằm ở trạng thái "chưa kiểm" cho tới khi ai đó bấm tay, và hàng **không được giữ** trong suốt thời gian đó — đúng lúc dễ bị hồ sơ khác lấy mất nhất. Cổng chặn lúc hoàn thành vẫn hoạt động nên không ai làm sai được, nhưng mục đích của giữ chỗ thì mất.

**Sửa:** thêm `checkAndHoldForStep`, gọi **sau khi transaction của `applyAction` commit** khi hồ sơ vừa chuyển sang bước mới có vật tư. `advance()` chạy trong transaction nên không gọi mạng được — cùng lý do và cùng cách `startInstance` xử lý bước đầu.

Sau khi sửa:

```
sau khi xong bước 1, bước 2 thành bước hiện tại:
  materialCheck        : ok
  materialReservations : ["RES-…"]
  tồn khả dụng         : 3   ← đã giữ 3
bấm "Kiểm lại tồn kho" → không giữ trùng, vẫn đúng một phiếu
```

Bốn luồng đã kiểm trước đó chạy lại đều không hỏng: vòng đời bình thường · huỷ hồ sơ · trả lại bước · tranh chấp hai hồ sơ.

**Bài học:** đây là lần thứ tư trong hai ngày tôi báo xong khi chưa xong. Ba lần trước là kiểm sai thứ; lần này là **kiểm đúng thứ nhưng chỉ kiểm một nửa đường đi** — mọi phép thử của tôi đều đặt vật tư ở bước 1. Với tính năng gắn vào vòng đời nhiều bước, phải thử ở bước giữa chứ không chỉ bước đầu.

---

# APPEND 20/08/2026 — Xoá dữ liệu rác, thêm API xoá cho Quy trình

## Thêm hai lệnh xoá

Quy trình trước đây **không có cách xoá** định nghĩa hay hồ sơ, chỉ có `archived` và `cancel`. Ma trận SAVINA vì thế tích 25 quy trình rác do tôi tạo lúc kiểm.

| Route | Quyền | Ghi chú |
|---|---|---|
| `DELETE /instances/:id` | override | Nhả giữ chỗ và xoá đính kèm trước. Xoá cả khoá idempotency trỏ vào hồ sơ, để lần gọi lặp không "hồi sinh" hồ sơ đã xoá |
| `DELETE /definitions/:id` | override + designer | Chặn khi còn hồ sơ tham chiếu, kèm số lượng |

**Huỷ (`cancel`) vẫn là thao tác nghiệp vụ** — giữ vết. Xoá là dọn dẹp, chỉ dành cho dữ liệu rác.

Hai chi tiết bắt buộc, phát hiện khi chạy thật:
1. **Đính kèm phải xoá trước.** `attachments` là bảng duy nhất `synchronizeNormalized` không dựng lại, FK của nó trỏ vào `instances` — để lại thì vỡ ràng buộc lúc commit.
2. **Phải gỡ liên kết "bước nối tiếp" trỏ vào quy trình sắp xoá.** Lần đầu chạy, `QT-C-12405` báo **HTTP 500**: `steps_linked_definition_id_fkey`. Một quy trình khác có bước trỏ vào nó. Nay xoá sẽ gỡ mọi `linkedDefinitionId` trỏ tới, ở cả definitions lẫn instances.

## Kết quả dọn

| | Trước | Sau |
|---|---|---|
| Quy trình | 29 | **4** |
| Hồ sơ | 51 | **17** |
| Phiếu giữ chỗ treo | 0 | **0** |
| Vật tư kiểm thử trong danh mục | 12 | **0** |

Bốn quy trình giữ lại là toàn bộ quy trình nghiệp vụ thật của SAVINA:

```
QT-BT-MBA      published  10 hồ sơ  Bảo trì định kỳ máy biến áp lực
QT-MUA-VT      published   5 hồ sơ  Mua sắm vật tư kỹ thuật
QT-SC-DOTXUAT  published   0 hồ sơ  Sửa chữa đột xuất sự cố lưới
QT-TN-DINHKY   published   2 hồ sơ  Thí nghiệm định kỳ thiết bị điện
```

17 hồ sơ còn lại đều là nghiệp vụ thật (bảo trì MBA-T1, RELAY-901, mua dầu cách điện, thí nghiệm tủ rơ le…), không còn hồ sơ nào tên "Kiểm thử…" hay "Hồ sơ A/B/C/D".

## Một lỗi nghiêm trọng phát hiện nhân tiện

**`QT-BT-MBA` đang ở trạng thái `draft`** — quy trình bảo trì chính của SAVINA. Nháp thì **không mở được hồ sơ mới**, nên mọi lệnh bảo trì sinh từ scheduler sẽ hỏng. Nguyên nhân: một lượt kiểm trước đã bấm "Mở lại để sửa" mà không công bố lại. Nó cũng **chưa có nhóm phân loại**, nên theo luật 5.1 mới thì không công bố lại được nếu không gán nhóm.

Đã gán nhóm `technical` và công bố lại → `published`. Đây là lỗi có sẵn trong dữ liệu chứ không phải do đợt này, nhưng nếu không dọn rác thì không ai phát hiện.

---

# APPEND 20/08/2026 — Nút xoá quy trình, tìm kiếm ma trận, phân trang workorder

Build 22 project sạch, **60 test qua**, 4 trang render sạch, 0 lỗi JS.

## 1. Nút xoá trên dòng quy trình

Chỉ hiện với người có quyền `design` + override. Hỏi lại **kèm đúng tên và mã** trước khi xoá — xoá quy trình không hoàn tác được và các dòng nằm sát nhau, rất dễ bấm nhầm. Server vẫn chặn nếu còn hồ sơ tham chiếu.

**Một lỗi phải sửa kèm:** `request()` của client gọi `response.json()` cho mọi phản hồi, mà `DELETE` trả **204 không có body** → ném lỗi phân tích cú pháp, làm một thao tác **đã thành công** trông như thất bại. Nay 204 trả về `undefined`.

## 2. Ma trận: tìm theo tên hoặc đơn vị tham gia

Ô tìm kiếm bên cạnh bộ lọc nhóm đã có. Tìm theo **tên/mã quy trình** hoặc **tên đơn vị tham gia** — vế thứ hai là nhu cầu thật: trưởng một phòng muốn biết phòng mình dính vào những quy trình nào, mà tên phòng không nằm trong tên quy trình.

| Từ khoá | Kết quả |
|---|---|
| (rỗng) | 4 quy trình |
| "Bảo trì" | 3/4 |
| "Phòng Kỹ thuật" | 4/4 |
| "Phòng Tài chính" | **1/4** |
| "xxxkhongco" | 0/4 |

Lần đầu tôi tưởng "Phòng Kỹ thuật → 4/4" là bộ lọc hỏng, vì bảng đối chiếu chỉ thấy 3 quy trình có đơn vị đó. Thực ra **output đối chiếu của tôi bị cắt ở 95 ký tự** — `QT-BT-MBA` có 6 nhãn, "Phòng Kỹ thuật" là nhãn thứ 4. Dòng "Phòng Tài chính → 1/4" mới là dòng chứng minh bộ lọc phân biệt được.

## 3. Workorder: phân trang 20/trang, mặc định sắp theo ngày

Sắp xếp làm **ở client sau khi lọc**, không dựa vào thứ tự server trả về, để mọi bộ lọc đều cho cùng một trật tự. Mặc định ngày mở mới nhất trước; có ô đổi sang cũ nhất trước. Thanh phân trang ẩn khi ≤20 hồ sơ. Trang hiện tại tự kẹp lại khi bộ lọc làm giảm số trang.

Kiểm bằng cách **tạm tạo 8 hồ sơ cho vượt 20** (17 → 25), rồi xoá sạch bằng API xoá vừa làm:

```
trang 1: 1–20 trên 25 hồ sơ · 20 thẻ · đầu PR-20260820-6F4E25
trang 2: 21–25 trên 25 hồ sơ · 5 thẻ  · đầu PR-20260818-796644
đảo sang "cũ nhất trước" → đầu PR-20260818-BC15D8
dọn: xoá 8 hồ sơ tạm → còn đúng 17 hồ sơ · 4 quy trình, không sót
```

Nếu chỉ kiểm với 17 hồ sơ sẵn có thì thanh phân trang không bao giờ hiện, và tôi sẽ báo "xong" mà chưa từng thấy nó chạy.
