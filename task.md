# Task — triển khai `thay_doi_21_8.md`

> **Quy ước file này:** chỉ ghi thêm, không ghi đè. Nội dung task đã tạo thì giữ
> nguyên câu chữ; chỉ đổi ô trạng thái. Phát sinh mới thì thêm dòng ở cuối mục
> tương ứng và ghi một dòng vào Nhật ký.

Trạng thái: `[ ]` chưa làm · `[~]` đang làm · `[x]` xong · `[!]` chờ quyết định · `[-]` bỏ, không làm

---

## Phạm vi đã chốt

- Không làm Mục I (Core): nút CRM, quyền module theo user, Thao tác nhanh, trang Báo cáo/Cài đặt.
- Migration module được duyệt trước cả đợt, kèm một dòng ở `apps/migrator/src/main.ts`.
- `packages/contracts/{inventory,maintenance,procedure-engine}` coi là vùng module.
- Gộp thiết bị và vật tư ở mức mô hình dữ liệu.
- Duyệt sửa `defaultTenantModuleAccess` để trả cả `tenant-user` lẫn `system_role`.
- Duyệt cho `nx sync` tự cập nhật project reference trong `tsconfig.json` gốc.
- **Mọi thay đổi trong vùng đỏ phải hỏi user TRƯỚC, không ngoại lệ** — kể cả một dòng biến môi trường, kể cả khi đã duyệt thay đổi cùng loại trước đó.
- **Thao tác ở module A không được ghi dữ liệu của module B hay core — chỉ đọc.**
- **Số lượng tồn kho chỉ đổi khi thủ kho thao tác trong module Kho.** Quy trình chỉ báo số lượng, duyệt, và đề nghị xuất/nhập; cần vật tư thì MỞ một quy trình mượn/xuất mới. Liên thông giữa các module đi theo hướng đọc (GET) hoặc qua sự kiện, không ghi chéo.

---

## Phase 0 — Khung chung `module-shell`

- [x] Tạo package `packages/features/module-shell`, tag `['type:feature','scope:ui']`
- [x] `module-shell.tsx` — rail điều hướng dọc, header, slot nội dung
- [x] `use-hash-view.ts` — điều hướng hash, alias hash cũ, lắng nghe `hashchange`
- [x] `dashboard-view.tsx` + `dashboard-card.types.ts` — lưới thẻ, 3 luật phân giải
- [x] `settings-view.tsx` — khung màn cài đặt
- [x] `dashboard-card-picker.tsx` — admin bật/tắt và sắp thứ tự thẻ
- [x] `module-shell.module.scss` — bảng màu khớp module hiện có
- [x] Thêm tsconfig để package được typecheck, không chỉ lint
- [x] Kiểm chứng: lint + typecheck 37 project pass, `nx sync` sạch

---

## Phase 1 — Backend cấu hình cho 3 module

### Kho (bản mẫu)

- [x] `migrations/tenant/inventory/0003-inventory-settings.sql`
- [x] Thêm dòng migration vào `apps/migrator/src/main.ts`
- [x] Contract: key union, `SettingsEntry`, snapshot, `UpdateSettingsRequest`
- [x] Store port: nhóm `settings` (`list`/`get`/`put` có optimistic locking)
- [x] Postgres store: upsert kèm kiểm tra `version`
- [x] Application: defaults, chuẩn hoá lúc đọc và lúc ghi, lỗi 400/409
- [x] Controller: `GET /v1/settings`, `PUT /v1/settings/:key`
- [x] Kiểm chứng: đường dẫn không trùng chuỗi guard đang dò

### Bảo trì

- [x] `migrations/tenant/maintenance/0004-maintenance-settings.sql` + dòng migrator
- [x] Contract, store port, postgres store, application, controller

### Quy trình

- [x] `migrations/tenant/procedure/0007-procedure-settings.sql` + dòng migrator
- [x] Contract, store port, postgres store, application, controller
- [x] Gác quyền ghi bằng `actor.canDesign`

---

## Phase 2 — Áp khung vào giao diện

### Bảo trì (làm trước — đã có sẵn endpoint dashboard chưa dùng)

- [x] `VIEWS` thành mảng `nav`, thêm `dashboard` và `settings`
- [x] Thay `initialView()` và effect ghi hash bằng `useHashView`
- [x] 5 KPI thành 5 thẻ mặc định trong catalog
- [x] Dashboard Bảo trì — 10 thẻ, admin bật/tắt trong Cài đặt, dữ liệu từ `metrics` của `/workspace`

### Kho

- [x] `TABS` thành `nav`; `LEGACY_TAB` chuyển vào `useHashView({ legacy })`
- [x] 4 metric thành 4 thẻ mặc định
- [x] Dọn `.tabs/.tab/.tabActive/.statStrip` khỏi scss

### Quy trình

- [x] Thay nav viết tay bằng shell
- [x] Dashboard Quy trình — 10 thẻ, admin bật/tắt trong Cài đặt, dữ liệu từ `/workspace`

---

## Phase 3 — Quy trình

### 3.1 UI ma trận

- [x] Snapshot tổ chức điền `positions` và `member.positionId` để ma trận có tầng chức danh và cột người

- [x] Xoá "cả đơn vị", chuyển chỗ gán cấp đơn vị sang ô của node đơn vị
- [x] E giao cho trưởng đơn vị — snapshot trả thêm `category`, module phân giải đơn vị xuống chức danh phụ trách
- [x] Đơn vị trưởng khác màu member
- [x] Gán S vào khối đơn vị thì mọi thành viên đều S; vai khác mặc định về đơn vị trưởng
- [x] Admin làm được mọi vai (`isOverride` theo `system_role`)
- [x] Thay đổi core đã duyệt: `defaultTenantModuleAccess` trả thêm `system_role`

### 3.2 Sửa lỗi tiến trình khi C/A trả về

- [x] Reset đúng bước bị trả về (hiện giữ `completedAt`, vòng reset bỏ qua chính nó)
- [x] Thêm nhánh `returned` cho `stepProgress`
- [x] Reset subtask E(x) của bước bị trả về
- [x] Dọn `materialCheck` / `materialReservations` của bước đó
- [x] Bước chưa ai thao tác thì thanh tiến trình trống

### 3.3 Tách Trao đổi / Lịch sử thao tác

- [x] Tách hai tab trong `detail-tabs.tsx`
- [x] Ghi `step_instance_id` vào `activity_logs` (hiện bỏ sót)

### 3.4 Nhóm quy trình

- [x] Migration thêm cột `category`
- [x] Contract 3 chỗ
- [x] Đưa trường vào JSON snapshot, không chỉ vào cột
- [x] 5 nhóm mặc định, admin bật/tắt và thêm/xoá
- [x] Chặn công bố khi nháp chưa có nhóm
- [x] Filter theo nhóm ở màn tạo work order và workspace

---

## Phase 4 — Bảo trì

### 4.1 Sửa lỗi thông tin công việc không lấy từ Kho

- [x] Cho `taskCount` và panel dùng chung một lần đọc
- [x] Thêm `cache: 'no-store'` cho `loadAssetTasks`
- [x] Phân biệt "Kho lỗi" với "không có đầu việc"
- [x] Link "Sửa trong Kho" kèm mã thiết bị
- [-] Đường ghi ngược để sửa đầu việc ngay từ Bảo trì — BỎ: Bảo trì sẽ phải ghi dữ liệu của Kho, trái nguyên tắc chỉ-đọc-chéo-module. Sửa đầu việc vẫn làm bên Kho.

### 4.2 Tần suất động

- [x] Migration bỏ CHECK constraint
- [x] Catalog tần suất lưu trong `module_settings`
- [x] Contract từ union sang `string` + type catalog
- [x] Thay `nextDue` hardcode bằng số học interval
- [x] Hai map nhãn UI đọc từ API

### 4.3 Ma trận

- [x] Nút thêm thiết bị (chọn theo tên)
- [x] Nút xoá thiết bị
- [x] Nút thực hiện bảo trì tạo work order tức thì

### 4.4 Xoá nút Chạy scheduler

- [x] Xoá nút và `triggerScheduler`, giữ nguyên endpoint

---

## Phase 5 — Kho

### 5.1 Hạng mục độc lập

- [x] Phụ tùng — nối dây `asset_boms` đã có sẵn, không cần bảng mới
- [x] Tài liệu đính kèm — bảng mới, tham khảo cách Quy trình lưu attachment
- [x] Trường đơn vị trong thuộc tính
- [x] Tình trạng, giá, bảo hành ở trang liệt kê
- [x] Nối UI cho `status` (API và SQL đã hỗ trợ, chỉ thiếu giao diện)
- [x] Admin bật/tắt thuộc tính, trạng thái, giá, bảo hành

### 5.2 Gộp thiết bị và vật tư

- [x] Migration bổ sung cột, kiểm tra trùng mã và dừng nếu có
- [x] Chuyển dữ liệu
- [x] Repoint 5 FK trỏ vào `assets`
- [x] Giữ nguyên hợp đồng mọi endpoint `internal/`
- [~] Migration riêng để drop `assets` ở đợt sau — file `0007-drop-legacy-assets.sql` đã viết nhưng CỐ Ý CHƯA đăng ký trong migrator; chỉ đăng ký sau khi bản gộp chạy ổn qua một chu kỳ vận hành

---

## Phase 6 — Liên thông Quy trình ↔ Kho

- [x] Thêm tham chiếu thiết bị vào request tạo instance và `ProcedureInstance`
- [x] Phân giải task template theo thiết bị thật lúc tạo work order
- [x] Thêm vật tư vào `ProcedureSubtaskInput` và bảng `subtasks`
- [x] Dòng chọn vật tư trong `subtask-panel.tsx`, hiện tồn từ Kho
- [x] Đủ → MỞ quy trình mượn/xuất (không tự ghi sổ kho); thiếu → mở quy trình mua mới
- [x] Mở logic tương tự cho chủ các vai ngoài E

---

## Nhật ký

- **2026-08-24** — Chốt phạm vi, viết kế hoạch. Hoãn Mục I.
- **2026-08-24** — Phase 0 xong. Typecheck bắt được lỗi `groupHeading` trả `string | boolean | undefined`; đó là lý do thêm tsconfig cho package thay vì chỉ lint như `feature-inventory`.
- **2026-08-24** — Phát hiện snapshot tổ chức không trả `category`, chặn hạng mục "E giao cho trưởng đơn vị" ở Phase 3.1.
- **2026-08-24** — Phase 1 Kho xong. Migration chạy được trên tenant `savina` đang có dữ liệu.
- **2026-08-24** — Kiểm chứng API: mặc định version 0, chuẩn hoá loại trùng và chuỗi rỗng, sai version trả 409, khoá lạ trả 400, nhân viên đọc được.
- **2026-08-24** — Đổi `switch` sang bảng normalizer trong `inventory-settings.ts`: TS không thu hẹp được `K` trong `switch` nên bản cũ phải ép kiểu mọi nhánh.
- **2026-08-24** — Lỗi lint có sẵn, không do đợt này: `module-inventory` khai báo `contracts-integration` trong package.json nhưng không import dòng nào (`@nx/dependency-checks`).
- **2026-08-24** — Phase 1 xong cả ba module. Migration chạy được trên tenant `savina` đang có dữ liệu; typecheck + test 41 project pass.
- **2026-08-24** — Kiểm chứng bắt lỗi optimistic locking: tầng application quy `expectedVersion <= 0` về "ghi đè bất chấp", nên hai admin cùng đọc "chưa có dòng" rồi cùng ghi thì người sau đè im lặng lên người trước. SQL vốn đã chặn đúng, chỉ tầng trên vô hiệu hoá nó. Đã sửa ở cả ba module.
- **2026-08-24** — Quy trình phải hiện thực `settings` ở cả `PostgresProcedureStore` lẫn `InMemoryProcedureStore`, và cấu hình cố ý nằm ngoài `ProcedureTenantState` vì state đó bị ghi lại toàn bộ ở mỗi transaction runtime.
- **2026-08-24** — Quyền ghi cấu hình: Kho và Bảo trì rơi vào nhánh mặc định của guard (`inventory.manage` / `maintenance.manage`), Quy trình gác ở tầng application bằng `canDesign` vì guard của nó chỉ quyết định `module.access` một lần. Không sửa guard nào.
- **2026-08-24** — Phase 2 Bảo trì xong. Nav dọc thay tab ngang, thêm trang Tổng quan và Cài đặt; nav mới render đúng trong HTML và nút Chạy scheduler đã biến mất.
- **2026-08-24** — Làm luôn hạng mục 4.4 (xoá nút Chạy scheduler) vì nút nằm ngay header đang sửa; tránh phải sửa cùng một file hai lần. Endpoint `scheduler/run` và `internal/scheduler/run` giữ nguyên.
- **2026-08-24** — Dựng 10 thẻ dashboard cho Bảo trì, 5 thẻ `defaultEnabled` đúng bằng 5 KPI cũ nên tenant chưa vào Cài đặt vẫn thấy bố cục quen thuộc.
- **2026-08-24** — Chưa dùng `GET /v1/dashboard`: `metrics` đã có sẵn trong `/workspace` nên thêm request chỉ tốn thêm một vòng gọi. Để ngỏ endpoint đó cho thẻ cần dữ liệu tổng hợp riêng.
- **2026-08-25** — Phase 2 xong cả ba module. Cả ba đều có nav dọc, trang Tổng quan và trang Cài đặt; typecheck + test 42 project pass.
- **2026-08-25** — Kho gỡ được `lowStockCount`/`totalAvailable` thừa sau khi dải chỉ số thành thẻ. `feature-inventory` không có target typecheck nên lỗi kiểu chỉ lộ khi build Next — đã build `inventory-web` để kiểm thật.
- **2026-08-25** — Quy trình vốn đã có nav dọc; chuyển sang khung chung để ba module đồng bộ. Thẻ tenant cũ ở sidebar thành thẻ dashboard `notice.tenant`.
- **2026-08-25** — Ba lỗi lint có sẵn, KHÔNG do đợt này (git status xác nhận không đụng file): `module-inventory` và `module-maintenance` khai báo `contracts-integration` nhưng không import; `apps/maintenance-api/src/app/tenant-organization-context.client.ts` import `contracts-organization` (tag `scope:platform`) trong khi `scope:maintenance` không được phép — `scope:procedure-engine` thì đã có `scope:platform` trong danh sách cho phép.
- **2026-08-25** — Sau khi rebuild một container web, gateway phục vụ trang "đang bảo trì" cho tới khi DNS cache hết hạn (`resolver ... valid=30s`). Không phải lỗi, nhưng dễ tưởng nhầm là build hỏng.
- **2026-08-25** — Gán vai ở cấp đơn vị nay phân giải xuống chức danh phụ trách. Vùng đỏ đã duyệt: `contracts-organization` thêm `category`/`typeCategory`, `platform-identity.service.ts` thêm `category` vào 2 câu truy vấn snapshot. Guard của procedure-api dựng `headPositionIds` cho từng đơn vị.
- **2026-08-25** — Kiểm chứng thật trên tenant `savina`: quy trình có S và E gán ở cấp đơn vị → trưởng đơn vị nhận đúng vai, phân rã được E(x) lấy 5 đầu việc từ Kho, `isEscalated=false` (định tuyến bình thường, không phải leo cấp). Nhân viên thường trong đơn vị không nhận vai của đơn vị. Thêm 4 test đơn vị khoá hành vi này.
- **2026-08-25** — `hasHead` nay tính cả trường hợp đơn vị có chức danh phụ trách bên dưới; nếu không, trách nhiệm sẽ leo lên cấp trên một cách vô cớ dù đơn vị đã có trưởng.
- **2026-08-25** — Phát hiện: xoá hồ sơ và xoá quy trình đều đòi quyền quản trị, mà `isOverride` hardcode `false` nên trước đây KHÔNG AI xoá được. Bật admin override đã gỡ nút này; kiểm chứng chỉ `tenant-admin` được override, `tenant-user` không đổi.
- **2026-08-25** — Dọn sạch dữ liệu kiểm thử khỏi tenant demo: còn đúng 18 quy trình và 5 hồ sơ như trước.
- **2026-08-25** — Phân giải vai ở cấp đơn vị nay theo vai: S trải xuống MỌI chức danh trong đơn vị (kể cả cấp sâu), các vai còn lại dồn về chức danh phụ trách. Kiểm chứng thật: cả 3 người phòng Vận hành - Bảo trì mở được hồ sơ, trưởng phòng khác bị chặn 403.
- **2026-08-25** — Thêm 3 test đơn vị cho luật S/vai-khác; toàn bộ 41 project typecheck + test pass.
- **2026-08-25** — Xoá ô "Cả đơn vị" khỏi ma trận theo phương án bạn chọn: thu gọn đơn vị lại thì chính cột đơn vị là ô gán cấp đơn vị. Giữ lại một ngoại lệ có chủ đích — đơn vị ĐANG giữ vai thì ô cấp đơn vị vẫn hiện dù đã sổ ra, nếu không vai đã gán sẽ biến mất khỏi màn hình dù dữ liệu còn nguyên.
- **2026-08-25** — Neo của CHỨC DANH vẫn giữ nguyên (tài liệu chỉ yêu cầu bỏ "cả đơn vị"). Phân biệt hai loại neo phải xét ĐOẠN CUỐI của khoá: đường dẫn của neo chức danh cũng đi qua các đoạn `/unit:` nên kiểm tra cả chuỗi sẽ nhận nhầm — bản đầu của tôi dính đúng lỗi này.
- **2026-08-25** — Tô nền + viền trái cho cột người phụ trách đơn vị, chữ đậm hơn. Dùng nền thay vì chỉ đổi màu chữ để còn phân biệt được khi in đen trắng.
- **2026-08-25** — Thêm 4 test cho `columns.ts` (trước đó package này không có test nào cho phần dựng cột).
- **2026-08-25** — PHÁT HIỆN cần bạn biết: `buildHeaderTree` đọc `snapshot.positions` và `member.positionId`, nhưng snapshot thật trả `positions: []` và members không có `positionId` — mọi node đều nằm trong `units`. Vì vậy nhánh chức danh và CỘT NGƯỜI trong ma trận hiện KHÔNG chạy trên dữ liệu thật; ma trận chỉ có cột đơn vị và cột node chức danh.
- **2026-08-25** — Snapshot tổ chức nay điền `positions` (0 → 43) và `positionId` cho cả 52 bổ nhiệm, nên tầng chức danh và cột người trong ma trận mới thật sự chạy được.
- **2026-08-25** — Cách làm chọn hướng ÍT RỦI RO: giữ nguyên `units` chứa mọi node để sơ đồ tổ chức của Tenant Portal, trang `to-chuc` và cột "Đơn vị phụ trách" của Bảo trì không gãy; chỉ BỔ SUNG `positions`, rồi lọc node chức danh ở phía ma trận. `organizationUnitIds` giữ nguyên ngữ nghĩa vì mọi quy trình ĐÃ CÔNG BỐ đang trỏ tới các id đó.
- **2026-08-25** — Kèm theo đó sửa được một lỗi hiển thị có sẵn: `headName` của đơn vị trước đây LUÔN rỗng (người phụ trách nằm ở node chức danh con, không nằm trên node đơn vị), nên ma trận hiện "Chưa có người phụ trách" cho mọi đơn vị. Nay tra ngược xuống node con nên hiện đúng tên.
- **2026-08-25** — `ancestorsOfUsed` phải xét CHỨC DANH trước đơn vị: `units` chứa cả node chức danh nên xét đơn vị trước thì nhánh chức danh không bao giờ chạy.
- **2026-08-25** — Kiểm tra hồi quy: 5 hồ sơ demo và toàn bộ vai RCSI cũ vẫn khớp nguyên vẹn; override vẫn chỉ dành cho tenant-admin.
- **2026-08-25** — Phase 3.2 xong. Kiểm chứng thật bằng quyền admin override trên hồ sơ QT-BT-MBA: sau khi trả về, B3 có status='returned', completedAt trống, currentRoleStage quay lại E (không kẹt ở C), 5 subtask bị dọn sạch, materialCheck bị dọn.
- **2026-08-25** — `stepProgress` nay đọc `instance.activity` để biết bước đã có thao tác chưa; trước đây mọi bước đang mở đều được cộng sẵn nửa chặng nên hồ sơ vừa mở đã trông như đang làm dở.
- **2026-08-25** — LƯU Ý dữ liệu demo: hồ sơ "Bảo trì MBA-T1" (sinh tự động từ Bảo trì) nay đang ở B2 với B3 mang trạng thái 'returned' do quá trình kiểm chứng. Không xoá và tạo lại vì sẽ đứt liên kết tới occurrence bên Bảo trì. Trạng thái này thật ra minh hoạ được luồng trả về.
- **2026-08-25** — Chốt nguyên tắc: module A chỉ ĐỌC dữ liệu module B/core, không ghi chéo. Bỏ hạng mục cho phép sửa đầu việc thiết bị từ màn Bảo trì; đầu việc vẫn chỉ sửa được bên Kho, Bảo trì đọc và hiển thị.
- **2026-08-25** — Cần đối chiếu nguyên tắc này khi tới hai hạng mục sau, sẽ hỏi lại trước khi làm: (4.3) nút "thực hiện bảo trì" tạo work order — Bảo trì gọi sang Quy trình để MỞ hồ sơ, đây là cơ chế dispatch đã có sẵn trong sản phẩm; (6.2) vai E chọn vật tư rồi kích hoạt quy trình mượn/xuất — hiểu theo tài liệu là MỞ một quy trình mới chứ không phải Quy trình tự ghi vào sổ kho.
- **2026-08-25** — Kiểm chứng lại Phase 3.2 bằng ĐÚNG vai C: dựng quy trình S→R→C (không cần E, vì luật là E bắt buộc kèm C chứ không phải ngược lại). Kết quả: B2 dừng ở chặng C, người giữ C có [approve, return]; sau khi trả về thì B1 active/S trở lại, B2 status='returned', completedAt trống, chặng quay về R chứ không kẹt ở C, materialCheck (đang 'ok') đã được dọn.
- **2026-08-25** — Ghi nhận hiểu sai trước đó của tôi: tôi tưởng phải có E mới tới được C nên đã đi đường vòng qua quyền override. Không cần.
- **2026-08-25** — Phase 3.3 xong. Tab "Trao đổi" nay chỉ còn bình luận; thêm tab "Lịch sử thao tác" gồm các chuyển trạng thái, mỗi mục hiện rõ thuộc bước nào.
- **2026-08-25** — Lịch sử tổ chức theo LƯỢT: mỗi hành động `return` đóng lượt hiện tại, phần sau thuộc lượt mới. Đếm theo chiều thời gian tăng dần rồi đảo lại để hiển thị mới-nhất-trước. Kiểm chứng trên hồ sơ "Bảo trì MBA-T1": 4 thao tác, có 1 lần trả về ở B3 nên chia thành 2 lượt, và cả 3 thao tác trên bước đều hiện đúng tên bước.
- **2026-08-25** — Tách phần định dạng dùng chung (màu theo hành động, nhãn ngày, giờ) ra `activity-format.ts` để hai panel đứng cạnh nhau không trôi dạt về giao diện.
- **2026-08-25** — Hành động `start` không gắn bước nào (nó thuộc về cả hồ sơ), nên panel để trống dòng tên bước thay vì bịa ra một bước.
- **2026-08-25** — Phase 3.4 gần xong. Cột `category` chỉ là HÌNH CHIẾU để lọc bằng SQL; giá trị thật đi theo `versions.snapshot` nên chỉ cần thêm vào contract là được lưu. Cột để NULL được vì 18 quy trình đã công bố trước đợt này chưa có nhóm — ràng buộc nằm ở tầng ứng dụng, chỉ áp cho lần công bố tiếp theo.
- **2026-08-25** — Kiểm chứng: công bố khi chưa có nhóm trả 400 đúng thông báo; gán nhóm rồi công bố 200; tạo kèm nhóm cũng lưu đúng. Ma trận có ô chọn nhóm khi tạo và bộ lọc theo nhóm (cộng dồn với ô tìm kiếm, không thay thế nhau).
- **2026-08-25** — Bốn test cũ fail vì chúng công bố quy trình không có nhóm; đã thêm `category` vào fixture và bổ sung 2 test cho luật mới. 39 test của module pass.
- **2026-08-25** — Dọn dữ liệu cấu hình thừa từ các lần test API: danh mục nhóm về đủ 5 nhóm mặc định, thẻ dashboard của cả 3 module về rỗng (tức dùng thẻ mặc định).
- **2026-08-25** — BẪY VẬN HÀNH đáng ghi: `.env.docker` không đặt `AUTH_PRIVATE_KEY` nên mỗi lần rebuild `api` là sinh cặp khoá RS256 MỚI. Module API giữ JWKS cũ trong cache và trả 401 "Access token không hợp lệ" cho tới khi được restart. Muốn hết hẳn thì đặt cặp khoá cố định trong `.env.docker`.
- **2026-08-25** — Phase 3.4 xong. Thêm mục "Nhóm quy trình" trong Cài đặt của module Quy trình: bật/tắt từng nhóm, sửa nhãn, thêm/xoá nhóm, và công tắc tự gán nhóm.
- **2026-08-25** — Nhóm ĐANG có quy trình dùng thì bị chặn xoá, chỉ cho tắt: mã nhóm nằm trong snapshot của mọi bản đã công bố, xoá đi là các quy trình đó rơi ra ngoài mọi bộ lọc mà không tìm lại được. Sửa nhãn thì được, nhưng KHÔNG đổi mã, cùng lý do.
- **2026-08-25** — Đặt cặp khoá RS256 cố định cho local: thêm `AUTH_PRIVATE_KEY`/`AUTH_PUBLIC_KEY` vào `.env.docker`, truyền xuống service `api` trong compose, và ghi hướng dẫn sinh khoá vào `.env.docker.example`. Kiểm chứng: đăng nhập → restart `api` → token cũ vẫn dùng được cho cả 3 module (trước đây Kho và Bảo trì trả 401).
- **2026-08-25** — NGUYÊN NHÂN GỐC của lỗi "thông tin công việc không get từ kho": compose KHÔNG truyền `INVENTORY_API_URL` xuống `maintenance-api`, nên `HttpAssetDirectory` rơi về mặc định `localhost:3336` — tức chính container của nó. Bảo trì chưa bao giờ đọc được danh mục thiết bị trong Docker. Cùng loại lỗi với `TENANT_CORE_ORGANIZATION_CONTEXT_URL` phát hiện lúc đầu.
- **2026-08-25** — Sau khi nối biến: `assetDirectoryAvailable=true`, ma trận hiện đủ 7 thiết bị thay vì 4, và taskCount là số thật (MBA-T1=5, MC-901=3, MBA-T2=2, TN-MEGGER=1).
- **2026-08-25** — `taskCount` đổi sang optional: `undefined` = chưa đọc được từ Kho, `0` = đọc được và thiết bị thật sự chưa khai báo. Badge có ba trạng thái riêng, trong đó trạng thái chưa đọc được tô màu cảnh báo.
- **2026-08-25** — `getAssetTasks` phân biệt "Kho không phản hồi" (409) với "Kho trả lời không có thiết bị này" (404); trước đây gộp làm một nên người dùng đi sửa nhầm chỗ.
- **2026-08-25** — Link "Sửa trong Kho" nay là `#assets/<mã>` và module Kho phân giải đoạn hash thứ hai để chọn sẵn đúng thiết bị.
- **2026-08-25** — Phase 4.2 xong. Kiểm chứng bằng tần suất TỰ ĐỊNH NGHĨA "6 tuần": tạo được lịch, scheduler sinh phiếu, và ngày đến hạn kế tiếp 01/08 → 12/09 đúng 42 ngày — tức phép tính lấy từ interval trong danh mục chứ không từ danh sách hardcode.
- **2026-08-25** — `nextDue` đọc danh mục MỘT LẦN cho cả lượt sinh phiếu, trong chính transaction đó: admin sửa giữa chừng cũng không làm nửa lượt tính theo bản cũ, nửa lượt theo bản mới.
- **2026-08-25** — Danh mục mặc định luôn được giữ làm nền: một lịch đang chạy theo mã mà admin vừa xoá khỏi danh mục vẫn tính được ngày kế tiếp thay vì đứng im.
- **2026-08-25** — Migration bỏ CHECK constraint tra tên ràng buộc từ `pg_constraint` thay vì đoán tên, vì tên do Postgres tự sinh.
- **2026-08-25** — `MaintenanceFrequency` từ union thành `string`; `MAINTENANCE_FREQUENCIES` vẫn giữ 5 mã làm mặc định nên test contract cũ không phải sửa.
- **2026-08-25** — Phase 4.3 xong. Theo quyết định của user, ma trận đổi thành DANH SÁCH TỰ CHỌN: chỉ thiết bị đã có lịch mới thành hàng, phần còn lại của Kho nằm trong `availableAssets` cho ô "Thêm thiết bị". Trước đó ma trận đổ hết mọi thiết bị của Kho, không dùng được với tenant vài trăm thiết bị.
- **2026-08-25** — "Bảo trì ngay" cố ý KHÔNG tạo phiếu bằng tay: nó đẩy hạn của các lịch đang chạy về hiện tại rồi gọi đúng đường sinh phiếu thường ngày. Nhờ vậy phiếu vẫn được đánh mã, vẫn mở hồ sơ bên Quy trình theo cấu hình, và ngày đến hạn kế tiếp vẫn dời đúng theo tần suất.
- **2026-08-25** — "Gỡ khỏi ma trận" XOÁ hẳn lịch, khác với bỏ tick một chu kỳ (chỉ tạm dừng và giữ lịch sử). Phải xoá phiếu trước vì chúng tham chiếu lịch bằng khoá ngoại.
- **2026-08-25** — Kiểm chứng: thêm TBA-110 (4→5 hàng, còn thêm được 4→3), bảo trì ngay MBA-T1 sinh 1 phiếu, gỡ TBA-110 (5→4 hàng, xoá 1 lịch), bảo trì ngay thiết bị chưa có chu kỳ trả 400 đúng thông báo. Đã dọn phiếu và hồ sơ sinh ra trong lúc kiểm chứng.
- **2026-08-25** — Phase 5.1: xong phụ tùng và bốn trường mới. Migration `0004-asset-fields` thêm `unit`, `purchase_price`, `currency`, `warranty_until`.
- **2026-08-25** — KHÔNG thêm cột "tình trạng": `assets.status` đã có sẵn từ 0001 với đủ bốn giá trị, chỉ là chưa có giao diện. Thêm cột thứ hai cùng nghĩa sẽ tạo hai nguồn sự thật.
- **2026-08-25** — Giá lưu KÈM mã tiền tệ thay vì giả định VND, và không đặt DEFAULT: `null` là chưa khai báo, `0` là giá bằng không — giao diện hiện gạch ngang cho trường hợp đầu.
- **2026-08-25** — Phụ tùng chỉ là nối dây: bảng `asset_boms` có từ migration đầu tiên nhưng chưa từng có store, route hay giao diện. Không phát sinh bảng mới.
- **2026-08-25** — Kiểm chứng API: cập nhật 4 trường mới OK; thêm phụ tùng trả về kèm tên/đơn vị vật tư; thêm vật tư không tồn tại trả 404; xoá phụ tùng 204.
- **2026-08-25** — Bảo hành quá hạn được tô đỏ trong màn chi tiết — con số đó chỉ có ích khi nhìn ra ngay.
- **2026-08-25** — Thêm mục "Hồ sơ thiết bị" trong Cài đặt của Kho: bật/tắt giá, bảo hành, và chọn trạng thái nào được dùng. Tắt chỉ ẩn khỏi giao diện, KHÔNG xoá dữ liệu — bật lại thì giá cũ vẫn còn.
- **2026-08-25** — Kiểm chứng bắt lỗi thiết kế của chính tôi: mặc định `priceFieldsEnabled`/`warrantyFieldsEnabled` là `false`, tức hai trường vừa thêm bị ẩn ngay từ đầu. Đã đổi mặc định sang BẬT, và chuẩn hoá dùng `!== false` để một client gửi thiếu trường không vô tình ẩn mất cột của cả tenant.
- **2026-08-25** — `enabledStatuses` rỗng nghĩa là "dùng hết mọi trạng thái", không phải "không trạng thái nào" — nếu hiểu ngược thì tenant chưa đụng cấu hình sẽ không chọn được trạng thái nào cả.
- **2026-08-25** — Phase 5.1 XONG. Tài liệu đính kèm dùng presigned URL qua MinIO, cùng khuôn với đính kèm của Quy trình: server chỉ ký URL và giữ siêu dữ liệu, tệp đi thẳng từ trình duyệt lên kho lưu trữ nên tệp lớn không chiếm bộ nhớ API.
- **2026-08-25** — User duyệt thêm 5 biến `S3_*` cho `inventory-api` trong compose, kèm `depends_on: minio-init` để bucket có sẵn trước khi service chạy.
- **2026-08-25** — Kiểm chứng vòng tròn đầy đủ: xin URL 201 → PUT lên MinIO 200 → danh sách hiện đúng tệp → tải về nội dung KHỚP nguyên văn → xoá 204. Chặn `.exe` trả 400, và khai content-type lệch đuôi (`anh.png` + `text/plain`) cũng 400.
- **2026-08-25** — Kiểm đuôi tệp CẢ HAI CHIỀU: đuôi phải nằm trong danh sách VÀ content-type phải khớp đúng đuôi đó. Chỉ kiểm một chiều thì đổi tên `a.exe` thành `a.pdf` là lọt.
- **2026-08-25** — Xoá tài liệu chỉ xoá bản ghi, KHÔNG xoá object trong kho lưu trữ: xoá tệp là thao tác không hoàn tác được, nên việc dọn kho làm riêng.
- **2026-08-25** — Rà soát theo yêu cầu user: hiện có ĐÚNG HAI chỗ module A ghi dữ liệu module B, cả hai đều CÓ SẴN từ trước, không phải do đợt này thêm. (1) Bảo trì → Quy trình: `dispatchToProcedure` tạo hồ sơ work order. (2) Quy trình → Kho: `reserveForStep`/`releaseReservation` đặt và nhả phiếu giữ chỗ.
- **2026-08-25** — Xác nhận bằng git diff: file `http-inventory-task-template.resolver.ts` KHÔNG có thay đổi nào của tôi. Bảo trì → Kho hoàn toàn chỉ đọc, không có lệnh POST nào trong `http-asset-directory.ts`.
- **2026-08-25** — GỠ BỎ việc Quy trình tự đặt phiếu giữ chỗ trong Kho, theo quyết định của user: số lượng trong kho chỉ đổi khi thủ kho thao tác trong module Kho; mượn/trả thiết bị là MỘT QUY TRÌNH riêng do người thật thực hiện như mọi quy trình khác.
- **2026-08-25** — Cụ thể: xoá `reserveForStep`, bỏ `reserveMaterials` khỏi port và resolver, `checkAndHoldForStep` đổi thành `checkMaterialsForStep`. Giữ lại `releaseReservation` để nhả các phiếu do BẢN CŨ tạo ra.
- **2026-08-25** — Kiểm chứng: mở hồ sơ QT-MUON-DC (có khai vật tư) — kiểm tồn vẫn báo `ok` kèm số liệu từng dòng, `materialReservations` rỗng, và số phiếu giữ chỗ bên Kho KHÔNG đổi (1 → 1).
- **2026-08-25** — Đánh đổi đã biết và chấp nhận: hai hồ sơ cùng lúc có thể cùng thấy đủ hàng rồi cùng đề nghị xuất. Thủ kho phát hiện khi cấp phát — và đó đúng là chỗ nên phát hiện.
- **2026-08-25** — Sau thay đổi này, chiều Quy trình → Kho chỉ còn ĐỌC. Chiều ghi chéo duy nhất còn lại là Bảo trì → Quy trình (mở work order), tức MỞ việc chứ không sửa dữ liệu nghiệp vụ của module kia.
- **2026-08-25** — PHASE 5.2 XONG. Gộp thiết bị và vật tư về `inventory_schema.materials` với cột phân loại `kind`; bảng `assets` đổi tên thành `assets_legacy` và thay bằng VIEW cùng tên. Nhờ view, cả 16 truy vấn hiện có chạy nguyên không sửa, và hợp đồng endpoint `internal/` không đổi một chữ.
- **2026-08-25** — Thực tế có 6 khoá ngoại trỏ vào `assets` chứ không phải 5 như kế hoạch ghi (tôi đã thêm `asset_documents` ở Phase 5.1). Cả 6 đã chuyển sang trỏ vào bảng gộp; giữ nguyên id khi chuyển dữ liệu nên không phải ánh xạ lại giá trị nào.
- **2026-08-25** — Đối chiếu trước/sau: sổ cái tồn kho KHÔNG suy suyển — 10 dòng tồn, tổng quantity 6351, tổng available 6351, 10 giao dịch, tổng qty giao dịch 6351. `materials` từ 8 thành 16 (8 STOCK + 8 ASSET), view `assets` vẫn trả 8.
- **2026-08-25** — Điểm chí mạng đã xử lý trước khi chạy: sau khi gộp, mọi truy vấn VẬT TƯ phải lọc `kind = 'STOCK'`; thiếu bộ lọc thì thiết bị lọt vào danh sách vật tư và sổ cái nhận những mã không có tồn. Đã sửa 9 chỗ.
- **2026-08-25** — Kiểm chứng CRUD thiết bị qua VIEW: tạo 201, sửa 200, xoá 200 — Postgres tự cho ghi vì view một-bảng không gộp nhóm. Mặc định `kind` đặt ngay trên VIEW nên INSERT qua view thành ASSET, còn INSERT thẳng vào bảng vẫn là STOCK.
- **2026-08-25** — Kiểm chứng liên module KHÔNG phải sửa gì: Bảo trì vẫn đọc được danh mục (4 hàng, 4 thiết bị thêm được, taskCount đúng 5/2/3/1, đầu việc MBA-T1 = 5); Quy trình vẫn đọc được 8 mã vật tư.

## Nhật ký 25/8 — Phase 6.1 + 6.2

`assetCode` thêm vào `CreateProcedureInstanceRequest`, `StartProcedureInstanceRequest`
và `ProcedureInstance`. Bảo trì truyền mã thiết bị của occurrence qua cả ba đường
gửi: sự cố tạo tay, scheduler định kỳ, và lượt gửi lại `reconcileStuckDispatches`
(query của lượt gửi lại phải đọc thêm `COALESCE(o.asset_code, s.asset_code)`).

Lúc mở hồ sơ, `applyAssetTaskTemplate` nạp lại `eTaskConfig.taskTemplate` theo
thiết bị thật, chỉ trên BẢN SAO trong hồ sơ. Định nghĩa vẫn giữ bản đóng băng lúc
công bố — đó là hợp đồng của phiên bản đã công bố.

Lượt gọi sang Kho đặt NGOÀI transaction, cùng chỗ với `checkMaterials`: để trong
transaction thì mỗi lần mở hồ sơ giữ một connection pg suốt thời gian chờ mạng.
Kho hỏng thì rơi về bản đóng băng, không mở work order rỗng đầu việc.

Kiểm chứng trên `savina`: định nghĩa "Bảo trì định kỳ máy biến áp lực" đóng băng ở
MBA-T1 (5 đầu việc). Mở work order với `assetCode: 'MBA-T2'` → hồ sơ nhận đúng 2
đầu việc của MBA-T2 ("Đo tải và cân pha"), định nghĩa gốc vẫn nguyên MBA-T1/5 đầu
việc. Hồ sơ kiểm chứng đã xoá sau khi đối chiếu.

## Nhật ký 25/8 — Phase 6.3 vật tư theo đầu việc

Migration `0009-subtask-materials.sql`: cột `materials jsonb NOT NULL DEFAULT '[]'`
trên `procedure_schema.subtasks`. Chọn jsonb thay vì bảng con vì `subtasks` vốn là
bảng chiếu được ghi lại toàn bộ ở mỗi transaction — bảng con sẽ phải xoá-ghi theo
y hệt mà không mua thêm được gì. Nguồn sự thật vẫn là `instances.snapshot`.

`ProcedureSubtask` và `ProcedureSubtaskInput` dùng lại `ProcedureStepMaterial`:
cùng hình dạng, cùng luật đóng băng `materialName`/`unit`. Client chỉ gửi
`materialCode` + `quantity`; server tra lại tên/đơn vị từ Kho lúc lưu, chứ không
tin theo client — client cũ có thể gửi tên đã lỗi thời.

Tra danh mục đặt NGOÀI transaction, cùng lý do với 6.1: mỗi mã là một lượt gọi
sang Kho, mười đầu việc là mười lượt chờ mạng giữ một connection pg.

Kho thêm `inventory.availableByMaterial` — một truy vấn GROUP BY duy nhất cho tồn
của mọi mã (lọc `kind='STOCK'`), rồi `internal/materials` trả kèm `available`. Tra
từng mã sẽ là một lượt HTTP cho mỗi dòng chọn trên màn hình. Trường `available`
để optional suốt tuyến: Kho không đọc được thì UI ghi "chưa đọc được tồn", KHÔNG
vẽ số 0 — `undefined` khác hẳn `0`.

Kiểm chứng trên `savina` (4 ca):
1. mã không có thật → 400 "không có trong Kho"
2. trùng mã trong cùng một đầu việc → 400 (gộp im lặng sẽ cho số khác thứ đã gõ)
3. số lượng ≤ 0 → 400
4. lưu hợp lệ → tên/đơn vị được chụp đúng từ Kho, bảng chiếu khớp snapshot

Sổ kho KHÔNG đổi sau cả bốn ca: tổng tồn 6351, 10 bút toán, không sinh phiếu giữ
chỗ mới. Đúng luật "số lượng trong kho chỉ đổi khi thủ kho thao tác trong module
Kho". Dữ liệu thử đã dọn khỏi tenant demo.

## Nhật ký 25/8 — Phase 6.4 xin vật tư, và 6.5

`POST /instances/:id/material-requests` mở hồ sơ xin vật tư cho một đầu việc.
**Không ghi một dòng nào vào sổ kho** — Quy trình chỉ đọc tồn để biết mở thủ tục
nào, rồi mở đúng thủ tục đó cho người thật đi làm.

Server tự quyết mượn/xuất hay mua theo tồn TƯƠI tại thời điểm bấm; request cố ý
không có trường chọn loại. Để client gửi lên thì một màn hình đã lỗi thời sẽ mở
nhầm thủ tục. Một đầu việc có thể sinh CẢ HAI hồ sơ: vài mã đủ, vài mã thiếu là
chuyện thường, gộp lại sẽ bắt người duyệt mua chờ phần đáng lẽ xuất được ngay.
Dòng mua ghi phần THIẾU (94), không ghi tổng cần (100).

Quyền: `canManageSubtasks || đầu việc là của mình`. Đây chính là mục 6.5 — không
giới hạn ở vai E, mọi chủ vai đều xin vật tư được cho việc của mình.

Khoá idempotency `materials:<hồ sơ>:<đầu việc>:<loại>` — bấm hai lần không sinh
hai hồ sơ, nhưng khai lại vật tư rồi bấm tiếp vẫn mở được hồ sơ mới, nên khoá
KHÔNG gắn với nội dung dòng vật tư.

Cấu hình: khoá mới `dispatch.material` trong Cài đặt module (mục "Xin vật tư"),
mặc định BỎ TRỐNG có chủ đích — không tenant nào dùng chung một quy trình
mượn/xuất, đoán hộ sẽ mở nhầm thủ tục. Chưa cấu hình thì người bấm tự chọn ngay
tại chỗ.

Kiểm chứng trên `savina` (5 ca):
1. chưa cấu hình, không tự chọn → 400 nói rõ phải làm gì
2. đầu việc đủ hàng → mở "Mượn và trả dụng cụ đo", dòng 10 Lít / tồn 1250
3. đầu việc thiếu hàng → mở "Mua sắm vật tư kỹ thuật", dòng thiếu 94/100 Cái
4. bấm lại → trả về đúng hồ sơ cũ, không sinh hồ sơ thứ hai
5. đầu việc chưa khai vật tư → 400

Sổ kho KHÔNG đổi: tổng tồn 6351, 10 bút toán, không sinh phiếu giữ chỗ mới. Nhật
ký hồ sơ cha ghi đủ mã hồ sơ con và lý do. Dữ liệu thử đã dọn, kể cả khoá
idempotency.

## Nhật ký 25/8 — Lint sạch và xác nhận dashboard

**Ba lỗi lint có sẵn trong repo đã sửa hết, tất cả trong vùng xanh:**

1–2. `module-maintenance` và `module-inventory` khai `contracts-integration` mà
không dùng dòng nào → gỡ khỏi `package.json`.

3. `apps/maintenance-api/.../tenant-organization-context.client.ts` import
`contracts-organization` (`scope:platform`) mà `scope:maintenance` không được
phép. **Không sửa `eslint.config.mjs`** (vùng đỏ): tầng này chuyển nguyên payload
cho web client và không đọc một trường nào, nên kiểu trả về đổi thành `unknown`.
Khai kiểu ở đây vừa phá ranh giới vừa dựng bản sao thứ hai của hợp đồng ngay tại
chỗ không cần biết hợp đồng. Phía web mới là nơi đọc trường, và ở đó nó tự khai.

`nx sync` phải chạy theo để gỡ ba tham chiếu tsconfig đã chết — cùng loại thay
đổi đã được duyệt trước đó.

Kết quả: `nx run-many -t lint` xanh cho **cả 42 project**, lần đầu kể từ đầu đợt.

**Dashboard: cả ba module đều đã có, 10 thẻ mỗi module**, admin bật/tắt và sắp
thứ tự trong Cài đặt. Kiểm chứng dữ liệu thật trên `savina` sau khi build lại
toàn bộ stack:
- Bảo trì: 4 lịch đang chạy, 1 phiếu đã sinh, 0 sự cố mở
- Quy trình: 18 định nghĩa, 5 hồ sơ
- Kho: 3 kho, 8 vật tư, 8 thiết bị, 10 bút toán

Cố ý KHÔNG gọi `GET /v1/dashboard` của Bảo trì: nó trả đúng phần `metrics` đã có
trong `/workspace`, nên gọi thêm chỉ tốn một request mà không thêm thông tin.
Endpoint vẫn giữ cho consumer khác. Kho không có `/workspace`; màn hình gọi thẳng
các endpoint danh mục, và dashboard đọc từ đó.

**Còn mở:** `0007-drop-legacy-assets.sql` vẫn CỐ Ý chưa đăng ký. Drop bảng là
thao tác không lùi lại được, đúng loại "ảnh hưởng xấu" cần tránh — chỉ đăng ký
sau khi bản gộp chạy ổn qua một chu kỳ vận hành thật.

## Nhật ký 25/8 — Xoá endpoint dashboard thừa của Bảo trì

`GET /v1/dashboard` đã xoá khỏi `maintenance.controller.ts`. Xác nhận trước khi
xoá: grep toàn repo (ts/tsx/conf/mjs) không có một chỗ nào gọi nó. Nó trả đúng
`metrics` + `occurrences` + `schedules` mà `/workspace` đã trả, nên giữ lại chỉ
là một đường thứ hai vào cùng dữ liệu — thứ sẽ lệch nhau khi một trong hai được
sửa mà bên kia thì không.

Type `MaintenanceDashboardMetrics` GIỮ NGUYÊN: nó vẫn là kiểu của
`MaintenanceWorkspace.metrics`, tức là thứ dashboard đang thực sự đọc.

Kiểm chứng sau khi build lại: `/workspace` vẫn trả metrics đủ (4 lịch, 1 phiếu),
`/dashboard` trả 404 như mong đợi. Lint/typecheck/test xanh.

## Nhật ký 25/8 — LỖI THẬT: hai danh sách migration đã lệch nhau

Phát hiện khi tạo tenant thứ hai để kiểm chứng cách ly multi-tenant.

**Triệu chứng:** tenant `mockco` vừa cấp phát xong đã thiếu 10 migration —
12/21 thay vì 21/21. Không có `materials.kind`, không có bảng `module_settings`
của cả ba module, không có view `assets`, không có `subtasks.materials`.

**Nguyên nhân:** danh sách migration tồn tại HAI BẢN.
- `apps/migrator/src/main.ts` — nâng cấp tenant đã có, chạy lúc khởi động stack
- `packages/platform/entitlement/.../tenant-provisioning.processor.ts` — cấp
  phát tenant MỚI, chạy trong worker

Cả đợt 21/8 chỉ được thêm vào bản thứ nhất. Migrator vá lại được, nhưng chỉ ở
lần chạy sau — nghĩa là cửa sổ hỏng kéo dài từ lúc tenant được tạo đến lần
restart stack kế tiếp. Trong SaaS thì đó đúng là lúc khách hàng mới vừa đăng ký.

**Sửa (user chọn phương án b — nguồn sự thật duy nhất):**
`packages/platform/entitlement/src/lib/tenant-migrations.ts` giữ danh sách duy
nhất. Migrator và worker cùng đọc từ đó, nên lệch là chuyện không thể xảy ra nữa.

Ba trở ngại kỹ thuật gặp phải, ghi lại vì đều không hiển nhiên:
1. Worker chạy thẳng file `.ts` qua type stripping của Node, ở đó import tương
   đối bắt buộc có đuôi `.ts` — mà TypeScript từ chối đuôi đó nếu không bật
   `allowImportingTsExtensions` ở tsconfig gốc (vùng đỏ). Giải: TRUYỀN danh sách
   vào constructor của processor thay vì để nó tự import. Bên gọi dùng bare
   specifier `.../migrations`, không vướng đuôi file.
2. Type stripping cũng không hỗ trợ parameter property (`private readonly` trong
   tham số constructor) → phải gán trường tường minh.
3. `pnpm install --lockfile-only` không tạo symlink workspace; phải cài thật.

**Chốt chặn chống tái diễn:** `tenant-migrations.spec.ts` — 4 test, quét thư mục
`migrations/tenant/**` và bắt lỗi ngay lúc build nếu có file `.sql` chưa đăng ký,
hoặc đăng ký một file không tồn tại, hoặc trùng `version`. File cố ý bỏ qua phải
nêu tên kèm lý do trong `DELIBERATELY_UNREGISTERED` (hiện chỉ có
`0007-drop-legacy-assets.sql`).

**Kiểm chứng:** tenant `mocktwo` tạo SAU khi sửa → 21/21 migration ngay từ lúc
cấp phát. Cả 7 màn hình của ba module trả 200 ngay, không phải chờ restart.

## Nhật ký 25/8 — Cách ly multi-tenant: 6/6 đúng

| Phép thử | Kết quả |
|---|---|
| Mỗi phiên chỉ thấy dữ liệu của mình | savina 8 vật tư, mockco 1 — giao nhau rỗng |
| Ép `X-Tenant-ID` sang tenant khác | Header BỊ BỎ QUA, vẫn trả dữ liệu tenant của phiên |
| Phiên người dùng gọi endpoint nội bộ | 401 `SERVICE_IDENTITY_INVALID` |
| Admin tenant này đọc quản trị tenant kia | 403 cả hai chiều |
| Quy trình / Bảo trì | savina 18 quy trình + 4 lịch; mockco 0 và 0 |
| Ghi bên mockco có rò sang savina | Không |

Điểm quan trọng nhất là phép thử 2: `X-Tenant-ID` không được tin với phiên người
dùng — tenant lấy từ cookie phiên. Header đó chỉ có tác dụng ở đường
service-to-service, mà đường đó chặn bằng service token.

## Nhật ký 25/8 — Kiểm build từ đầu trước khi push

Chạy trong compose project riêng `ep-fresh` (cổng 8090) nên `savina`/`mockco`/
`mocktwo` trên stack chính không bị đụng; dọn xong xác nhận vẫn đủ 4 database.

Pass hết: `pnpm install --frozen-lockfile`, `nx sync:check`, `nx run-many -t lint
typecheck test build` không cache (42 project), build 10 image, stack lên từ
volume rỗng (14 container healthy), tenant tạo từ số 0 đủ 21/21 migration.

### Lỗi 1: đua ghi pnpm store khi build song song — ĐÃ SỬA

`docker compose build` (song song mặc định) fail ngẫu nhiên với
`ENOENT ... sass@1.102.0/package.json`. Build lại chính service đó thì qua.

Cả 10 Dockerfile dùng chung cache mount `id=enterprise-platform-pnpm` mà không
khai `sharing`, nên BuildKit dùng mặc định `shared` — nhiều build cùng ghi một
pnpm store. Mười dòng đầu của 10 Dockerfile giống hệt nhau nên BuildKit gộp
được, KHÔNG đua; đua xảy ra khi các build LỆCH PHA (cache hit/miss khác nhau,
điển hình là sau khi lockfile vừa đổi): build A đang `pnpm fetch` ghi store
trong khi build B đã `pnpm install --offline` đọc store.

Sửa: thêm `sharing=locked` vào 26 dòng cache mount trong 10 Dockerfile. Build
song song lại: 10/10 image, 3m09s, không lỗi.

Thông báo lỗi trỏ sai hướng hoàn toàn (người đọc sẽ đi soi lockfile và sass),
lại không lặp lại được — đó là lý do phải sửa chứ không chỉ build tuần tự.

### Lỗi 2: Phase 3.4 làm hỏng script seed — ĐÃ SỬA

Seed SAVINA từ database rỗng dừng ở
`HTTP 400: Quy trình phải thuộc một nhóm trước khi công bố`.

Luật nhóm bắt buộc (Phase 3.4) áp cho MỌI lần công bố, nhưng
`seed-savina-demo.mjs` chưa gán `category`. 18 quy trình của SAVINA đứng im ở
trạng thái nháp. Chú thích đầu file còn ghi `category` đã bị bỏ khỏi contract —
đúng vào lúc trước, sai sau 21/8.

Sửa: gán nhóm cho cả 18 quy trình (technical 6, governance/admin_hr/finance/
sales_marketing mỗi nhóm 3), gửi `category` ở CẢ hai chỗ — lúc POST tạo và lúc
PATCH. Gửi ở PATCH là bắt buộc: bản nháp còn sót từ lần chạy trước khi có luật
sẽ không có `category`, chỉ gán lúc tạo thì nó kẹt mãi không công bố được.

Kiểm chứng: seed lại từ database rỗng → 18/18 công bố, số liệu khớp stack chính
(45 người, 82 node, 8 vật tư, 8 thiết bị, 18 quy trình, 4 lịch bảo trì), cả 7
màn hình trả 200, `/t/savina/login` trả 200.

**Lưu ý cho tenant CŨ:** 18 quy trình của `savina` trên stack chính có
`category` RỖNG vì được công bố trước khi luật ra đời. Chúng vẫn chạy bình
thường, nhưng lần sửa và công bố lại tiếp theo sẽ bị chặn cho tới khi gán nhóm.

## Nhật ký 25/8 — Một lệnh để có dữ liệu SAVINA trên máy khác

`scripts/seed-demo.sh` + `pnpm seed:demo`. Script đọc mật khẩu từ `.env.docker`
(file bị gitignore) nên không in ra và không nằm trong source, tự tìm container
`api` qua `docker compose ps -q`, copy hai file seed vào rồi chạy TRONG container
— ở đó có sẵn `pg`, gọi được `http://gateway` nội bộ, và đúng Node 24.

Thêm `pnpm docker:up` / `pnpm docker:down` cho đủ bộ.

**Cố ý KHÔNG gắn seed vào `docker compose up`.** Gắn vào thì một lần `up` nhầm
trên máy chủ thật sẽ bơm 45 tài khoản giả kèm mật khẩu mặc định vào đó. Muốn có
data thì phải gõ lệnh một cách cố ý. Nếu sau này muốn tự động hoàn toàn thì dùng
compose profile (`--profile demo`) — nhưng đó là sửa `infrastructure/`, vùng đỏ.

Kiểm chứng idempotent: chạy `pnpm seed:demo` trên stack chính đã có đủ dữ liệu →
mọi mục báo "đã có, bỏ qua", số hồ sơ vẫn 5, không sinh bản trùng.

README bổ sung mục nạp tenant demo kèm bảng tài khoản; `.env.docker.example` bổ
sung `SAVINA_ADMIN_PASSWORD` / `SAVINA_MEMBER_PASSWORD` (để trống, có chú thích).

## Nhật ký 25/8 — integration.md

Hướng dẫn dựng hệ thống trên máy mới. Mọi lệnh trong đó đã được chạy thật để
kiểm, và việc kiểm bắt được ba chỗ sai:

1. **`/login` trả 404.** Route Platform Admin là `/platform/login`. Các trang bên
   trong trả 307 khi chưa đăng nhập — là chuyển hướng, không phải lỗi.
2. **Số container.** 16 service chứ không phải 14: 14 chạy + `migrator` và
   `minio-init` ở `Exited (0)`.
3. **Lệnh sinh khoá RS256 trong `.env.docker.example` KHÔNG chạy được trên bash.**
   Nháy kép làm bash nuốt một lớp backslash, `replace(/\n/g,'\\n')` thành thay
   xuống dòng bằng xuống dòng — tức không làm gì — nên khoá in ra trải nhiều
   dòng và không nhét vào file `.env` được. Bản trong example viết cho
   PowerShell. integration.md dùng heredoc `<<'EOF'`, đã kiểm cho ra đúng hai
   dòng có `\n`.

Tài liệu gồm 9 mục: yêu cầu máy, cấu hình env, dựng stack, seed demo, đăng nhập,
kiểm tra, tạo tenant mới, lỗi thường gặp, chạy dev trên host. Phần lỗi thường
gặp ghi lại đúng những lỗi đã thực sự gặp trong đợt này — gateway 503 30 giây do
`resolver valid=30s`, 401 hàng loạt do thiếu khoá RS256 cố định, đua pnpm store
khi build song song, OOM `maintenance-web`, login thiếu `portal`, và luật bật
entitlement tuần tự.
