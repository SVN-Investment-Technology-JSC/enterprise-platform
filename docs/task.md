# Công việc ngoài dự án (Giao việc lẻ) — Module Workspace

Ngày cập nhật: 14/10/2026 · Nhánh: `dev/release-2`

## 1. Mục tiêu

Cho phép một cá nhân giao một công việc **không thuộc dự án nào** cho người khác trong tổ chức, theo dõi tiến độ và duyệt kết quả.

Thêm trang **"Công việc ngoài dự án"** trên thanh bên của Không gian làm việc, nằm **dưới "Công việc của tôi" và trên "Tài liệu"**.

## 2. Các quyết định đã chốt

| # | Câu hỏi | Quyết định |
|---|---------|-----------|
| 1 | Giao cho ai? | **Bất kỳ ai** trong tenant (có trong danh bạ tổ chức). Không giới hạn theo cấp bậc hay đơn vị. |
| 2 | Ai đóng việc? | Người thực hiện chỉ đưa việc tới **Chờ duyệt**. Chỉ **người giao** được bấm **Hoàn thành**. |
| 3 | Báo cáo? | **Không** đưa vào trang Báo cáo. |
| 4 | Ai tạo việc con? | **Người giao và người phụ trách** của việc cha. Người tạo việc con là người giao của việc con đó. |
| 5 | Việc con có cần duyệt? | **Không**: người thực hiện việc con tự Hoàn thành. Chỉ việc gốc cần người giao duyệt. |
| 6 | Hồ sơ quy trình hoàn tất thì sao? | Việc gốc **tự chuyển sang Chờ duyệt**, người giao vẫn bấm Hoàn thành. Việc con thì tự Hoàn thành. |
| 7 | Lồng tối đa mấy cấp? | **10 cấp**, như công việc dự án. |
| 8 | Huỷ kết quả đã hoàn thành? | Có trạng thái **Đã huỷ hiệu lực** riêng cho việc ngoài dự án (mục 4.3). |

Quyết định kỹ thuật:

- **Bảng riêng** `standalone_tasks`, không dùng lại `work_items`. Bảng `work_items` có `project_id NOT NULL` và gắn chặt với WBS, quyền thành viên dự án, tài chính, chat, báo cáo. Cho phép `project_id` rỗng sẽ phải thêm nhánh đặc biệt ở mọi chỗ đó.
- Dùng **chung bộ trạng thái và mức ưu tiên** với công việc dự án (`WORK_ITEM_STATUSES`, `WORK_ITEM_PRIORITIES`), để người dùng thấy cùng một cách gọi.
- Mã việc dạng `GV001`, đánh số chung toàn tenant.

## 3. Vai và quyền

Quyền trên mỗi việc suy từ **vai của người đang xem trên chính việc đó**. Không có khái niệm dự án ở đây.

| Vai | Xem | Sửa nội dung | Cập nhật tiến độ | Đổi trạng thái | Duyệt / Trả lại | Huỷ | Xoá |
|-----|-----|--------------|------------------|----------------|-----------------|-----|-----|
| Người giao (`assigner`, = `created_by`) | Có | Có | Có | Mọi bước hợp lệ | Có | Có (bắt buộc lý do) | Có, chỉ khi việc ở Chưa làm hoặc Đã huỷ |
| Người phụ trách (`assignee`) | Có | Không | Có | Tới Chờ duyệt | Không | Không | Không |
| Người cùng thực hiện (`participant`) | Có | Không | Có | Tới Chờ duyệt | Không | Không | Không |
| Người theo dõi (`follower`) | Có | Không | Không | Không | Không | Không | Không |
| Người liên quan qua cây (`viewer`): có vai ở việc cha hoặc việc con | Có | Không | Không | Không | Không | Không | Không |
| Người không liên quan | **404** | | | | | | |

- Người không liên quan nhận **404, kể cả quản trị tenant**. Trả 403 sẽ tiết lộ rằng việc đó tồn tại. Việc giao lẻ là chuyện giữa những người trong việc, giống quy tắc của trang "Công việc của tôi".
- Một người chỉ giữ **một vai** trên một việc. Người phụ trách bị loại khỏi danh sách cùng thực hiện và theo dõi; người cùng thực hiện bị loại khỏi danh sách theo dõi.
- Ở tầng guard, mọi thao tác ghi vẫn đòi quyền nền tảng `workspace.task.write`, giống công việc dự án. Không có action mới.

## 4. Luồng trạng thái

```
            ┌──────────── Huỷ (người giao, bắt buộc lý do) ─────────────┐
            ▼                                                            │
Chưa làm ──► Đang làm ──► Chờ duyệt ──► Hoàn thành (chỉ người giao)       │
   ▲  │        ▲  │  ▲        │   ▲             │                         │
   │  └► Vướng mắc ◄┘ │        │   │             └── Mở lại (người giao) ──┘
   │               └── Trả lại (người giao, bắt buộc lý do)
   │               └── Rút lại (người thực hiện)
   └── Mở lại từ Đã huỷ (người giao)
```

Bảng chuyển được định nghĩa ở `STANDALONE_TASK_STATUS_TRANSITIONS`. Hàm `allowedStandaloneTaskTransitions(task, role)` trong `packages/contracts/workspace` lọc bảng này theo vai và **dùng chung cho cả server lẫn giao diện**.

| Từ \ Sang | Người giao | Người thực hiện |
|-----------|-----------|-----------------|
| Chưa làm | Đang làm, Vướng mắc, Đã huỷ | Đang làm, Vướng mắc |
| Đang làm | Chưa làm, Vướng mắc, Chờ duyệt, Đã huỷ | Chưa làm, Vướng mắc, Chờ duyệt |
| Vướng mắc | Chưa làm, Đang làm, Đã huỷ | Chưa làm, Đang làm |
| Chờ duyệt | **Hoàn thành**, Trả lại (→ Đang làm), Đã huỷ | Rút lại (→ Đang làm) |
| Hoàn thành | Mở lại (→ Đang làm) | — |
| Đã huỷ | Mở lại (→ Chưa làm) | — |

Ngoại lệ: nếu **tự giao cho chính mình** (người phụ trách là người giao) thì không có ai khác để duyệt, nên được đi thẳng từ Đang làm sang Hoàn thành.

Các mốc thời gian tự động ghi:

- `actual_start` được ghi lần đầu khi chuyển sang Đang làm.
- `actual_end` được ghi khi chuyển sang Hoàn thành hoặc Đã huỷ, và xoá khi mở lại.
- Tiến độ thành 100% khi Hoàn thành, về 0% khi về Chưa làm.

Chống ghi đè: câu `UPDATE` kèm điều kiện `AND status = <trạng thái lúc đọc>`. Nếu có người đổi trạng thái trước, người bấm sau nhận **409** "Công việc vừa được người khác cập nhật".

### 4.1. Việc con

- Việc con được tạo khi việc cha chưa đóng, tối đa 10 cấp. Chỉ người giao hoặc người phụ trách của việc cha được tạo.
- Việc con **không có bước duyệt**:
  - Người thực hiện: Đang làm → Hoàn thành, và tự mở lại được.
  - Huỷ vẫn chỉ người giao của việc con làm được.
- Việc cha **không gửi duyệt, hoàn thành hay huỷ được** khi còn việc con chưa xong.
- Tiến độ việc cha **tự tính**: trung bình tiến độ các việc con chưa huỷ, cộng dồn lên tới việc gốc. Không sửa tay được.
- Xoá việc cha là xoá cả cây con, nên chỉ xoá được khi **mọi việc trong cây** đều Chưa làm hoặc Đã huỷ.
- Ai có vai ở bất kỳ việc nào trong cây đều xem được cả cây (vai `viewer`) để nắm bối cảnh, nhưng không thao tác được.

### 4.2. Theo quy trình

1. Khi tạo việc, chọn "Cách thực hiện: Theo quy trình" và một quy trình đã công bố mà **người giao có vai S**.
2. Workspace phát `workspace.standalone_task.procedure_requested`. Module Quy trình mở hồ sơ dưới danh nghĩa người giao (kiểm vai S như khi họ tự bấm), tên hồ sơ dạng `GV012-<tên việc>`.
3. Module Quy trình báo lại kết quả mở hồ sơ:
   - mở được: `procedure.instance.started_for_standalone_task`;
   - không mở được: `procedure.instance.standalone_task_start_rejected`.
4. Khi hồ sơ đóng (`procedure.instance.completed`, nguồn `workspace_standalone_task`):
   - **hoàn tất**: việc gốc tự sang Chờ duyệt, việc con tự Hoàn thành, tiến độ thành 100%. Nhật ký ghi "Hệ thống (theo hồ sơ quy trình)".
   - **bị từ chối hoặc bị huỷ**: chỉ ghi nhận và báo người giao cùng người thực hiện; trạng thái việc giữ nguyên để xử lý bằng tay.
5. Trong lúc hồ sơ đang mở hoặc đang chạy, **không ai đưa việc tới Chờ duyệt hay Hoàn thành bằng tay**. Người giao vẫn huỷ được.
6. Cách thực hiện không đổi được sau khi tạo.

### 4.3. Huỷ hiệu lực

- Chỉ **người giao** mới huỷ hiệu lực được, chỉ với việc **đã Hoàn thành**, và bắt buộc ghi lý do (ít nhất 3 ký tự).
- Việc chuyển sang **Đã huỷ hiệu lực**. Đây là trạng thái cuối: không mở lại, không đổi trạng thái, không xoá được (giữ vết).
  - Về lưu trữ: `status = 'cancelled'` kèm `reversed_at`, `reversed_by`, `reversal_reason`, giống cách làm của công việc dự án.
  - Giao diện hiện nhãn và màu riêng, và có lựa chọn riêng trong bộ lọc.
- Còn việc con chưa huỷ thì phải huỷ hiệu lực từng việc con trước, cùng luật với công việc dự án.
- Việc có hồ sơ quy trình đã hoàn tất:
  1. Workspace hỏi module Quy trình trước (`reversal-check`). Quy trình không cho thì chặn ngay và nêu lý do.
  2. Huỷ xong thì phát `workspace.standalone_task.reversed`; module Quy trình huỷ hiệu lực hồ sơ theo.
- Chiều ngược lại: hồ sơ bị huỷ hiệu lực bên module Quy trình (`procedure.instance.reversed`, nguồn `workspace_standalone_task`) thì việc tự huỷ hiệu lực theo, lý do ghi "Hồ sơ X bị huỷ hiệu lực: …".
  - Không có vòng lặp: nhận lại sự kiện cho việc đã huỷ hiệu lực thì không làm gì thêm.
- Thông báo `workspace.standalone-task.reversed` gửi tới người giao, người thực hiện và người theo dõi (trừ người vừa thao tác).
- API: `POST /standalone-tasks/:id/reverse` với body `{ reason, createAdjustment? }`. Chi tiết việc có thêm `canReverse`.

### 4.4. Lập công việc điều chỉnh

- **Lúc huỷ hiệu lực:** thao tác qua hộp thoại (Dialog) có ô lý do và ô **"Lập công việc điều chỉnh"** (mặc định bật). Huỷ xong thì form giao việc mở ra ở chế độ "Lập công việc điều chỉnh", điền sẵn từ việc cũ:
  - tên `Điều chỉnh GVxxx: <tên cũ>`, mô tả, ưu tiên, người phụ trách, người cùng làm, người theo dõi;
  - cách thực hiện và quy trình giống việc cũ (đổi được); lịch để trống.
- **Việc điều chỉnh:**
  - là việc gốc mới (không làm việc con được), có `adjustment_of_id` trỏ về việc đã huỷ hiệu lực;
  - chỉ người giao của việc cũ được lập; chỉ lập cho việc đã huỷ hiệu lực;
  - mỗi việc cũ chỉ có **một** việc điều chỉnh còn hiệu lực (unique index `standalone_tasks_one_open_adjustment`). Việc điều chỉnh bị huỷ thì lập được việc mới; mở lại việc điều chỉnh cũ khi đã có việc mới thì bị chặn kèm thông báo rõ.
- **Theo quy trình:** việc điều chỉnh tạo theo quy trình thì Workspace nhờ Quy trình mở **hồ sơ mới**. Hồ sơ cũ đã bị huỷ hiệu lực theo việc cũ. Workspace không nhờ Quy trình lập "hồ sơ điều chỉnh", vì hồ sơ đó không gắn ngược được về việc ngoài dự án.
- **Huỷ từ phía Quy trình có yêu cầu điều chỉnh** (`adjustmentRequested`): việc ghi nhận `adjustment_requested`, thông báo kèm "cần lập công việc điều chỉnh", và người giao có nút "Lập công việc điều chỉnh".
- **Bỏ ô điều chỉnh lúc huỷ:** người giao vẫn lập được về sau bằng nút "Lập công việc điều chỉnh" ở việc đã huỷ hiệu lực.
- **Hiển thị:** việc cũ ghi "Công việc điều chỉnh: GVxxx" (bấm mở được, kèm "(đã huỷ)" nếu việc đó đã huỷ); việc điều chỉnh ghi "Công việc điều chỉnh cho GVxxx · <tên> (đã huỷ hiệu lực)".
- **API:** `POST /standalone-tasks` với `adjustmentOfId`. Chi tiết việc có thêm `canCreateAdjustment`, `adjustmentOf`, `adjustments`.

## 5. Dữ liệu

Migration: `migrations/tenant/workspace/0021-workspace-standalone-tasks.sql`, đã đăng ký trong `packages/platform/entitlement/src/lib/tenant-migrations.ts`.

| Bảng | Nội dung |
|------|----------|
| `workspace_schema.standalone_tasks` | Việc. Cây việc: `parent_id`, `root_id`, `depth` (0–9). Quy trình: `execution_type`, `procedure_definition_id`, `procedure_status`, `procedure_instance_id`, `procedure_instance_code`, `procedure_error`. Các trường còn lại: `code` (duy nhất), `title`, `description`, `status`, `priority`, `assignee_user_id` (bắt buộc), `planned_start`, `due_date`, `actual_start`, `actual_end`, `progress_percent`, `created_by` (người giao), `status_changed_at`. Có CHECK hạn ≥ ngày bắt đầu. |
| `workspace_schema.standalone_task_members` | Người cùng thực hiện và người theo dõi, cột `role` ∈ {`participant`, `follower`}. Khoá chính `(task_id, user_id)`. |
| `workspace_schema.standalone_task_history` | Nhật ký đổi trạng thái kèm lý do. Dòng đầu tiên (`from_status` rỗng) là lúc giao việc. |

Các bảng con xoá theo `ON DELETE CASCADE`.

## 6. API

Tiền tố: `/api/workspace/v1`.

| Method | Đường dẫn | Mô tả |
|--------|-----------|-------|
| GET | `/standalone-tasks?scope=assigned_to_me\|assigned_by_me\|following` | Danh sách theo ngăn, kèm `myRole` của từng dòng. |
| GET | `/standalone-tasks/:id` | Chi tiết: `task`, `myRole`, `allowedStatuses`, `canAddChild`, `ancestors` (đường dẫn việc cha), `children`, `history`. |
| POST | `/standalone-tasks` | Giao việc mới. Có `parentId` thì tạo việc con; `executionType: 'procedure'` kèm `procedureDefinitionId` thì theo quy trình. |
| PATCH | `/standalone-tasks/:id` | Sửa. Người giao sửa mọi trường; người thực hiện chỉ gửi được `progressPercent`. |
| PATCH | `/standalone-tasks/:id/status` | Đổi trạng thái `{ status, note? }`. `note` bắt buộc khi trả lại hoặc huỷ. |
| POST | `/standalone-tasks/:id/reverse` | Huỷ hiệu lực `{ reason }`; chỉ người giao, chỉ việc đã Hoàn thành. |
| DELETE | `/standalone-tasks/:id` | Xoá; chỉ người giao, chỉ khi cả cây Chưa làm hoặc Đã huỷ, và việc chưa bị huỷ hiệu lực. |

`GET /my-work` có thêm trường `standaloneTasks`: gồm việc tôi đang thực hiện, cộng việc tôi giao đang chờ tôi duyệt (`awaitingMyApproval`). Các con số đầu trang (đang mở, quá hạn, đến hạn hôm nay) **có tính** việc tôi thực hiện, **không tính** việc chỉ chờ tôi duyệt.

## 7. Thông báo

Sự kiện được ghi vào outbox trong cùng transaction với dữ liệu. Chính sách hiển thị nằm trong `packages/modules/notifications/src/lib/notification-catalog.ts`. Link mở thẳng `/modules/workspace#tasks/<id>`. Người vừa thao tác không nhận thông báo của chính mình.

| Sự kiện | Người nhận |
|---------|-----------|
| `workspace.standalone-task.assigned` | Người phụ trách và người cùng thực hiện khi giao việc; khi sửa thì chỉ người **mới** được thêm vào vai thực hiện. |
| `workspace.standalone-task.review-requested` | Người giao. |
| `workspace.standalone-task.returned` | Người phụ trách và người cùng thực hiện (kèm lý do). |
| `workspace.standalone-task.completed` | Người giao, người thực hiện, người theo dõi. |
| `workspace.standalone-task.cancelled` | Người phụ trách và người cùng thực hiện (kèm lý do). |
| `workspace.standalone-task.reversed` | Người giao, người thực hiện, người theo dõi (kèm lý do). |
| `workspace.standalone-task.procedure-failed` | Người giao, người phụ trách, người cùng thực hiện: hồ sơ không mở được, bị từ chối hoặc bị huỷ. |

Liên kết với module Quy trình (đi qua outbox và RabbitMQ; hàng đợi `workspace.integrations` tự nhận thêm các sự kiện mới vì worker bind theo `WORKSPACE_PROCEDURE_EVENT_TYPES`):

| Sự kiện | Chiều |
|---------|-------|
| `workspace.standalone_task.procedure_requested` | Workspace → Quy trình |
| `procedure.instance.started_for_standalone_task` | Quy trình → Workspace |
| `procedure.instance.standalone_task_start_rejected` | Quy trình → Workspace |
| `procedure.instance.completed` (lọc `sourceType = workspace_standalone_task`) | Quy trình → Workspace |
| `workspace.standalone_task.reversed` | Workspace → Quy trình |
| `procedure.instance.reversed` (lọc `sourceType = workspace_standalone_task`) | Quy trình → Workspace |

## 8. Giao diện

**Trang "Công việc ngoài dự án"** (`#tasks`, `#tasks/<id>`), bố cục Master-Detail hai cột, mỗi cột có thanh cuộn riêng:

- **Đầu trang**: nút **Giao việc** mở hộp thoại tạo.
- **Cột trái**:
  - Ba ngăn: Giao cho tôi / Tôi giao / Tôi theo dõi.
  - Ô tìm theo mã hoặc tên (gõ không dấu vẫn tìm được).
  - Lọc trạng thái bằng `SearchableSelect`, mặc định "Đang mở".
  - Mỗi dòng hiện mã, tên, trạng thái, ưu tiên, hạn (tô đỏ khi quá hạn) và người giao hoặc người phụ trách.
- **Cột phải**:
  - Thông tin chi tiết.
  - Nút chuyển trạng thái lấy theo `allowedStatuses` server trả về, với nhãn theo ngữ cảnh: Bắt đầu làm, Gửi duyệt, Duyệt hoàn thành, Trả lại, Rút lại, Mở lại.
  - Ô cập nhật tiến độ.
  - Lời nhắc "đang chờ duyệt" và lý do lần trả lại gần nhất.
- **Popconfirm** cho Trả lại và Huỷ (bắt buộc nhập lý do) và cho Xoá.
- **Drawer** bên phải cho Nhật ký trạng thái.
- **Dialog** cho Giao việc và Sửa: tên, mô tả, người phụ trách, mức ưu tiên, người cùng thực hiện, người theo dõi, ngày bắt đầu, hạn hoàn thành. Người được chọn lấy từ toàn bộ danh bạ tổ chức.

**Trang "Công việc của tôi"** có thêm bảng "Công việc ngoài dự án". Bấm vào một dòng sẽ mở việc đó ở trang mới. Việc chờ tôi duyệt ghi "Chờ bạn duyệt" ở cột Người giao.

## 9. Danh sách file

| Lớp | File |
|-----|------|
| Migration | `migrations/tenant/workspace/0021-workspace-standalone-tasks.sql` |
| | `packages/platform/entitlement/src/lib/tenant-migrations.ts` (đăng ký) |
| Contracts | `packages/contracts/workspace/src/lib/contracts-workspace.ts` (phần "CÔNG VIỆC NGOÀI DỰ ÁN", thêm `MyWorkSummary.standaloneTasks`) |
| Domain | `packages/modules/workspace/src/lib/domain/standalone-task.rules.ts` (+ `.spec.ts`) |
| | `packages/modules/workspace/src/lib/domain/workspace.error.ts` (3 lỗi mới) |
| Ứng dụng | `packages/modules/workspace/src/lib/application/standalone-task.service.ts` (+ `.spec.ts`) |
| | `packages/modules/workspace/src/lib/application/my-work.service.ts` (gộp việc giao lẻ) |
| | `packages/modules/workspace/src/lib/application/workspace-store.port.ts` (namespace `standaloneTask`) |
| Hạ tầng | `packages/modules/workspace/src/lib/infrastructure/postgres-workspace-store.ts` |
| Trình bày | `packages/modules/workspace/src/lib/presentation/workspace.controller.ts` |
| | `packages/modules/workspace/src/lib/workspace.module.ts`, `src/index.ts` |
| Thông báo | `packages/modules/notifications/src/lib/notification-catalog.ts` |
| Quy trình ↔ Workspace | `packages/modules/workspace/src/lib/domain/workspace-procedure-link.ts`, `application/procedure-link-events.ts` |
| Module Quy trình | `packages/contracts/procedure-engine/src/lib/procedure-engine.contracts.ts` (thêm `sourceType` `workspace_standalone_task`) |
| | `packages/modules/procedure-engine/src/lib/domain/procedure-workspace-link.ts`, `application/procedure-engine.application.ts` (`startForWorkspaceStandaloneTask`), `application/workspace-link-events.ts` (+ `.spec.ts`) |
| Giao diện | `packages/features/workspace/src/lib/components/standalone-tasks-view.tsx` |
| | `packages/features/workspace/src/lib/components/standalone-task-form.tsx` |
| | `packages/features/workspace/src/lib/components/my-work-view.tsx` |
| | `packages/features/workspace/src/lib/components/people-picker.tsx` (sửa lỗi Enter gửi form, thêm điều hướng bàn phím) |
| | `packages/features/workspace/src/lib/components/reverse-standalone-task-dialog.tsx` (hộp thoại huỷ hiệu lực kèm lập điều chỉnh) |
| | `packages/features/workspace/src/lib/workspace-screen.tsx` |
| | `packages/features/workspace/src/lib/workspace-api.ts`, `workspace-labels.ts`, `workspace.module.scss` |

## 10. Kiểm thử

### 10.1. Unit test, typecheck, lint

| Hạng mục | Kết quả |
|----------|---------|
| Unit test luật trạng thái (`standalone-task.rules.spec.ts`) và service (`standalone-task.service.spec.ts`) | Đạt |
| `nx test`: `module-workspace` (321 test), `module-notifications`, `platform-entitlement` | Đạt toàn bộ |
| Typecheck: contracts, module, notifications, entitlement; `nx build workspace-web` (kiểm kiểu toàn bộ giao diện) | Sạch |
| `nx lint` | Không có lỗi mới |

### 10.2. Test API end-to-end (14/10/2026)

Chạy trên dev stack local: tenant `svn`, gateway riêng ở cổng 8090. Dùng 4 tài khoản thật:

- `admin@svn.com` (người giao);
- `thanhvien.test@svn.com` (người phụ trách);
- `quanly.test@svn.com` (người cùng thực hiện hoặc người theo dõi);
- `quantri.test@svn.com` (quản trị tenant không liên quan, không có trong danh bạ tổ chức).

Kết quả: **77/77 ca đạt**, gồm các nhóm sau.

| Nhóm | Nội dung chính |
|------|----------------|
| Tạo việc, kiểm đầu vào | Trim tên; tên rỗng hoặc dài quá 200 ký tự; thiếu người phụ trách; người ngoài danh bạ; hạn trước ngày bắt đầu; ngày sai định dạng; mã việc không trùng khi 4 người tạo cùng lúc |
| Danh sách theo ngăn | Giao cho tôi / Tôi giao / Tôi theo dõi; `scope` lạ thì dùng ngăn mặc định |
| Quyền xem | Quản trị tenant không liên quan nhận 404; id sai định dạng nhận 404; người theo dõi không có nút chuyển trạng thái |
| Sửa | Người nhận chỉ cập nhật được tiến độ; người theo dõi không sửa được gì; một người không giữ hai vai |
| Luồng duyệt | Gửi duyệt, rút lại, trả lại (bắt buộc lý do), duyệt hoàn thành, mở lại; người nhận không tự hoàn thành và không huỷ được |
| Tự giao cho mình | Đi thẳng được từ Đang làm sang Hoàn thành |
| Đổi người phụ trách | Người cũ mất quyền xem |
| **Nhiều người cùng làm** | Người cùng làm thấy việc ở "Giao cho tôi" và ở "Công việc của tôi"; được bắt đầu, cập nhật tiến độ, gửi duyệt; người phụ trách rút lại được việc mà người cùng làm đã gửi; người cùng làm không duyệt được và không tự sửa danh sách người; hai người gửi duyệt cùng lúc thì một người nhận 200, người kia nhận 409; bị bỏ khỏi việc thì mất quyền xem; người cùng làm được nâng lên làm phụ trách thì rời danh sách cùng làm |
| Thông báo (kiểm trong outbox) | Đúng người nhận cho từng sự kiện; trả lại và huỷ có kèm lý do |

### 10.3. Test giao diện trên trình duyệt (Playwright, Chromium, 1600×900 và 1440×900)

Đã kiểm:

- Thứ tự menu và bố cục hai cột với thanh cuộn riêng.
- Hộp thoại Giao việc: chọn người bằng `SearchableSelect` và gõ không dấu.
- Ô chọn người bằng bàn phím (Lên/Xuống/Enter/Esc).
- Nhật ký trong Drawer; Popconfirm trả lại có ô lý do bắt buộc.
- Link thông báo `#tasks/<id>`.
- Bảng "Công việc ngoài dự án" trong trang "Công việc của tôi".
- Bộ lọc trạng thái và ô tìm kiếm.
- Màn hình của người theo dõi và của người không liên quan.

Không có lỗi API nào từ Workspace trong console. Các lỗi 502 trong console đến từ dịch vụ realtime và thông báo, vốn không chạy trong môi trường test này.

### 10.4. Lỗi phát hiện và đã sửa

| # | Loại | Lỗi | Sửa |
|---|------|-----|-----|
| 1 | Logic | Người thực hiện **tự rút lại** từ Chờ duyệt vẫn phát thông báo "Công việc bị trả lại" cho cả nhóm | Chỉ phát `returned` khi người thao tác là người giao (`postgres-workspace-store.ts`) |
| 2 | UI (có từ trước, ảnh hưởng cả form Công việc dự án) | Gõ tìm ở ô chọn người rồi nhấn **Enter** thì cả hộp thoại bị gửi, việc được tạo **thiếu** người cùng thực hiện hoặc người theo dõi | `PeoplePicker`: Enter chọn gợi ý; thêm Lên/Xuống để chọn; Esc chỉ xoá ô tìm, không đóng hộp thoại |
| 3 | UI | "Công việc của tôi" của người chỉ có việc ngoài dự án: đầu trang ghi "N việc đang mở" nhưng bảng lại ghi "Bạn không có việc nào đang mở" | Bảng ghi "Bạn không có việc dự án nào đang mở" |
| 4 | UI | Mở việc từ link thông báo, cột trái vẫn ở ngăn không chứa việc đó | Tự chuyển sang ngăn ứng với vai (người giao → Tôi giao, người theo dõi → Tôi theo dõi) |
| 5 | UI | Người không liên quan mở link thì thấy thông báo lộ mã UUID | Đổi thành câu thân thiện, không nêu id |
| 6 | UI | Mã việc dính liền vào tên trong danh sách ("GV011[TEST]…") | Thêm khoảng cách |

### 10.5. Việc con và quy trình (test lần 2)

- **Unit test:** `module-workspace` 339/339, `module-procedure-engine` 136/136 (thêm `workspace-link-events.spec.ts`).
- **Test API end-to-end: 101/101 ca đạt**, gồm 77 ca cũ (không hồi quy) và 24 ca mới:
  - người phụ trách tạo việc con, còn người cùng thực hiện thì không;
  - vai `viewer` qua cây; người ngoài cây nhận 404;
  - đường dẫn việc cha và danh sách việc con;
  - tiến độ tự tính và không sửa tay được;
  - chặn gửi duyệt hoặc huỷ khi còn việc con mở;
  - việc con tự hoàn thành, sau đó việc cha lên 100% và gửi duyệt được;
  - xoá cây; giới hạn 10 cấp;
  - việc theo quy trình: bắt buộc chọn quy trình, sự kiện outbox đúng payload, chặn gửi duyệt bằng tay khi hồ sơ đang chạy.
- **Mô phỏng sự kiện từ module Quy trình trên DB thật** (spec tạm, đã xoá):
  - đã mở rồi hoàn tất: việc gốc sang Chờ duyệt, tiến độ 100%, báo người giao; nhận lại cùng sự kiện không làm gì thêm;
  - hồ sơ của module khác: bỏ qua;
  - việc con: tự Hoàn thành, việc cha cập nhật tiến độ;
  - không mở được hoặc bị từ chối: ghi nhận và báo, trạng thái việc giữ nguyên.
- **Trình duyệt:**
  - hộp thoại Thêm việc con; ở lại việc cha sau khi thêm;
  - đường dẫn việc cha bấm được;
  - nhãn "Thuộc GVxxx" và số việc con xong/tổng ở danh sách;
  - khối hồ sơ quy trình;
  - người `viewer` không có nút thao tác.
- **Lỗi phát hiện và đã sửa:**
  - việc được hệ thống chuyển sang Chờ duyệt mà vẫn hiện câu "X đã gửi kết quả";
  - hồ sơ hoàn tất mà tiến độ vẫn 0%;
  - nhật ký hiện mã UUID của "người hệ thống".
- **Chưa test:** chạy thật với module Quy trình và worker. Dev stack dùng để test không chạy `procedure-api` và `worker`, nên luồng sự kiện qua RabbitMQ chưa được chạy thật; phía module Quy trình chỉ có unit test.

### 10.6. Test thật với `procedure-api` và `worker` (lần 3)

Chạy `procedure-api` (cổng 3434) và `worker` từ worktree này. Sự kiện đi thật qua outbox, RabbitMQ và module Quy trình.

| Bộ test | Kết quả |
|---------|---------|
| Theo quy trình (`e2e-proc`): mở hồ sơ thật (~2 giây), tên hồ sơ `GVxxx-…`; đẩy hồ sơ qua các bước tới hoàn tất thì việc tự sang Chờ duyệt, tiến độ 100%, nhật ký ghi "Hệ thống"; hồ sơ bị từ chối thì việc giữ trạng thái, xử lý tay được; quy trình nháp thì báo "Quy trình chưa được công bố." | 12/12 |
| Huỷ hiệu lực (`e2e-reverse`): quyền, lý do, chặn mở lại và xoá, gọi lại không đổi; cây việc (huỷ việc con trước); huỷ từ Workspace thì hồ sơ huỷ theo (~2 giây); huỷ từ Quy trình thì việc huỷ theo (~1 giây); không có vòng lặp | 20/20 |
| Hồi quy API (`be-test`) | 101/101 |
| Unit test: Workspace / Quy trình | 344 / 138 |
| Migration `0021` trên DB mới, chạy hai lần | Đạt |
| Trình duyệt: Popconfirm huỷ hiệu lực (khoá nút khi chưa có lý do), khối thông tin huỷ hiệu lực, bộ lọc "Đã huỷ hiệu lực"; tắt `procedure-api` thì form báo "Không tải được danh sách quy trình…" | Đạt |

Lỗi phát hiện và đã sửa: thử mở lại việc đã huỷ hiệu lực thì nhận câu "Không thể chuyển từ Đã huỷ sang Chưa làm"; nay báo "Công việc đã huỷ hiệu lực, không mở lại hay đổi trạng thái được."

### 10.7. Công việc điều chỉnh (lần 4, 15/10/2026)

| Bộ test | Kết quả |
|---------|---------|
| Unit test Workspace (thêm 4 ca điều chỉnh) / Quy trình | 348 / 138 |
| E2E điều chỉnh (`e2e-adjust`), chạy thật qua `worker` và `procedure-api`: quyền; liên kết hai chiều; chỉ một việc điều chỉnh còn hiệu lực; việc điều chỉnh bị huỷ thì lập lại được; mở lại việc cũ bị chặn rõ ràng; việc theo quy trình thì điều chỉnh mở hồ sơ mới (~2 giây); huỷ bên Quy trình có yêu cầu điều chỉnh thì việc ghi nhận và hiện nút lập | 16/16 |
| Hồi quy: `e2e-reverse` / `e2e-proc` / `be-test` | 20/20 / 12/12 / 101/101 |
| Migration `0021` trên DB mới, chạy hai lần | Đạt |
| Trình duyệt: hộp thoại huỷ hiệu lực (ô điều chỉnh mặc định tích, khoá nút khi chưa có lý do); form điều chỉnh điền sẵn; chuyển sang việc mới; liên kết qua lại giữa hai việc | Đạt |

Ghi chú môi trường test: chạy qua gateway riêng (nginx trong Docker, cổng 8090) thì thỉnh thoảng có request bị "upstream timed out while connecting" tới máy host (`host.docker.internal`), và gateway trả trang "Workspace đang bảo trì". Đây là lỗi mạng của Docker Desktop: `workspace-api` không ghi lỗi nào, và gọi thẳng API ở cổng 3437 thì **10/10 lượt đạt 101/101**.

### 10.8. Ghi nhận, chưa sửa

- Bộ lọc Trạng thái / Ưu tiên / Dự án ở đầu trang "Công việc của tôi" chưa áp dụng cho bảng "Công việc ngoài dự án".
- Khi người giao duyệt xong, việc rời khỏi danh sách "Đang mở" ở cột trái, nhưng cột phải vẫn giữ chi tiết việc đó. Đây là hành vi chấp nhận được.
- ~~Khi module Quy trình không truy cập được, form báo nhầm "Bạn chưa có quy trình nào được phép khởi tạo".~~ Đã sửa ở lần 3.
- ~~Hồ sơ quy trình bị huỷ hiệu lực thì việc ngoài dự án chưa tự huỷ theo.~~ Đã làm ở lần 3 (mục 4.3).
- ~~Huỷ hiệu lực chưa có tuỳ chọn "lập công việc điều chỉnh".~~ Đã làm ở lần 4 (mục 4.4).
- Danh sách mỗi ngăn trả tối đa 500 việc (việc đang mở xếp trước), và bộ lọc trạng thái chạy ở phía trình duyệt. Người có hơn 500 việc trong một ngăn sẽ không thấy các việc đã đóng cũ khi lọc "Hoàn thành", "Đã huỷ" hay "Đã huỷ hiệu lực". Phát hiện khi tài khoản test có 850 việc. Hướng sửa: đẩy bộ lọc trạng thái và tìm kiếm xuống server, kèm phân trang.

## 11. Triển khai

1. Chạy migration tenant cho các tenant đã bật Workspace (migration `0021-workspace-standalone-tasks` nằm trong registry, chạy theo quy trình provisioning hiện có).
2. Deploy cùng lúc:
   - `workspace-api` và `workspace-web`;
   - `procedure-api` (`sourceType` mới, hàm mở hồ sơ cho việc ngoài dự án);
   - `worker` (hàng đợi Workspace bind thêm `procedure.instance.completed` và hai sự kiện mới; hàng đợi Quy trình bind thêm `workspace.standalone_task.procedure_requested`);
   - `notification-worker` (catalog thông báo mới).
3. Nếu `worker` hoặc `procedure-api` lên sau `workspace-api`: việc tạo theo quy trình nằm ở trạng thái "Đang mở hồ sơ" cho tới khi hai dịch vụ này chạy; sự kiện vẫn nằm trong outbox, không mất.

## 12. Việc có thể làm tiếp

- Trao đổi và đính kèm tài liệu ngay trên việc giao lẻ (Drawer "Trao đổi", "Tệp đính kèm").
- Nút "Chuyển vào dự án": chuyển một việc giao lẻ thành công việc của dự án.
- Nhắc hạn tự động (sắp đến hạn, quá hạn) qua worker.
- Lặp lại định kỳ (việc giao hằng tuần, hằng tháng).
