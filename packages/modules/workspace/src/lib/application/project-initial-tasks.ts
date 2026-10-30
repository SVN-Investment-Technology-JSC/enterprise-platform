import type {
  CreateProjectRequest,
  ProjectCreatedResponse,
} from '@enterprise-platform/contracts-workspace';
import { cleanTaskTitles } from '../domain/project-template.rules.js';
import type { ProjectService } from './project.service.js';
import type { WorkItemService } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';

/**
 * Tạo dự án kèm các công việc tạo sẵn.
 *
 * Danh sách lấy từ `input.initialTasks` nếu có (kể cả rỗng: người tạo chủ động không tạo); vắng thì theo cấu hình
 * chung của tenant. Mỗi tên là một công việc cấp gốc, chưa giao ai, tạo lần lượt qua `WorkItemService.create` để mã,
 * thứ tự, nhật ký và tiến độ đúng như tạo tay. Dự án luôn được tạo trước: việc nào lỗi thì chỉ đếm vào `failed`, không
 * làm mất dự án vừa tạo.
 */
export async function createProjectWithInitialTasks(
  projects: ProjectService,
  workItems: WorkItemService,
  actor: WorkspaceActor,
  input: CreateProjectRequest,
): Promise<ProjectCreatedResponse> {
  const { initialTasks, ...projectInput } = input;
  // Kiểm danh sách người dùng gửi TRƯỚC khi tạo dự án: danh sách hỏng thì không để lại dự án dở dang.
  const requested = initialTasks === undefined ? undefined : cleanTaskTitles(initialTasks);

  const project = await projects.create(actor, projectInput);

  const titles =
    requested ??
    (await (async () => {
      const settings = await projects.defaultTaskSettings(actor.tenantId);
      return settings.defaultTasksEnabled ? settings.defaultTaskTitles : [];
    })());
  if (titles.length === 0) return project;

  let created = 0;
  let failed = 0;
  for (const title of titles) {
    try {
      await workItems.create(actor, { projectId: project.id, title, itemType: 'task' });
      created += 1;
    } catch {
      failed += 1;
    }
  }
  return { ...project, initialTasks: { created, failed } };
}
