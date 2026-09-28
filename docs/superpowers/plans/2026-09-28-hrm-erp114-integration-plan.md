# HRM ERP-114 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hợp nhất HRM của Hải và Tài, giữ cơ chế Procedure của Hải, bổ sung CRUD theo vòng đời và chứng minh toàn luồng chạy qua ERP gateway.

**Architecture:** Bridge HRM gọi Procedure để khởi tạo và xử lý bước; Procedure là nguồn trạng thái quy trình. Một bộ xử lý kết quả tại HRM áp dụng hiệu lực công/phép/lương trong transaction, có chống lặp và phục hồi. Danh mục và giao dịch dùng cùng quy tắc vòng đời ở API/UI, giữ RBAC động và dữ liệu theo tenant.

**Tech Stack:** pnpm, Nx, TypeScript, NestJS, PostgreSQL, Next.js/React, shadcn/ui, Ant Design, Jest, RabbitMQ; trình duyệt Codex cho UAT.

**Spec:** `docs/superpowers/specs/2026-09-28-hrm-procedure-crud-navigation-design.md` — đã được người dùng duyệt.

## Global Constraints

- Làm tại `D:/data/savina/enterprise-platform`, nhánh `ngtantai/tenant-dynamic-rbac`; không tạo worktree.
- Giữ biểu mẫu động, thuộc tính bước S, tiến độ và khởi tạo qua bridge của Hải; không thay bằng một cơ chế khởi tạo độc lập khác.
- Không sửa migration đã áp dụng; migration mới phải được đăng ký và thử cả tenant mới/cũ.
- Không ghi trực tiếp snapshot hoặc `runtime_state` của Procedure từ HRM. GET không tạo hiệu lực nghiệp vụ.
- Không sửa/xóa mất lịch sử công, phép, lương và chứng từ đã chốt. Thay đổi có hiệu lực cần audit, quyền, khóa kỳ và kiểm tra tenant.
- UI dùng SearchableSelect, không `<select>` tĩnh, không emoji. Dialog cho form; Drawer chi tiết/lịch sử; Popconfirm cho thao tác ảnh hưởng dữ liệu. Thiết kế dữ liệu dày, phù hợp 16:9.
- Mock chỉ trong môi trường phát triển, không nhãn HRM-UAT; lưu ID bản ghi tạo mới, bảo toàn dữ liệu sẵn có.
- Chưa push hoặc cập nhật Jira. Chỉ đánh dấu task đạt khi có kết quả kiểm tra; số lượng endpoint không chứng minh nghiệp vụ đã đạt.
- Dùng pnpm Nx cho test/build/lint; xem target trước khi chạy target chưa xác nhận. Đọc systematic-debugging khi xử lý lỗi; ghi nhận test thất bại trước khi sửa.

## Review Focus

1. Hai lần bấm gửi/timeout sau khi Procedure đã tạo instance: chỉ một instance và một hiệu lực — task 4/5.
2. Đơn đổi ca đang chờ người đổi cùng xác nhận: không bỏ qua bước này khi chuyển cơ chế — task 4/9.
3. Cấu hình/lương/hồ sơ thay đổi trong lúc chờ duyệt: giữ snapshot hoặc báo xung đột, không ghi đè mù — task 5/7/11.
4. Tenant đã có dữ liệu, bao gồm liên kết từ cả hai cơ chế: giữ định danh và đưa trường hợp không rõ vào đối soát — task 2/3.
5. Thu hồi quyền sau khi mở trang và truy cập trực tiếp URL: API từ chối, UI cập nhật, không lộ dữ liệu tenant khác — task 12/14.

## Trạng thái xuất phát và cách theo dõi

- Commit toàn bộ mã trước rebase: `1fbc9da`; dự phòng `codex/hrm-before-hai-rebase-20260928`.
- Rebase đang ở commit cuối trên `b39f7f9`, HEAD tạm `36d00e2`, còn 12 tệp xung đột. Không fetch/rebase lại từ đầu.
- Test registry đã tái hiện: `pnpm nx run platform-entitlement:test --skipNxCache` trả 4 đạt/1 lỗi, thiếu hai migration Hải.
- Tất cả checkbox dưới đây ban đầu chưa hoàn thành. Đây là kế hoạch triển khai, không phải biên bản nghiệm thu.
- Ba chặng phụ thuộc nhau: A (task 1–5) mã/schema/Procedure; B (6–12) CRUD/UI; C (13–14) vận hành/kiểm thử/bàn giao. Không thu hẹp nghiệm thu chỉ còn chặng A.

## Cấu trúc tệp và giao diện chung

Các đường dẫn viết tương đối so với repository. Giữ file hiện có; chỉ tách phần đang sửa khi cần trách nhiệm rõ ràng.

- `packages/contracts/hrm/src/lib/contracts-hrm.ts`: DTO API, loại đơn chuẩn và trạng thái đồng bộ.
- `packages/modules/hrm/src/lib/infrastructure/hrm-procedure-bridge.service.ts`: binding, khởi tạo, đọc tiến độ, chuyển action qua Procedure API.
- Thêm `packages/modules/hrm/src/lib/infrastructure/hrm-procedure-sync.ts`: nhận kết quả, đối soát, khóa và áp dụng hiệu lực. `hrm-workflow.ts` trở thành adapter tương thích cho worker/sự kiện cũ, không tự khởi tạo theo đường riêng.
- Thêm `packages/modules/hrm/src/lib/infrastructure/hrm-request-transition.ts`: điểm gọi chung nghiệp vụ của các loại đơn; tái sử dụng `transitionLeave`, `approveOvertime`, `approveShiftChange`.
- Thêm `packages/features/hrm/src/lib/hrm-navigation.ts`: định nghĩa menu và lựa chọn menu lá active, tách khỏi render shell để kiểm tra được.
- Migrations mới dự kiến `0014-hrm-profile-compatibility.sql`, `0015-hrm-procedure-sync.sql`, `0016-hrm-lifecycle.sql`, `0017-hrm-request-drafts.sql`; không đổi tên file cũ. Kiểm tra lại tên còn trống lúc thực thi. Nếu task sau phát sinh thay đổi schema ngoài các file đã áp dụng, tạo migration tiếp theo thay vì sửa file đã chạy.
- Tests integration PostgreSQL theo mẫu `hrm-employee.integration.spec.ts`, tạo DB tạm ở localhost; không dùng dữ liệu tenant đang vận hành để thử migration phá vỡ.

Giao diện mới được các task dùng chung:

```ts
type HrmSyncStatus = 'START_PENDING' | 'RUNNING' | 'APPLY_PENDING' | 'APPLIED' | 'FAILED' | 'CONFLICT';
type HrmTerminalStatus = 'APPROVED' | 'REJECTED' | 'CANCELLED';
interface HrmRequestRef { tenantId: string; kind: HrmRequestKind; requestId: string; revision: number }
interface HrmSubmission extends HrmRequestRef {
  employeeId: string; initiatedBy: string; title: string;
  subTypeCode?: string; attributes: Record<string, unknown>;
}
interface HrmProcedureLink {
  id: string; ref: HrmRequestRef; instanceId: string | null; syncStatus: HrmSyncStatus;
}
```

Các type này đặt trong contracts HRM; `HrmRequestKind` giữ mã chữ thường đã có. DTO sửa dữ liệu thêm `expectedUpdatedAt: string`, trả 409 khi bản ghi đã bị người khác thay đổi. Controller dùng `{ data, meta? }` theo cấu trúc HRM hiện có; mọi lỗi có thông điệp nghiệp vụ.

## Task 1: Giải quyết xung đột và kết thúc rebase

**Files:** Sáu screen xung đột trong `packages/features/hrm/src/lib/screens/`: `approvals-screen.tsx`, `attendance-screen.tsx`, `employees-screen.tsx`, `profile-screen.tsx`, `requests-screen.tsx`, `shifts-screen.tsx`; `packages/modules/hrm/src/lib/module-hrm.module.ts`; năm controller xung đột trong `packages/modules/hrm/src/lib/presentation/`: `hrm-attendance.controller.ts`, `hrm-employee.controller.ts`, `hrm-leave.controller.ts`, `hrm-request.controller.ts`, `hrm-salary.controller.ts`.

**Interfaces:** Giữ các route cũ của cả hai phía khi không trùng; một route trùng chỉ có một handler. Giữ giải quyết employee/account của Tài và các trường/UI riêng của Hải. Chưa tuyên bố luồng Procedure dùng được trước task 5.

- [ ] Lưu bảng đối chiếu route/handler hai phiên bản từ `outputs/hrm-rebase-20260928`; dùng `:2:`/`:3:` từng đoạn, không chọn toàn bộ ours/theirs.
- [ ] Thêm `packages/modules/hrm/src/lib/presentation/hrm-routes.spec.ts`: metadata phải có POST `leave-requests`, route trùng method/path phải bằng rỗng; chưa kiểm tra khi còn marker làm parser lỗi.
- [ ] Hợp nhất 12 file; giữ form động, bảng công ma trận và tiến độ; ghép guard/quy tắc nghiệp vụ hiện có. Khôi phục decorator POST bị comment. Đăng ký đầy đủ controller/provider trong module.
- [ ] Chạy test route và kiểm tra cú pháp; nếu test bị lỗi import thì sửa đến khi có thể đánh giá route thật. Không thay kiểm tra API bằng đếm chuỗi decorator.
- [ ] `git diff --check`; `git diff --name-only --diff-filter=U` phải rỗng sau stage các tệp đã giải quyết. Dùng `git -c core.editor=true rebase --continue`; xác nhận trở lại đúng branch và `git merge-base --is-ancestor b39f7f9 HEAD` thành công.
- [ ] Commit riêng tài liệu thiết kế đã duyệt/kế hoạch sau khi rebase kết thúc; không đưa tài liệu này vô tình vào commit replay. Ghi lại SHA sau rebase để truy vết.

## Task 2: Schema hồ sơ, người thân, giảm trừ và registry migration

**Files:** Thêm `migrations/tenant/hrm/0014-hrm-profile-compatibility.sql`; sửa `packages/platform/entitlement/src/lib/tenant-migrations.ts`, `packages/modules/hrm/src/lib/presentation/hrm-employee.controller.ts`; thêm `packages/modules/hrm/src/lib/infrastructure/hrm-migrations.integration.spec.ts`. Giữ `hrm-dependent.controller.ts` là nghiệp vụ đăng ký giảm trừ.

**Interfaces:** Bảng mới `employee_family_members` chứa hồ sơ tự khai theo DTO `HrmEmployeeDependent`; bảng `employee_dependents` giữ đăng ký giảm trừ hiện hữu. `employment_contracts` dùng DTO hợp đồng hiện có và FK nhân viên theo tenant. Endpoint cũ tự khai được ánh xạ sang bảng mới, không đổi đột ngột UI.

- [ ] Viết test tenant mới và DB nâng cấp từ snapshot trước rebase: tự khai người thân không làm tăng số người giảm trừ; ID/hiệu lực đăng ký đã xác minh được giữ. Fixture có layout Hải và layout Tài để kiểm tra chuyển tiếp, không suy diễn mọi tenant có cùng schema.
- [ ] Chạy test xác nhận lỗi schema/registry hiện tại.
- [ ] Đăng ký nguyên tên hai migration Hải; thêm migration tương thích bổ sung cột hồ sơ và bảng hợp đồng. Nếu gặp cột/dữ liệu không thể tự ánh xạ, báo lỗi có hướng xử lý, không drop/recreate bảng đang có dữ liệu.
- [ ] Đảm bảo read/list/create/update nhân sự đều dùng employee ID độc lập user ID; bổ sung test nhân viên không có tài khoản.
- [ ] Chạy `pnpm nx run platform-entitlement:test --skipNxCache` và `pnpm nx run module-hrm:test --skipNxCache` với DB integration đã cấu hình. Chạy provisioning hai lần: lần hai không nhân bản dữ liệu, không sửa checksum cũ. Commit `fix(hrm): reconcile tenant schemas after rebase`.

## Task 3: Liên kết Procedure chuẩn và chuyển dữ liệu cũ

**Files:** Thêm `migrations/tenant/hrm/0015-hrm-procedure-sync.sql`, `packages/modules/hrm/src/lib/infrastructure/hrm-procedure-links.ts`, `hrm-procedure-links.integration.spec.ts`; sửa contracts HRM, registry migration và `hrm-operations.controller.ts`.

**Interfaces:** `prepareHrmProcedureLink(db: PoolClient, input: HrmSubmission): Promise<HrmProcedureLink | null>` chạy trong transaction tạo/gửi đơn. Null chỉ khi chế độ duyệt trực tiếp được cấu hình. Binding chụp definition/version và attributes cho lần gửi, unique `(tenant_id, kind, request_id, revision)`.

- [ ] Viết test ánh xạ cả bảy mã loại đơn cũ, binding subtype ưu tiên binding mặc định, hai cấu hình khác definition báo CONFLICT; bản ghi đang chạy giữ instance ID.
- [ ] Thiết kế bảng liên kết mới `procedure_links` và inbox `procedure_result_inbox`, cùng constraint tenant/instance/event. Không dùng `applied_at` của các bảng đơn làm chốt chống lặp.
- [ ] Migration backfill cả `workflow_links` lẫn `procedure_instance_id` trực tiếp. Hai instance khác nhau cho cùng đơn phải CONFLICT và chặn áp dụng; liên kết trùng cùng instance được hợp nhất. Giữ correlation cũ để đọc callback còn trên broker.
- [ ] Sửa trigger cũ chỉ ngừng tạo link theo cơ chế cũ; giữ thông báo/audit và thay guard để bảo vệ liên kết mới. Không xóa instance đang chạy.
- [ ] API vận hành dùng `request_procedure_bindings`, có mode trực tiếp/Procedure, không tìm definition theo tên gần giống. Instance đang chạy không nhận cấu hình mới.
- [ ] Chạy integration links và registry qua Nx; assertion `expect(instanceIdsAfter).toEqual(instanceIdsBefore)` với trường hợp một instance; CONFLICT không tạo instance bổ sung. Commit `feat(hrm): unify procedure links and migrate existing requests`.

## Task 4: Bridge khởi tạo và xử lý bước chính thức

**Files:** Sửa `hrm-procedure-bridge.service.ts`, `packages/contracts/procedure-engine/src/lib/procedure-engine.contracts.ts`, `packages/modules/procedure-engine/src/lib/application/procedure-engine.application.ts`; thêm `packages/modules/hrm/src/lib/infrastructure/hrm-procedure-bridge.spec.ts`; mở rộng `procedure-branching.application.spec.ts`.

**Interfaces:** Bridge cung cấp `startOrResume(pool: Pool, linkId: string, tenantId: string): Promise<HrmProcedureLink>` và `applyAction(request: Request, ref: HrmRequestRef, input: ApplyHrmWorkflowActionPayload & { idempotencyKey: string }): Promise<HrmProcedureLink>`. API tạo Procedure nhận `attributeValues?: Record<string, ProcedureAttributeValue>` ngay lúc khởi tạo; dùng response DTO thống nhất với ứng dụng thực tế.

- [ ] Test timeout sau khi phía Procedure đã commit rồi thử lại: `expect(uniqueInstanceCount).toBe(1)`. Test thuộc tính bước S dẫn sang đúng nhánh từ lần xử lý đầu tiên.
- [ ] Mở rộng API Procedure để kiểm tra/ghi thuộc tính trong transaction khởi tạo trước đánh giá flow. Bảo toàn test maintenance và các caller không truyền thuộc tính.
- [ ] Bridge gọi API sau commit đơn/link, có timeout và lưu lỗi; bỏ ghi SQL vào Procedure runtime/snapshot và fallback chọn quy trình ngẫu nhiên. GET tiến độ chỉ đọc, trả được tiến độ và syncStatus.
- [ ] Action dùng session người thao tác, ánh xạ APPROVE/REJECT/RETURN sang API Procedure; kiểm tra liên kết/tenant. Không dùng service actor để bỏ qua quyền người duyệt.
- [ ] Controller các loại đơn gọi `prepareHrmProcedureLink` cùng transaction tạo đơn, sau commit gọi bridge. Đổi ca SWAP chỉ được gửi Procedure sau peer confirmation; peer refusal không tạo instance.
- [ ] Chạy `pnpm nx run module-procedure-engine:test --skipNxCache` và `pnpm nx run module-hrm:test --skipNxCache`. Test duyệt bước 1 của flow 2 bước: đơn HRM chưa APPROVED. Commit `feat(hrm): retain Hai procedure bridge through official actions`.

## Task 5: Đồng bộ hiệu lực duy nhất, phục hồi và đối soát

**Files:** Thêm `hrm-procedure-sync.ts`, `hrm-request-transition.ts`, `hrm-procedure-sync.integration.spec.ts` trong infrastructure HRM; sửa `hrm-workflow.ts`, `apps/worker/src/main.ts`; tách logic điều chỉnh công/công tác/tạm ứng/hồ sơ từ các controller hiện hữu vào transition dùng chung.

**Interfaces:** `receiveHrmProcedureResult(pool: Pool, tenantId: string, event: IntegrationEventEnvelope): Promise<void>`; `processHrmProcedureSync(pool: Pool, tenantId: string): Promise<void>`; `applyHrmRequestResult(db: PoolClient, ref: HrmRequestRef, target: HrmTerminalStatus, actorId: string, reason?: string): Promise<void>`. Dùng `PROCEDURE_SYSTEM_ACTOR_ID` hợp lệ cho tác nhân kỹ thuật; người duyệt thật lưu riêng trong audit/result.

- [ ] Test sự kiện lặp và xử lý đồng thời: chỉ một ledger USAGE, một phân ca thay thế, một hiệu lực điều chỉnh. Test sai tenant/instance/revision bị từ chối; sự kiện đến trước response khởi tạo được lưu chờ đối chiếu.
- [ ] Triển khai inbox + khóa link/request; áp dụng nghiệp vụ và đánh dấu APPLIED trong cùng transaction. Lỗi kỳ khóa chuyển FAILED có lý do, thử lại không trừ phép/khấu trừ hai lần.
- [ ] Tái sử dụng `transitionLeave(db, tenant, actor, id, target, reason)`, `approveOvertime(db, tenant, actor, id)`, `approveShiftChange(db, tenant, actor, id)`; các loại còn lại tuân thủ cùng guard và transaction. Không fallback `system-procedure` vào UUID.
- [ ] Adapter worker nhận cả correlation cũ và mới, nhưng tất cả chuyển về một inbox/transition. Đối soát periodic đọc kết quả Procedure và gọi cùng receiver; GET không đồng bộ ngầm.
- [ ] Test từng loại đơn: nghỉ, OT, công tác, đổi ca, điều chỉnh công, tạm ứng, điều chỉnh hồ sơ. Kiểm tra REJECTED khác CANCELLED; dữ liệu hồ sơ thay đổi khi chờ duyệt trả conflict.
- [ ] Chạy test HRM/Procedure/worker và build HRM API, Procedure API, worker, migrator bằng Nx. Commit `feat(hrm): apply procedure outcomes once with recoverable sync`.

## Task 6: Nhân viên, chức danh và danh mục ngạch/bậc lương

**Files:** Sửa `hrm-employee.controller.ts`, `hrm-salary.controller.ts`, `employees-screen.tsx`, contracts HRM; thêm `migrations/tenant/hrm/0016-hrm-lifecycle.sql` và `packages/modules/hrm/src/lib/presentation/hrm-catalog-lifecycle.integration.spec.ts`.

**Interfaces:** Thêm PATCH/DELETE cho tài nguyên danh mục còn thiếu, giữ route đang có; `POST employees/:employeeId/deactivate` nhận `{ effectiveDate, reason, expectedUpdatedAt }`. DELETE danh mục đã tham chiếu trả 409 kèm đề nghị ngừng hiệu lực, không cascade giao dịch. Migration 0016 bổ sung version/lifecycle cần cho tasks 6–11, đăng ký registry.

- [ ] Test hai admin sửa cùng bản ghi: lần thứ hai 409; tenant khác không sửa được; nhân viên có bảng công không bị xóa mất lịch sử.
- [ ] Hoàn chỉnh vòng đời tạo/xem/sửa/ngừng nhân viên và chức danh/ngạch/bậc; kiểm tra nhân viên không có tài khoản và ngừng nhân viên không tự xóa account dùng module khác.
- [ ] UI hiển thị hành động theo quyền/trạng thái, cho lọc nhân viên ngừng hoạt động; form cập nhật nạp đúng dữ liệu và xử lý 409 bằng yêu cầu tải lại.
- [ ] Test API và thao tác UI của cả bản ghi mới/chưa dùng và bản ghi đã tham chiếu; chạy Nx HRM tests. Commit `feat(hrm): add employee and catalog lifecycle actions`.

## Task 7: Người thân, giảm trừ và hợp đồng

**Files:** Sửa `hrm-employee.controller.ts`, `hrm-dependent.controller.ts`, `profile-screen.tsx`, `employees-screen.tsx`, `dependents-screen.tsx`; thêm `packages/modules/hrm/src/lib/presentation/hrm-contract.controller.ts`, `hrm-family-contract.integration.spec.ts`; đăng ký module.

**Interfaces:** Hồ sơ người thân dùng các route `my-dependents`/`employees/:employeeId/dependents` hiện có; đăng ký giảm trừ dùng `/dependents`. Hợp đồng GET/POST `employees/:employeeId/contracts`, PATCH/DELETE `contracts/:id`, POST `contracts/:id/activate`, `/amendments`, `/terminate`; amendment lưu parentContractId và ngày hiệu lực.

- [ ] Test tự khai không tự tăng giảm trừ; nhân viên chỉ sửa hồ sơ của mình; sửa đăng ký có hiệu lực không vượt kỳ lương khóa.
- [ ] Cho sửa/xóa mềm hồ sơ gia đình, HR xác minh và điều chỉnh/kết thúc đăng ký giảm trừ có audit. Bản sửa cần expectedUpdatedAt và chứng từ nếu tác động giảm trừ.
- [ ] Hợp đồng mặc định DRAFT; sửa/xóa chỉ nháp, phát hành/ban hành theo quyền; sau hiệu lực tạo phụ lục/gia hạn hoặc chấm dứt có lý do. Giữ snapshot và file chứng từ, không tự thay lương đã chốt.
- [ ] Đưa hợp đồng trong chi tiết nhân viên, gia đình trong profile, giảm trừ riêng cho HR; test chuyển trạng thái API và xác minh UI 3 nhóm không dùng nhầm bảng.
- [ ] Chạy Nx HRM tests; commit `feat(hrm): separate family tax registration and contract lifecycle`.

## Task 8: Ca, phân ca, quy định công, lịch nghỉ và thiết bị

**Files:** Sửa `hrm-shift.controller.ts`, `hrm-time-settings.controller.ts`, `hrm-policy.controller.ts`, `shifts-screen.tsx`, `time-settings-screen.tsx`; thêm `packages/modules/hrm/src/lib/presentation/hrm-time-lifecycle.integration.spec.ts`.

**Interfaces:** PATCH/DELETE `shift-assignments/:id` cho kỳ mở; DELETE biểu thị hủy có lịch sử khi đã sử dụng. PATCH `time-settings/sites/:id`, POST `time-settings/sites/:id/deactivate`, DELETE `time-settings/calendar/:id`; phiên bản policy dùng lifecycle DRAFT/ACTIVE/SUPERSEDED hiện có.

- [ ] Test ca đêm qua ngày, ca trùng, lịch đã khóa; sửa ca/địa điểm không làm thay đổi chứng cứ raw attendance cũ. Thiết bị mới được duyệt phải xử lý thiết bị cũ theo chính sách một tài khoản/một thiết bị.
- [ ] Thêm sửa/hủy phân ca có lý do và khóa employee; từ chối khoảng trùng. Quy định công đã dùng tạo phiên bản theo hiệu lực; calendar kỳ mở sửa/xóa làm dữ liệu tính công liên quan cần tính lại.
- [ ] Thêm chỉnh sửa/ngừng địa điểm, kiểm tra IP/CIDR/GPS/bán kính; thu hồi/đổi thiết bị có audit, không xóa dấu vết xác thực.
- [ ] Bổ sung nút và form tương ứng, giữ bảng ma trận/ca của Hải; test API, UI lỗi/kết quả và Nx HRM tests. Commit `feat(hrm): manage time configuration and roster lifecycle`.

## Task 9: Phép, lịch cộng phép và vòng đời đơn từ

**Files:** Sửa `hrm-leave.controller.ts`, `hrm-request.controller.ts`, `hrm-attendance.controller.ts`, `hrm-profile-correction.controller.ts`, `leave-settings-screen.tsx`, `requests-screen.tsx`, `approvals-screen.tsx`; thêm `hrm-request-lifecycle.integration.spec.ts` trong presentation, `migrations/tenant/hrm/0017-hrm-request-drafts.sql` và đăng ký registry.

**Interfaces:** Các loại đơn có DRAFT trước gửi; thêm PATCH/DELETE cho đơn nháp và POST submit/withdraw trên route riêng từng loại đang có. Rút đơn đã gửi gọi Procedure cancel theo quyền và trạng thái; đơn có hiệu lực dùng cancel/amend có bút toán đảo. Lịch cộng phép PATCH/DELETE chỉ chưa dùng, POST deactivate/version khi đã dùng.

- [ ] Test tạo/sửa/xóa nháp không tạo instance/ledger; submit hai lần chỉ một instance; SWAP bắt buộc peer confirmation; withdraw không bị callback đến muộn phục hồi APPROVED sai revision.
- [ ] Hiển thị sửa/ngừng loại nghỉ từ API đã có; sửa lịch cộng chưa áp dụng, tạo phiên bản cho kỳ sau khi đã chạy. Job cộng/chuyển phép chạy lại không nhân đôi.
- [ ] Migration 0017 bổ sung DRAFT/revision và constraint tương ứng, không đổi trạng thái đơn hiện hữu. Chuẩn hóa form và action cho nghỉ/OT/công tác/đổi ca/điều chỉnh công/tạm ứng/hồ sơ; các trường động chỉ cho sửa ở bước được phép. Công tác vẫn liên kết dự án/đầu việc, kiểm tra ID theo tenant phía server.
- [ ] Điều chỉnh số dư phép có lý do và bút toán đối ứng; chặn sửa/xóa ledger. Đơn đã duyệt bị hủy phải đảo đúng hiệu lực và kiểm tra kỳ khóa.
- [ ] Chạy Nx HRM tests và kiểm tra UI mỗi loại đơn có ít nhất một ca sửa, rút/hủy, từ chối. Commit `feat(hrm): complete leave and request lifecycle operations`.

## Task 10: Bảng công và chứng từ

**Files:** Sửa `hrm-timesheet.controller.ts`, `hrm-attachment.controller.ts`, `timesheets-screen.tsx`, form chứng từ trong requests/profile; thêm `hrm-timesheet-lifecycle.integration.spec.ts` trong presentation.

**Interfaces:** PATCH/DELETE `timesheet-periods/:id` chỉ khi kỳ chưa khóa, không có dòng/giao dịch phụ thuộc; POST calculate/lock/reopen/adjust hiện có tiếp tục dùng. DELETE `attachments/:id` gỡ liên kết nháp, không xóa vật lý chứng từ đã được dùng.

- [ ] Test kỳ rỗng sửa/xóa được; kỳ có bảng công hoặc lương tham chiếu trả 409; tính lại giữ adjustment có audit, kỳ khóa không bị đơn đến sau sửa ngầm.
- [ ] Bổ sung sửa/xóa kỳ rỗng, lọc bất thường, kiểm tra mọi thành phần: công, phép, OFF, lễ, trễ/sớm, công tác, OT; hiển thị công thức/snapshot đủ giải thích kết quả.
- [ ] Chứng từ nháp được gỡ theo chủ sở hữu/quyền; chứng từ duyệt giữ bản gốc, thay thế bằng phiên bản có lịch sử. Test chống tải xuống hoặc gỡ chứng từ tenant khác.
- [ ] Chạy Nx HRM tests và UI lập kỳ → tính → điều chỉnh → khóa → từ chối sửa → mở lại theo quyền. Commit `feat(hrm): enforce timesheet and attachment lifecycle`.

## Task 11: Cấu hình lương, kỳ lương và tạm ứng

**Files:** Sửa `hrm-payroll-settings.controller.ts`, `hrm-payroll.controller.ts`, `hrm-salary.controller.ts`, `payroll-settings-screen.tsx`, `payroll-screen.tsx`; thêm `packages/features/hrm/src/lib/screens/advances-screen.tsx`, `apps/hrm-web/src/app/payroll/advances/page.tsx`, `hrm-payroll-lifecycle.integration.spec.ts` trong presentation.

**Interfaces:** PATCH/DELETE policy version và payroll input chỉ trước chốt; PATCH/DELETE `payroll-periods/:id` chỉ kỳ rỗng; POST `payroll-runs/:id/cancel` cho lần tính chưa FINALIZED. Tạm ứng tiếp tục route/API hiện có, tách màn hình ra khỏi leave-settings.

- [ ] Test cấu hình/số tiền đã chốt bất biến; input sửa/xóa đánh dấu run cần tính lại; công thức lỗi/chu trình bị từ chối trước áp dụng; dùng số tiền chính xác theo engine hiện có.
- [ ] UI/API cho sửa/xóa nháp, version theo hiệu lực, ngừng chính sách; công thức nối bảng công/OT/thưởng/phạt/trễ sớm/phụ thuộc/BHXH/khấu trừ như schema hiện có, không hardcode thêm mức pháp lý chưa được xác minh.
- [ ] Kỳ rỗng được sửa/xóa, lần tính nháp được hủy; phiếu đã phát hành giữ snapshot. Điều chỉnh sau chốt đi qua nghiệp vụ điều chỉnh, không update tổng đã chi.
- [ ] Tạm ứng có duyệt → chi → chia kỳ khấu trừ → đối soát; test tính lại lương không trừ hai lần và tổng khấu trừ không vượt số đã giải ngân.
- [ ] Chạy Nx HRM tests, kiểm tra UI công thức/các khoản/phiếu và màn hình tạm ứng mới. Commit `feat(hrm): complete payroll configuration and advance lifecycle`.

## Task 12: Menu, RBAC và UI nhất quán

**Files:** Thêm `packages/features/hrm/src/lib/hrm-navigation.ts`, `hrm-navigation.spec.ts`; sửa `hrm-shell.tsx`, `hrm-permissions.tsx`, `packages/contracts/identity/src/lib/tenant-authorization.ts`, `packages/platform/identity/src/lib/tenant-authorization.ts` và test tương ứng; sửa các screen ở tasks 6–11 theo UI chung.

**Interfaces:** `getActiveHrmNavId(pathname: string): string | null` chuẩn hóa `/modules/hrm`, trailing slash, chọn route lá cụ thể nhất. Export `hrmNavigation` có ID/href duy nhất. Cấu hình chấm công tab URL `?tab=rules|calendar|sites|devices`; unknown tab về tab đầu tiên được phép.

- [ ] Test tái hiện trước: `/policies` có hai menu active, `/payroll/settings` active cả parent. Sau sửa: `expect(getActiveHrmNavId('/modules/hrm/payroll/settings')).toBe('payroll_settings')`; menu cha chỉ expanded.
- [ ] Áp dụng đầy đủ bảng menu ở spec; gộp policies/devices, chuyển tạm ứng sang `/payroll/advances`; mỗi menu lá có route, component và API riêng đúng nghiệp vụ. Giữ deeplink cũ hoạt động hoặc redirect có chủ ý.
- [ ] Map tất cả action CRUD mới vào danh mục quyền và backend guard hiện hành; nếu cần quyền mới thêm ở cùng catalog/seed/UI. Không cho `hrm.read` sửa dữ liệu; màn hình còn mở sau thu hồi quyền phải xử lý 403.
- [ ] Bảng antd mật độ nhỏ, filter/search/pagination và thanh cuộn nội bộ; form dùng SearchableSelect; Popconfirm thao tác nguy hiểm, Drawer lịch sử; loading/empty/error thống nhất. Kiểm tra 1920×1080 và 1440×900.
- [ ] Chạy Nx feature-hrm/platform-identity/module-hrm tests; dùng react-doctor sau thay đổi React và phân biệt warning cũ/mới. Commit `fix(hrm): unify navigation permissions and dense business screens`.

## Task 13: Vận hành, thử lại và hiển thị lỗi có thể xử lý

**Files:** Sửa `hrm-operations.controller.ts`, `operations-screen.tsx`, `hrm-calendar-screen.tsx`, `hrm-automation.ts`; thêm `packages/modules/hrm/src/lib/presentation/hrm-operations.integration.spec.ts`.

**Interfaces:** POST retry hiện có chuyển sang link chuẩn, không được sửa trạng thái Procedure; GET operations trả trạng thái/lastError/attempts của link mới và legacy đã chuyển. Binding đang xung đột có thông báo xử lý rõ ràng, không có nút “duyệt tắt”.

- [ ] Test retry chạy đồng thời và job chạy lại không nhân đôi; chỉ quyền vận hành được retry, nhân viên chỉ thấy lỗi/tiến độ đơn của mình.
- [ ] Hoàn chỉnh UI chỉnh binding/mode theo loại đơn, phiên bản áp dụng cho lần gửi sau; bật/tắt/lịch automation và kết quả chạy. CONFLICT hiển thị các instance liên quan để HR xác minh, chặn tự động áp dụng kép.
- [ ] Thông báo đổi trạng thái chỉ phát từ transaction đã commit; đánh dấu đã đọc có scope; audit chỉ đọc, có lọc và chi tiết nguyên nhân.
- [ ] Chạy Nx HRM/worker tests; đối soát mô phỏng mất sự kiện phải khôi phục kết quả qua cùng inbox. Commit `feat(hrm): expose reliable workflow operations and recovery`.

## Task 14: Kiểm thử ERP toàn luồng và bàn giao

**Files:** Cập nhật `docs/ERP-114-implementation-and-UAT.md`, `docs/HRM-ERP114-chuc-nang-va-huong-dan.md`, `docs/HRM-RBAC-actions.md`; thêm `docs/HRM-ERP114-rebase-contributions.md`. Dữ liệu/screenshot/log kiểm thử vào `outputs/hrm-erp114-acceptance/`, không chứa mật khẩu/token.

**Interfaces:** Báo cáo có cột chức năng, API, UI, đầu ra, ca kiểm thử, kết quả, bằng chứng; không coi skipped integration test là pass. Danh sách đóng góp phân biệt Hải/Tài/Khánh và nền tảng dùng chung.

- [ ] Xác nhận Git sạch xung đột và target Nx. Chạy unit/integration thật trên DB tạm localhost (cấu hình `HRM_TEST_ADMIN_URL` từ môi trường, không in URL); test migration tenant mới/nâng cấp/khởi chạy lại.
- [ ] Chạy `pnpm nx run-many -t test -p module-hrm feature-hrm module-procedure-engine platform-entitlement platform-identity worker --skipNxCache`; xác nhận các target hiện có, thêm test thích hợp nếu chưa có target. Sửa lỗi theo tái hiện → test đỏ → sửa → test xanh.
- [ ] Chạy lint các project đã sửa và build `hrm-api`, `hrm-web`, `procedure-api`, `procedure-web`, `api`, `web`, `worker`, `migrator` qua Nx. Mở rộng sang app khác chỉ khi dependency thay đổi/test chỉ ra ảnh hưởng; không chạy lặp các check đã đạt khi mã không đổi.
- [ ] Kiểm tra process/cổng trước khi tự bật: `pnpm infra:up`, `pnpm db:provision`, `pnpm dev`, `pnpm dev:status`. Giữ gateway `http://localhost:8080`; không yêu cầu chạy HRM như hệ thống riêng.
- [ ] Trình duyệt: tạo nhân viên giả thuộc phòng ban/ca khác nhau; thử ca ngày/đêm/OFF/lễ, nhiều lần vào-ra, IP/GPS/thiết bị, tất cả loại đơn, Procedure hai bước có điều kiện, bảng công và bảng lương. Mỗi CRUD mới phải thử trường hợp cho phép và bị chặn theo quyền/trạng thái.
- [ ] Đối chiếu số liệu mẫu đã định trước với ledger/bảng công/payroll/phiếu lương, kể cả chạy lại. Kiểm tra employee tự phục vụ, người duyệt, HR, kế toán; từ chối truy cập chéo tenant và quyền vừa thu hồi. Nếu thiếu phiên đăng nhập, chỉ báo đúng bước bị chặn, không đánh dấu đạt giả.
- [ ] Hoàn thiện hướng dẫn thao tác và danh sách đóng góp từ commit/mã giữ lại; ghi rõ phần đạt/chưa đạt. Commit tài liệu và phần sửa đã kiểm chứng; không push/Jira cho đến khi chốt theo yêu cầu người dùng.

## Đối chiếu bao phủ thiết kế

| Yêu cầu thiết kế | Task thực hiện | Bằng chứng kết thúc |
|---|---|---|
| Commit/rebase, giữ đóng góp hai phía | 1, 14 | SHA, ancestry, route và bảng đóng góp |
| Schema/migration tương thích | 2, 3, 6 | Registry + DB mới/nâng cấp, chạy lại không trùng |
| Giữ bridge Hải, một đường đồng bộ | 3, 4, 5, 13 | Multi-step/dynamic form, retry/correlation/concurrency |
| CRUD nhân viên/danh mục/hợp đồng/giảm trừ | 6, 7 | API/UI + quyền + hiệu lực + lịch sử |
| CRUD ca/công/phép/đơn/chứng từ | 8, 9, 10 | Trạng thái mở/khóa, ledger và effect một lần |
| CRUD cấu hình/kỳ lương/tạm ứng | 11 | Formula, input, chốt/chi, khấu trừ và snapshot |
| Menu riêng, nhóm tương đồng, UI đồng nhất | 12 | Active route tests + browser các kích thước |
| Automation/thông báo/quyền động | 12, 13 | Revocation, retry, scope, audit |
| Nghiệm thu toàn luồng và hướng dẫn | 14 | Bằng chứng trực tiếp gateway/API/DB, không dựa vào test trước rebase |

## Handoff

Kế hoạch đã tự rà soát đối chiếu spec; chưa triển khai các task và chưa đánh dấu đạt. Đề xuất **Native**: một agent thực hiện tuần tự trong phiên này vì rebase/schema/đồng bộ dùng chung nhiều tệp; sau cùng review độc lập trước kết luận. Phương án **Subagent-driven** dùng implementer/reviewer riêng từng task, tăng độ độc lập nhưng tốn nhiều lượt phối hợp. Người dùng chọn cách thực hiện sau khi review kế hoạch; không tạo worktree ở cả hai cách.
