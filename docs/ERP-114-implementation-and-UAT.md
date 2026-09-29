# ERP-114 — Biên bản triển khai, kiểm thử và bàn giao

Cập nhật **29/09/2026** trên nhánh `ngtantai/tenant-dynamic-rbac`. Các Task 1–13 của kế hoạch `docs/superpowers/plans/2026-09-28-hrm-erp114-integration-plan.md` đã được triển khai và commit. Task 14 đang chốt bằng chứng kiểm thử/bàn giao. **Chưa push và chưa cập nhật Jira.**

## 1. Trạng thái bàn giao

HRM hiện dùng chung gateway ERP (`/modules/hrm`, `/api/hrm`) và cơ chế tenant/session/RBAC của nền tảng. Phần tích hợp Procedure đã được chuyển về một liên kết chuẩn cho bảy loại đơn, có snapshot definition/version lúc gửi, đồng bộ kết quả idempotent, trạng thái lỗi/xung đột có thể quan sát và retry có kiểm soát. Các màn hình HRM dùng cùng nguồn định nghĩa navigation/quyền, có xử lý thu hồi quyền và 403 trong lúc đang mở trang.

Các commit cuối của chuỗi triển khai:

| Phạm vi | Commit |
|---|---|
| Schema tương thích sau rebase | `d44d774` — `fix(hrm): reconcile tenant schemas after rebase` |
| Liên kết Procedure chuẩn | `4075dc8` — `feat(hrm): unify procedure links and migrate existing requests` |
| Bridge/action Procedure | `f88f497` — `feat(hrm): unify procedure actions and recoverable outcome sync` |
| Đồng bộ kết quả | `d3f900b` — `fix(hrm): show authoritative request outcomes during live testing` |
| Nhân viên/danh mục/hồ sơ | `3b39819`, `47fccc2`, `3bc027c` |
| Ca/công/phép/đơn | `1d4f254`, `acd0c92`, `9596137` |
| Lương/tạm ứng | `1690035` |
| Menu/RBAC/UI | `dd4cb22` — `fix(hrm): unify navigation permissions and dense business screens` |
| Vận hành/retry/đối soát | `8b851f3` — `feat(hrm): expose reliable workflow operations and recovery` |

Danh sách đóng góp trước/sau rebase được ghi riêng tại [HRM-ERP114-rebase-contributions.md](HRM-ERP114-rebase-contributions.md).

## 2. Ma trận chức năng và bằng chứng

| Chức năng | API/contract chính | UI | Đầu ra nghiệp vụ | Ca kiểm thử/bằng chứng | Kết quả |
|---|---|---|---|---|---|
| Hồ sơ nhân viên và vòng đời | `/v1/employees`, profile, dependents, contracts | `/employees`, `/profile`, `/dependents` | Employee độc lập User; optimistic concurrency; hợp đồng/người thân không ghi đè dữ liệu cũ | PostgreSQL integration HRM, lifecycle specs | Đạt tự động; browser UAT còn bị chặn |
| Ca, công, policy, thiết bị | shift/time/attendance controllers | `/shifts`, `/attendance`, `/policies` | Ca ngày/đêm, phân ca, WORK/OFF/HOLIDAY, IP/GPS/device, nhiều IN/OUT và giải trình | lifecycle/unit/integration specs | Đạt tự động |
| Phép và 7 loại đơn | request drafts + request controllers | `/requests`, `/approvals`, `/leave-settings` | Draft, submit, withdraw/reverse có audit; quỹ phép chống lặp; trạng thái authoritative | request/leave lifecycle specs | Đạt tự động |
| Procedure binding | `/v1/operations/workflow-rules`, Procedure bridge | `/operations` | `DIRECT` hoặc `PROCEDURE` theo loại + subtype; cấu hình mới chỉ áp dụng lần gửi sau | procedure-link/bridge/sync tests | Đạt tự động |
| Liên kết Procedure chuẩn | `HrmRequestKind`, `procedure_links`, `procedure_result_inbox` | `/operations`, `/calendar` | 7 loại: leave, OT, công tác, đổi ca, giải trình, tạm ứng, sửa hồ sơ; chụp definition/version; một hiệu lực | migration/link/concurrency tests | Đạt tự động |
| Phục hồi/xung đột | `/v1/operations`, `/v1/operations/workflows/:id/retry` | `/operations` | Hiển thị attempts, `last_error`, legacy link, related instances; chỉ retry `FAILED`; `CONFLICT` không duyệt tắt | `hrm-operations.integration.spec.ts` | Đạt tự động |
| Automation quỹ phép | `/v1/operations/automation`, `/run` | `/operations` | Cấu hình lịch, lịch sử run, cập nhật settings + run trong transaction | automation/reconciliation tests | Đạt tự động |
| Lịch/thông báo/tiến độ | `/v1/my-calendar`, `/v1/my-notifications`, `/v1/request-workflows` | `/calendar` | Self-scope; đánh dấu đọc có scope; xem tiến độ Procedure/attempt/error của đơn mình | permission/scope integration tests | Đạt tự động |
| Bảng công/chứng từ | timesheet/attachment controllers | `/timesheets` | Lock/reopen có điều kiện, ledger/adjustment, export, attachment lifecycle | timesheet + attachment lifecycle tests | Đạt tự động |
| Lương/tạm ứng | payroll/salary/advance controllers | `/payroll`, `/payroll/settings`, `/payslips` | Snapshot nguồn/công thức, finalize/publish/pay/export, thu hồi tạm ứng một lần | payroll lifecycle integration tests | Đạt tự động |
| RBAC động | `TENANT_PERMISSION_ACTIONS` và guard HRM | menu/action toàn HRM | 51 action HRM, quyền self/toàn tenant, navigation theo quyền hiện tại | feature/module tests + lint | Đạt tự động; UAT nhiều vai trò còn cần thực hiện |

## 3. Mô hình Procedure sau tích hợp

`HrmRequestKind` hiện gồm `leave`, `ot`, `business_trip`, `shift_change`, `correction`, `advance`, `profile_correction`. Khi gửi đơn, HRM chọn binding theo loại + subtype, ưu tiên subtype cụ thể. Chế độ `DIRECT` giữ phê duyệt trong HRM; chế độ `PROCEDURE` tạo/khôi phục liên kết chuẩn và chụp definition/version tại thời điểm gửi để thay đổi cấu hình sau đó không làm đổi đơn đang chạy.

Trạng thái đồng bộ chuẩn là `START_PENDING`, `RUNNING`, `APPLY_PENDING`, `APPLIED`, `FAILED`, `CONFLICT`. Callback/reconciliation đi qua cùng inbox idempotent. `CONFLICT` giữ danh sách instance liên quan để vận hành xác minh; hệ thống không tự chọn một instance và không cung cấp đường “duyệt tắt”. Retry chỉ được xếp hàng cho `FAILED`, giữ `last_error` làm nguyên nhân gốc và không sửa trạng thái Procedure instance.

## 4. Bằng chứng kiểm thử ngày 29/09/2026

Log Task 14 được lưu trong `outputs/hrm-erp114-acceptance/` và không chứa token/mật khẩu.

| Kiểm tra | Kết quả thực tế |
|---|---|
| `run-many test` 6 project, không truyền DB env | Nx đạt. `feature-hrm`: **6 suites / 15 tests pass**. `module-procedure-engine`: **5 / 88 pass**. `platform-entitlement`: **5 pass, 1 integration skip**. `platform-identity`: **43 pass, 14 integration skip**. `module-hrm`: **33 pass, 96 integration skip**. `worker:test`: không có test và thoát 0. Skipped test không được tính là pass. Log: `task14-tests-no-db-env.txt`. |
| HRM PostgreSQL integration ngay trước Task 14 | Lượt đã xác minh trong cùng phiên làm việc: **18 suites / 129 tests pass** với PostgreSQL tạm local; gồm migration, canonical links, lifecycle và operations/recovery. Không có thay đổi mã HRM sau lượt này ngoài tài liệu. |
| Platform Identity DB integration trước Task 14 | Lượt đã xác minh ở Task 12: **8 suites / 57 tests pass**. Lượt Task 14 hiện tại không thể truyền lại DB URL qua bridge dù `.env` có `TENANT_DATABASE_ADMIN_URL`; không dùng kết quả skip để thay thế. |
| Lint 8 app | `hrm-api`, `hrm-web`, `procedure-api`, `procedure-web`, `api`, `web`, `worker`, `migrator` đều đạt; còn **1 warning cũ** tại `apps/web/.../organization-flow.tsx`. Log: `task14-lint-apps.txt`. |
| Build 8 app | `procedure-api`, `procedure-web`, `api`, `hrm-api`, `hrm-web` build hiển thị đạt. Toàn run thất bại do `web:typecheck`; `web:build` không chạy. Worker/migrator production task được khởi chạy và không phát sinh lỗi riêng trước khi Nx kết thúc. Log: `task14-build-apps.txt`. |
| `web:typecheck` | **Không đạt — blocker ngoài HRM.** 13 lỗi từ phần role/plan của commit RBAC cũ: thiếu `TenantRoleSummary`, `PlanSummary`, `PlanLimit`; thiếu `DialogFooter`; navigation chưa có key `plans`; các lỗi implicit-any kéo theo. |
| React Doctor feature HRM | **47/100, 148 warnings**, cùng số lượng với Task 12. Vẫn còn nợ component lớn/format locale và các cảnh báo sẵn có; không tuyên bố đã sạch nợ UI. |

### Vì sao không sửa `web:typecheck` trong Task 14

Các file lỗi được đưa vào từ commit `36d00e2 feat(rbac): implement tenant dynamic rbac and permission management` và các checkpoint trước rebase cũng có cùng import thiếu. Đây không phải mất code do rebase HRM. API `tenant-roles` thực tế trả `TenantRole` từ contracts identity với shape khác UI `TenantRoleSummary`; còn `/api/platform/v1/plans` chưa có controller tương ứng dù UI đã gọi. Chỉ thêm type giả để build xanh sẽ che một phần RBAC/plan chưa hoàn chỉnh, nên Task 14 ghi nhận blocker thay vì mở rộng thành refactor nền tảng không liên quan HRM.

## 5. Runtime và browser UAT

Ở lượt kiểm tra local trước Task 14, `pnpm infra:up` đã thành công và `pnpm dev` từng đưa các service lên qua gateway `http://localhost:8080`. Tuy nhiên `pnpm db:provision` hiện dừng ở **checksum mismatch `platform-core/0006-tenant-deletion`**. Không reset/xóa database để né mismatch.

Fixture đăng nhập “Quản trị SAVINA” trên DB local hiện trả **“Email hoặc mật khẩu không đúng”**, phù hợp với trạng thái DB/seed cũ sau provision thất bại. Vì vậy chưa thể thực hiện trung thực browser UAT tạo dữ liệu mới cho ca ngày/đêm/OFF/lễ, nhiều IN/OUT, bảy loại đơn, Procedure nhiều bước, công, lương, self-service, HR/kế toán, cross-tenant và thu hồi quyền. **Không đánh dấu các ca browser này là đạt.**

## 6. Điều kiện còn lại trước khi nghiệm thu nghiệp vụ

1. Sửa riêng phần platform RBAC/plan để `web:typecheck` và build 8 app cùng đạt, với contract/API thật thay vì type giả.
2. Giải quyết checksum local theo quy trình migration hợp lệ, provision lại không phá dữ liệu, sau đó xác nhận fixture đăng nhập.
3. Chạy browser UAT qua gateway với dữ liệu giả có kiểm soát và nhiều vai trò thật; đối chiếu ledger/bảng công/payroll với số liệu mẫu định trước.
4. Kiểm tra storage/chứng từ và các luồng broker/Procedure thực thay vì chỉ mock đầu nối trong integration test.
5. HR/kế toán ký xác nhận chính sách, công thức và chênh lệch mẫu. Các mức thuế/BHXH/OT trong fixture không phải cấu hình pháp lý mặc định cho doanh nghiệp.

Jira vẫn giữ nguyên và nhánh **chưa push** theo yêu cầu người dùng.
