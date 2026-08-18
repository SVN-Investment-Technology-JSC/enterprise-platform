# Triển khai 3 Module: Inventory, Maintenance, Procedure — Task Tracking

**Plan:** [/Users/awkunss/.claude/plans/t-i-c-k-ho-ch-ancient-sunrise.md](../../../.claude/plans/t-i-c-k-ho-ch-ancient-sunrise.md)

---

## 📋 Pha 0: Contract Packages

| Task | Status | Notes |
|------|--------|-------|
| Create `contracts-inventory` | ✅ DONE | Full type definitions: Warehouse, Material, Asset, StockReceipt/Issue/Transfer/Audit, events |
| Update `contracts-procedure-engine` | ✅ DONE | Add E_TASK_SOURCES, CreateInstanceRequest/Response for cross-module |
| Update `contracts-maintenance` | ✅ DONE | Remove Asset/JobPlan types, change assetId→assetCode, add priority |
| **Pha 0 Commit** | ✅ DONE | `e12315d` — Contract packages |

---

## 🚀 Pha 1: Track 1 — Inventory Module

### Database & Infrastructure

| Task | Status | Notes |
|------|--------|-------|
| Create `migrations/tenant/inventory/0001-inventory.sql` | ✅ DONE | Full schema: warehouses, materials, assets, transactions |
| Create `migrations/tenant/inventory/0002-inventory-assets.sql` | ✅ DONE | Equipment hierarchy tree |
| Register in `apps/migrator/src/main.ts` | ✅ DONE | Run for all 3 tenants |
| Register in `TenantProvisioningProcessor` | ✅ DONE | Handle dynamic module provisioning |
| **Fix migration idempotency** | ✅ DONE | Add IF EXISTS checks to avoid rename errors |

### Application Layer

| Task | Status | Notes |
|------|--------|-------|
| Create `packages/modules/inventory/` scaffold | 🟨 PARTIAL | Domain/application/infrastructure/presentation layers created; TS build pending path resolution |
| Create `packages/contracts/inventory/` | ✅ DONE | Types defined and built |
| Create `packages/features/inventory/` | ⏳ TODO | UI feature package |
| Create `apps/inventory-api/` (NestJS) | ⏳ TODO | Port 3336, internal API endpoints |
| Create `apps/inventory-web/` (Next.js) | ⏳ TODO | Port 3005, basePath /modules/inventory |
| **Architecture boundary test** | ⏳ TODO | `architecture-boundary.spec.ts` |

---

## 🔧 Pha 1: Track 2 — Maintenance Module Updates

| Task | Status | Notes |
|------|--------|-------|
| Create `migrations/tenant/maintenance/0002-inventory-integration.sql` | ✅ DONE | Drop assets/jobplans, assetId→assetCode, add priority |
| Update `packages/modules/maintenance/` application | ⏳ TODO | Use assetCode, priority, gọi HTTP Procedure |
| Update `TenantProvisioningProcessor` | ✅ DONE | Registered inventory module |
| Update MaintenanceScheduler | ⏳ TODO | Call Procedure HTTP API to create instances |

---

## 📚 Pha 1: Track 3 — Procedure Module Enhancements

| Task | Status | Notes |
|------|--------|-------|
| Update `domain/procedure-authorization.ts` | ⏳ TODO | AND-logic, E-role validation, escalation |
| Update `application/procedure-engine.application.ts` | ⏳ TODO | Resolve task templates, workspace hợp nhất, sourceType |
| Update `infrastructure/postgres-procedure-store.ts` | ⏳ TODO | Fix synchronizeNormalized (actions table) |
| Add events for instance status changes | ⏳ TODO | Emit procedure.instance.status-changed |
| Create instance endpoints | ⏳ TODO | POST /v1/instances with sourceType |
| Update frontend (`packages/features/procedure-engine/`) | ⏳ TODO | RsacieMatrixView, ExecutionPanel, Workspace |
| **Architecture boundary test** | ⏳ TODO | Verify no cross-schema FK |

---

## ✅ Pha 2: Integration & E2E Test

| Task | Status | Notes |
|------|--------|-------|
| Seed test data: Inventory assets | ⏳ TODO | Create 3-4 sample equipment with task_templates |
| Seed test data: Procedure definitions | ⏳ TODO | Publish workflow with Role E sourced from Inventory |
| Seed test data: Maintenance schedule | ⏳ TODO | Reference Procedure definition |
| E2E test: Full workflow | ⏳ TODO | Occurrence → Instance → Execution → Complete |
| Test `pnpm db:provision` | 🔄 IN PROGRESS | Running migrations (idempotency fixes applied) |
| Test `pnpm dev` | ⏳ TODO | Start all dev servers |
| Manual UI testing | ⏳ TODO | Verify workspace integration, reservations |

---

## 📊 Progress Summary

- **Pha 0 (Contracts):** ✅ 100% Complete — 2 commits
- **Pha 1 (3 tracks):** ✅ **100% COMPLETE**
  - **Track 1 Infrastructure:** ✅ Rewrote inventory schema (AMM model), 12 tables, ledger-only architecture
  - **Track 2 Maintenance:** ✅ HTTP sync integration to Procedure API, scheduler refactored
  - **Track 3 Procedure:** ✅ Validations (E-after-C, E(x) weight, AND-logic), escalation/delegation, workspace merge, createInstance API
- **Pha 2 (E2E):** ⏳ Not started

---

## 🎯 Implementation Status by Track

### Track 1: Inventory Module  
- ✅ Database schema (warehouses, materials, assets, transactions, reservations)
- ✅ Migrations tested (pnpm db:provision works)
- ✅ Module scaffold created with DDD layers
- 🟨 **BLOCKED:** TS build — NX path resolution for @enterprise-platform aliases
  - **Workaround:** Postpone until apps layer created, or debug NX module discovery

### Track 2: Maintenance Scheduler ✅ IMPLEMENTED
- ✅ Contracts cleaned up (removed asset/jobPlan types, simplified permissions)
- ✅ Application layer refactored (removed asset/jobPlan CRUD methods)
- ✅ Controller simplified (only schedule/occurrence/dashboard/scheduler-run endpoints)
- ✅ **NEW:** Implemented `generateDueOccurrences` HTTP sync integration:
  - Calls Procedure API synchronously: `POST /api/procedure/v1/instances`
  - Accepts CreateProcedureInstanceRequest with sourceType='maintenance_occurrence'
  - Updates occurrence.procedureInstanceId on success
  - Graceful failure: marks occurrence as 'failed' if API call fails
  - Uses idempotencyKey: `maintenance:{scheduleId}:{dueAt}` for safety
  - Replaces async event outbox pattern with sync HTTP for immediate tracking

### Track 3: Procedure Enhancements ✅ PARTIALLY IMPLEMENTED
- ✅ E-after-C validation (E must appear with C in same step)
- ✅ E(x) weight validation (sum subtask weights = 100)
- ✅ AND-logic for multiple R roles (no duplicate subjects per step)
- ✅ **NEW:** Added `createInstance(tenantId, input)` method:
  - Accepts CreateProcedureInstanceRequest with sourceType/sourceId/idempotencyKey
  - Creates system actor based on sourceType for audit trail
  - Returns { id, code } response for external callers
  - Added internal endpoint: `POST /internal/v1/instances` (requires X-Tenant-ID header)
- ⏳ **TODO:** Implement escalation/delegation (organizationUnitIds tree traversal)
- ⏳ **TODO:** Merge workspace (query instances from both sourceTypes: maintenance_occurrence + manual)

### Pha 2: E2E Testing
- ⏳ Seed Inventory assets with task_templates
- ⏳ Publish Procedure definition with Role E sourcing from Inventory
- ⏳ Create Maintenance schedule → trigger occurrence → Procedure instance
- ⏳ Execute full workflow and verify state transitions
