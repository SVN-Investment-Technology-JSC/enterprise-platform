import { createProjectWithInitialTasks } from './project-initial-tasks.js';
import { ProjectService } from './project.service.js';
import type { WorkItemService } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const actor: WorkspaceActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'u1',
  isTenantAdmin: true,
  canManage: true,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

/** Dịch vụ giả: chỉ ghi lại những gì được gọi, để kiểm luật chọn danh sách và xử lý lỗi từng việc. */
function fakes(options: { settings?: unknown; failOn?: string[] } = {}) {
  const created: string[] = [];
  const projectInputs: unknown[] = [];
  const projects = {
    create: async (_actor: WorkspaceActor, input: unknown) => {
      projectInputs.push(input);
      return { id: 'p1', code: 'DA-1', name: 'Dự án' };
    },
    defaultTaskSettings: async () => options.settings ?? { defaultTasksEnabled: false, defaultTaskTitles: ['Mẫu'] },
  } as unknown as ProjectService;
  const workItems = {
    create: async (_actor: WorkspaceActor, input: { title: string; projectId: string; itemType?: string }) => {
      if (options.failOn?.includes(input.title)) throw new Error('lỗi');
      created.push(`${input.projectId}:${input.itemType}:${input.title}`);
      return { id: `w${created.length}` };
    },
  } as unknown as WorkItemService;
  return { projects, workItems, created, projectInputs };
}

describe('createProjectWithInitialTasks', () => {
  it('có danh sách riêng thì tạo đúng danh sách đó theo thứ tự, mỗi việc cấp gốc loại công việc', async () => {
    const { projects, workItems, created } = fakes();
    const result = await createProjectWithInitialTasks(projects, workItems, actor, {
      name: 'Dự án',
      initialTasks: ['Hợp đồng', 'Triển khai'],
    });
    expect(created).toEqual(['p1:task:Hợp đồng', 'p1:task:Triển khai']);
    expect(result.initialTasks).toEqual({ created: 2, failed: 0 });
  });

  it('không gửi danh sách và cài đặt tắt thì không tạo việc nào', async () => {
    const { projects, workItems, created } = fakes();
    const result = await createProjectWithInitialTasks(projects, workItems, actor, { name: 'Dự án' });
    expect(created).toEqual([]);
    expect(result.initialTasks).toBeUndefined();
  });

  it('không gửi danh sách và cài đặt bật thì dùng danh sách mẫu của tenant', async () => {
    const { projects, workItems, created } = fakes({
      settings: { defaultTasksEnabled: true, defaultTaskTitles: ['Hợp đồng', 'Nghiệm thu'] },
    });
    await createProjectWithInitialTasks(projects, workItems, actor, { name: 'Dự án' });
    expect(created).toEqual(['p1:task:Hợp đồng', 'p1:task:Nghiệm thu']);
  });

  it('danh sách rỗng gửi lên là chủ động không tạo, dù cài đặt đang bật', async () => {
    const { projects, workItems, created } = fakes({
      settings: { defaultTasksEnabled: true, defaultTaskTitles: ['Hợp đồng'] },
    });
    const result = await createProjectWithInitialTasks(projects, workItems, actor, { name: 'Dự án', initialTasks: [] });
    expect(created).toEqual([]);
    expect(result.initialTasks).toBeUndefined();
  });

  it('danh sách hỏng bị từ chối trước khi tạo dự án (không để lại dự án dở dang)', async () => {
    const { projects, workItems, projectInputs } = fakes();
    await expect(
      createProjectWithInitialTasks(projects, workItems, actor, {
        name: 'Dự án',
        initialTasks: ['x'.repeat(300)],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(projectInputs).toEqual([]);
  });

  it('một việc lỗi không làm mất dự án và không chặn các việc còn lại', async () => {
    const { projects, workItems, created } = fakes({ failOn: ['Triển khai'] });
    const result = await createProjectWithInitialTasks(projects, workItems, actor, {
      name: 'Dự án',
      initialTasks: ['Hợp đồng', 'Triển khai', 'Nghiệm thu'],
    });
    expect(created).toEqual(['p1:task:Hợp đồng', 'p1:task:Nghiệm thu']);
    expect(result.initialTasks).toEqual({ created: 2, failed: 1 });
    expect(result.id).toBe('p1');
  });

  it('trường initialTasks không lọt vào dữ liệu tạo dự án', async () => {
    const { projects, workItems, projectInputs } = fakes();
    await createProjectWithInitialTasks(projects, workItems, actor, { name: 'Dự án', initialTasks: ['A'] });
    expect(projectInputs).toEqual([{ name: 'Dự án' }]);
  });
});

describe('Cấu hình tạo sẵn công việc (ProjectService)', () => {
  function settingsStore() {
    const saved: Record<string, unknown> = {};
    const store = {
      settings: {
        get: async (_t: string, key: string) => saved[key],
        set: async (_t: string, key: string, value: unknown) => {
          saved[key] = value;
        },
      },
    } as unknown as WorkspaceStore;
    return { store, saved };
  }

  it('chưa cấu hình: tắt, kèm mẫu gợi ý 4 công việc', async () => {
    const { store } = settingsStore();
    const settings = await new ProjectService(store).archiveSettings(actor);
    expect(settings.defaultTasksEnabled).toBe(false);
    expect(settings.defaultTaskTitles).toEqual(['Hợp đồng', 'Triển khai', 'Chi phí thực hiện', 'Nghiệm thu hoàn thành']);
  });

  it('lưu từng phần: bật không đổi danh sách, đổi danh sách không đổi công tắc', async () => {
    const { store } = settingsStore();
    const projects = new ProjectService(store);
    const on = await projects.saveArchiveSettings(actor, { defaultTasksEnabled: true });
    expect(on.defaultTasksEnabled).toBe(true);
    expect(on.defaultTaskTitles).toHaveLength(4);
    const edited = await projects.saveArchiveSettings(actor, { defaultTaskTitles: ['  Khảo sát ', 'Triển khai', 'khảo sát'] });
    expect(edited.defaultTasksEnabled).toBe(true);
    expect(edited.defaultTaskTitles).toEqual(['Khảo sát', 'Triển khai']);
  });

  it('từ chối danh sách hỏng và người không có quyền', async () => {
    const { store } = settingsStore();
    const projects = new ProjectService(store);
    await expect(
      projects.saveArchiveSettings(actor, { defaultTaskTitles: ['x'.repeat(201)] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      projects.saveArchiveSettings({ ...actor, isTenantAdmin: false, canManage: false }, { defaultTasksEnabled: true }),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN' });
  });

  it('giá trị lưu hỏng thì quay về mẫu gợi ý, không làm hỏng màn tạo dự án', async () => {
    const { store, saved } = settingsStore();
    saved['project_default_tasks'] = { enabled: true, titles: ['x'.repeat(500)] };
    const settings = await new ProjectService(store).defaultTaskSettings('t1');
    expect(settings.defaultTasksEnabled).toBe(true);
    expect(settings.defaultTaskTitles).toHaveLength(4);
  });
});
