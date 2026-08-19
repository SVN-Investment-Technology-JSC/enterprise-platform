# Triển khai 3 Module: Inventory, Maintenance, Procedure — Task Tracking

**Plan:** [/Users/awkunss/.claude/plans/t-i-c-k-ho-ch-ancient-sunrise.md](../../../.claude/plans/t-i-c-k-ho-ch-ancient-sunrise.md)

> **Quy ước trạng thái**
> ✅ = đã viết **và** đã chạy build/verify thành công
> 🟨 = code có nhưng chưa verify, hoặc mới xong một phần
> ⏳ = chưa làm

---

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
