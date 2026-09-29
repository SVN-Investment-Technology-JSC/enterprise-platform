# HRM ERP-114 — Đóng góp giữ lại sau rebase

Cập nhật **29/09/2026**. Tài liệu này ghi nguồn đóng góp đã giữ trong nhánh `ngtantai/tenant-dynamic-rbac` sau rebase và chuỗi tích hợp ERP-114. Mục tiêu là truy vết kỹ thuật, không dùng để suy diễn quyền sở hữu toàn bộ module.

## Mốc rebase và tích hợp

- Mốc mã trước rebase của nhánh triển khai: `1fbc9da`; nhánh dự phòng được ghi trong kế hoạch là `codex/hrm-before-hai-rebase-20260928`.
- Mốc phía Hải dùng làm đích tích hợp: `b39f7f9`.
- Thiết kế/kế hoạch sau rebase được commit ở `029871d` — `docs(hrm): record approved integration design and execution plan`.
- Chuỗi Task 2–13 sau đó đi từ `d44d774` đến `8b851f3`.
- Không push và không cập nhật Jira trong đợt bàn giao này.

## Hải — HRM và bridge Procedure trước tích hợp

Các commit còn hiện rõ trong lịch sử và được giữ/tiếp tục sử dụng:

| Commit | Phần đóng góp giữ lại |
|---|---|
| `b39f7f9` | Dynamic Procedure Node S attributes, hybrid form payload, `dynamic-attribute-form`, bridge HRM ↔ Procedure và các controller leave/request/salary liên quan |
| `16bbbc0` | Leave unpaid logic, request sorting/filter, shift assignment join và cải tiến màn request/profile |
| `bbb5f13` | Liên kết business trip với Workspace project qua SearchableSelect/API |
| `726c588` | Tinh gọn tab attendance/request trong personal profile |

Khi hợp nhất, các phần này không bị thay bằng một workflow engine HRM riêng. Bridge và dynamic attributes được đưa vào canonical Procedure path, còn các API/UI hữu ích tiếp tục được giữ rồi bổ sung guard, lifecycle và conflict handling.

## Khánh — nền Procedure/organization dùng chung

Các phần nền tảng được HRM dùng lại thay vì nhân bản:

| Commit | Phần đóng góp dùng chung |
|---|---|
| `aaa6a8d` | Contracts/condition/flow chung cho Procedure branching |
| `789e91d` | Runtime branching, step attributes, dynamic assignment/direct-manager, controller và test Procedure |
| `5c9d917` | Quan hệ báo cáo giữa chức danh và chuỗi quản lý trực tiếp |
| `311fb41` | Hồ sơ nhân sự hiển thị quản lý trực tiếp và override theo chức danh ở web chung |
| `9d33ef0` | UI Procedure cho nhánh, thuộc tính, cấu hình bước và chức danh |

Task 4–5 của ERP-114 mở rộng contract/action cần thiết cho HRM nhưng giữ Procedure Engine là nguồn trạng thái quy trình chính thức.

## Tài — hợp nhất, tương thích schema và hoàn thiện ERP-114

| Task | Commit | Phần chính |
|---|---|---|
| Nền RBAC trước rebase | `36d00e2`, `110e07e` | RBAC động và đợt tích hợp HRM ban đầu |
| Task 2 | `d44d774` | Tương thích schema tenant sau rebase, profile/family/contracts, registry migration |
| Task 3 | `4075dc8` | Canonical `procedure_links`, migration dữ liệu cũ, conflict/correlation |
| Task 4 | `f88f497` | Một đường Procedure action/bridge, outcome có thể phục hồi |
| Task 5 | `d3f900b` | Kết quả authoritative, áp dụng hiệu lực duy nhất và live-state correction |
| Task 6 | `3b39819`, `47fccc2` | Employee/catalog lifecycle, profile editing và JD recovery |
| Task 7 | `3bc027c` | Contract lifecycle và thứ tự ưu tiên nghiệp vụ lõi |
| Task 8 | `1d4f254` | Time configuration, roster/shift/device lifecycle |
| Task 9 | `acd0c92` | Request drafts, leave schedules, withdraw/reversal có audit |
| Task 10 | `9596137` | Timesheet và attachment lifecycle |
| Task 11 | `1690035` | Payroll configuration và advance lifecycle |
| Task 12 | `dd4cb22` | Navigation/RBAC thống nhất, permission refresh và dense business UI |
| Task 13 | `8b851f3` | Operations canonical metadata, retry/concurrency, reconciliation, conflict UI, self workflow progress |

## Điểm hợp nhất quan trọng

- Giữ dynamic form/conditional branching từ nhánh Hải và nền Procedure branching của Khánh, nhưng mọi đơn HRM đi qua canonical link của HRM thay vì hai cơ chế song song.
- Backfill giữ instance đang chạy; hai instance khác nhau cho cùng đơn được đánh dấu `CONFLICT` thay vì tự chọn hoặc tạo thêm instance.
- Binding theo loại + subtype chụp definition/version cho lần gửi; thay đổi cấu hình chỉ ảnh hưởng lần gửi sau.
- Kết quả Procedure đi qua inbox idempotent và transaction HRM; retry không sửa trạng thái Procedure instance.
- Employee ID vẫn độc lập User ID; self-scope dựa trên liên kết tài khoản hiện hành, không suy diễn từ ID client gửi lên.
- Navigation và action visibility dùng cùng permission model; API vẫn là lớp quyết định cuối cùng khi quyền bị thu hồi trong lúc mở trang.

## Phần ngoài phạm vi chưa sửa trong Task 14

`apps/web` hiện có phần quản trị roles/plans từ commit RBAC cũ chưa khớp contract/API thực tế, làm `web:typecheck` thất bại. Vì các checkpoint trước rebase cũng có cùng lỗi và API plans chưa hoàn chỉnh, Task 14 ghi nhận đây là blocker nền tảng thay vì thêm type giả chỉ để build xanh. Chi tiết nằm trong [ERP-114-implementation-and-UAT.md](ERP-114-implementation-and-UAT.md).
