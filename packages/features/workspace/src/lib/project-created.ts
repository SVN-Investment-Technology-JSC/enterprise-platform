import type { ProjectCreatedResponse } from '@enterprise-platform/contracts-workspace';

/** Lời báo khi dự án đã tạo nhưng một số công việc tạo sẵn bị lỗi; rỗng khi mọi việc đều tạo được. */
export function initialTasksWarning(created: ProjectCreatedResponse): string | undefined {
  const result = created.initialTasks;
  if (!result || result.failed === 0) return undefined;
  return `Đã tạo dự án ${created.code}, nhưng ${result.failed}/${result.created + result.failed} công việc tạo sẵn bị lỗi. Hãy thêm lại thủ công.`;
}
