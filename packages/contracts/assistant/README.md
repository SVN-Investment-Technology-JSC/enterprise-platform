# contracts-assistant

Chuẩn khai báo thao tác cho Trợ lý Savina, và tin nhắn `postMessage` giữa khung ERP với khung chat Trợ lý.

Trợ lý không tự ghi dữ liệu nghiệp vụ. Khi người dùng nhờ "tạo cuộc họp với anh Bình chiều mai", Trợ lý soạn bản nháp
rồi khung ERP mở popup của chính phân hệ với dữ liệu điền sẵn; người dùng xem, sửa và bấm lưu như khi tự nhập. Mọi kiểm
tra dữ liệu và quyền vẫn ở API của phân hệ.

## Khai báo (khi phần khung đã sẵn sàng)

Mỗi phân hệ khai trong `packages/contracts/<phân hệ>/src/lib/assistant-actions.ts`:

```ts
import { defineAssistantActions, draftOf } from '@enterprise-platform/contracts-assistant';

export const WORKSPACE_ASSISTANT_ACTIONS = defineAssistantActions('workspace', {
  createMeeting: {
    key: 'workspace.event.create',
    title: 'Tạo cuộc họp',
    hints: ['đặt lịch họp', 'mời họp'],
    permission: 'workspace.task.write',
    page: '/modules/workspace#calendar',
    draft: draftOf<CreateCalendarEventRequest>({
      title: 'Tiêu đề cuộc họp',
      attendeeUserIds: { describe: 'Người tham dự', lookup: '/api/workspace/v1/members' },
    }),
  },
});
```

- `permission` là khoá quyền có sẵn của phân hệ; người không có quyền không thấy thao tác.
- `draftOf<Request>` bắt lỗi typecheck khi ghi sai tên trường của request.
- Spec của phân hệ gọi `expect(assistantActionProblems(WORKSPACE_ASSISTANT_ACTIONS)).toEqual([])`.

## Trạng thái

Đợt 0 mới có chuẩn khai báo và kiểu tin nhắn. Phần ModuleShell nhận `savina-assistant:action` để mở popup, và phần Trợ
lý đọc danh mục thao tác, làm ở đợt sau. Chưa phân hệ nào cần khai báo.
