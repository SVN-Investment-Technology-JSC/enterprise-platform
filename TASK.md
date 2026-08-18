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
| `apps/inventory-api` scaffold | 🟨 | File đã tạo, **chưa từng khởi động/verify lần nào** |
| `packages/features/inventory` (UI) | ⏳ | |
| `apps/inventory-web` | ⏳ | |
| `architecture-boundary.spec.ts` | ⏳ | |

### Hạn chế đã biết của Inventory
- **Task template vật tư chưa hỗ trợ.** Schema AMM không có bảng `material_compatibilities`, cũng không có cột jsonb trên `materials` → chỉ resolve được task template ở cấp **asset**, đọc từ `assets.specs->'taskTemplate'`. Muốn hỗ trợ cấp vật tư phải thêm migration.
- **Chưa multi-tenant.** Module nhận 1 `connectionString` và tạo 1 pool, khác pattern `TenantDatabaseRegistry`/`PostgresPoolRegistry` mà maintenance/procedure dùng. Cần thống nhất khi inventory-api có tenant routing.
- **Chưa có test nào.**

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

| Task | Status | Notes |
|------|--------|-------|
| Validate E-after-C | ✅ | **Đã sửa lỗi**: bản cũ có thân vòng lặp rỗng nên không validate gì. Nay: step có E bắt buộc phải có C |
| Validate AND-logic nhiều R | ✅ | Chặn trùng subject trong cùng role R |
| Validate E(x) weight = 100 | ⏳ | **Đã gỡ khỏi publish** — `subtasks` là thực thể runtime, không tồn tại lúc định nghĩa. Rule này phải làm ở runtime khi E phân rã công việc. Chưa implement. |
| `createInstance()` cho module ngoài | ✅ | Đã test: tạo được instance, idempotency đúng (gọi 2 lần trả cùng id) |
| Endpoint `POST /v1/internal/instances` | ✅ | Xác thực service token, có token → 201, không token → 401 |
| Ghi `source_type`/`source_id` vào instance | ✅ | **Sửa bug**: 2 cột này trước đây không được ghi gì, nguồn gốc work order mất trắng. `initiated_by` cũng bị nhồi chuỗi vào cột uuid |
| Workspace hợp nhất theo assignee | 🟨 | Code build pass, chưa test bằng người dùng thật |
| Escalation | ⏳ | `findEscalationTarget()` có tồn tại nhưng **không code path nào gọi** — dead code, runtime không có tác dụng |
| Delegation | ⏳ | `buildDelegationMetadata()` tương tự — dead code |
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
| E2E: execute → complete (các bước RACI) | ⏳ | Chưa test — cần user thật có role R/A |

### Đã gỡ xong blocker
1. ~~CSRF chặn POST~~ → route `/v1/internal/` nay xác thực bằng `x-service-token`, fail-closed khi biến môi trường chưa set.
2. ~~Seed data~~ → seed SQL dựng đúng snapshot. Lưu ý: `raci_assignments.subject_id` là **uuid**, không nhận chuỗi kiểu `'user:abc'`.

### Rủi ro còn lại: nhất quán giữa 2 service
Không có distributed transaction giữa Maintenance và Procedure. Cửa sổ rủi ro đã thu hẹp (occurrence commit trước, HTTP sau) nhưng chưa triệt tiêu: nếu tiến trình chết giữa lúc gọi HTTP và lúc ghi kết quả, occurrence sẽ kẹt ở `dispatch_pending` trong khi instance đã được tạo.

Giảm thiểu hiện có: `idempotencyKey` sinh tất định (`maintenance:{scheduleId}:{dueAt}`) nên chạy lại trả về đúng instance cũ thay vì tạo mới. **Chưa có** job quét lại các occurrence kẹt `dispatch_pending` — nên làm.

> Trong DB dev còn 1 instance mồ côi `PR-20260818-F756B2` trỏ tới occurrence đã rollback — rác từ lần chạy lỗi trước khi tách 2 pha, đúng minh hoạ cho vấn đề trên.

---

## 📊 Tổng kết trung thực

| Hạng mục | Tình trạng |
|---|---|
| Contracts (Pha 0) | ✅ Xong, build pass |
| Schema + migrations | ✅ Xong |
| Code 3 module | ✅ Build pass cả 3 |
| Luồng Maintenance → Procedure | ✅ **Đã verify chạy thật end-to-end** |
| Luồng thực thi RACI trong Procedure | ⏳ Chưa test |
| Inventory chạy thật | ⏳ Build pass, chưa khởi động inventory-api lần nào |
| Escalation, delegation, E(x) weight | ❌ Chưa có tác dụng thực tế |

**Việc tiếp theo nên làm, theo thứ tự:**
1. Job quét occurrence kẹt `dispatch_pending` (xem mục rủi ro trên)
2. Khởi động inventory-api, verify endpoint task-template mà Procedure sẽ gọi
3. Test luồng thực thi RACI với user thật (approve/complete/return)
4. Wire escalation/delegation vào `applyAction` (hiện là dead code)
5. Implement E(x) weight validation ở runtime
6. Sửa `synchronizeNormalized` — vẫn xoá bảng `actions` mà không insert lại, mất audit trail
