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

Thêm role `procedure-participant` (chỉ `read` + `act`) cho người dùng thường.

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

### Workspace lọc theo tham gia
`getWorkspace` lọc work order theo assignment ở **bất kỳ bước nào**, không chỉ bước hiện tại — người duyệt ở bước 4 thấy hồ sơ đang tiến tới mình từ bước 2. `definitions` chỉ trả khi `canDesign`.

| Task | Status | Notes |
|------|--------|-------|
| Validate E-after-C | ✅ | **Đã sửa lỗi**: bản cũ có thân vòng lặp rỗng nên không validate gì. Nay: step có E bắt buộc phải có C |
| Validate AND-logic nhiều R | ✅ | Chặn trùng subject trong cùng role R |
| Validate E(x) weight = 100 | ⏳ | **Đã gỡ khỏi publish** — `subtasks` là thực thể runtime, không tồn tại lúc định nghĩa. Rule này phải làm ở runtime khi E phân rã công việc. Chưa implement. |
| `createInstance()` cho module ngoài | ✅ | Đã test: tạo được instance, idempotency đúng (gọi 2 lần trả cùng id) |
| Endpoint `POST /v1/internal/instances` | ✅ | Xác thực service token, có token → 201, không token → 401 |
| Ghi `source_type`/`source_id` vào instance | ✅ | **Sửa bug**: 2 cột này trước đây không được ghi gì, nguồn gốc work order mất trắng. `initiated_by` cũng bị nhồi chuỗi vào cột uuid |
| Workspace hợp nhất theo assignee | 🟨 | Code build pass, chưa test bằng người dùng thật |
| Role E lấy đầu việc từ Inventory | ✅ | **Đã verify**: publish gọi `/v1/internal/assets/:code/task-template`, đóng băng vào `e_task_config`. Kiểm chứng: sửa asset ở Inventory sau khi publish → definition đã publish **không đổi** |
| Ghi `e_task_config` xuống DB | ✅ | **Sửa bug**: cột này trước đây không được ghi gì cả |
| Escalation | ✅ | **Đã nối vào runtime + verify**. Đơn vị không có trưởng → trách nhiệm lên tổ tiên gần nhất có trưởng. Trả cờ `isEscalated` để UI hiển thị. 8 test unit + kiểm chứng HTTP với cây tổ chức thật (OM không trưởng → LAB có trưởng) |
| Delegation | ⏳ | Bảng `delegations` đã có đủ cột nhưng chưa có gì ghi vào; `buildDelegationMetadata()` vẫn là code chết |
| Sửa `synchronizeNormalized` (bảng actions) | ⏳ | Vẫn xoá `actions` mà không insert lại → mất audit trail |
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
| Escalation, delegation, E(x) weight | ❌ Chưa có tác dụng thực tế |

**Việc tiếp theo nên làm, theo thứ tự:**
1. Delegation — bảng `procedure_schema.delegations` đã có đủ cột (instance_id, step_instance_id, delegated_by, delegated_to, reason) nhưng **chưa có gì ghi vào**; cần endpoint uỷ quyền + đọc khi phân quyền
2. Implement E(x) weight validation ở runtime — nay đã có `taskTemplate` đóng băng trong `e_task_config` làm nguồn đối chiếu
3. Sửa `synchronizeNormalized` — vẫn xoá bảng `actions` mà không insert lại, mất audit trail
4. `inventory-web` + `packages/features/inventory`
5. Gán quyền `procedure.design` cho đúng nhóm tenant admin trong dữ liệu thật (hiện tenant-admin có tất cả quyền nên tự động có)

**Đã xong:** ~~Access guard + multi-tenant cho inventory-api~~, ~~nối Procedure → Inventory~~, ~~job quét occurrence kẹt~~

### Cách đăng nhập để test thủ công
```bash
curl -X POST http://localhost:3333/api/auth/v1/login -H "Content-Type: application/json" -c cookies.txt \
  -d '{"email":"admin@minhlong.local","password":"<SEED_TENANT_ADMIN_PASSWORD>","portal":"tenant"}'
# portal là bắt buộc ('platform' | 'tenant'), thiếu sẽ trả 400
CSRF=$(grep ep_csrf cookies.txt | awk '{print $7}')
curl -X POST http://localhost:3334/api/procedure/v1/... -b cookies.txt -H "x-csrf-token: $CSRF"
```
