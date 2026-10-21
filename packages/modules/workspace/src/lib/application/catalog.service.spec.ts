import { CatalogService } from './catalog.service.js';
import { ProjectService } from './project.service.js';
import { WorkItemService } from './work-item.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const TAG_ID = '0b5c6f1e-2f0a-4c8e-9a1b-3d2e4f5a6b7c';

const actorOf = (isTenantAdmin: boolean): WorkspaceActor => ({
  tenantId: 't1',
  userId: 'u1',
  displayName: 'u1',
  isTenantAdmin,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
});

function makeStore(removed: boolean) {
  const calls: { op: string; args: unknown[] }[] = [];
  const store = {
    tag: {
      remove: async (...args: unknown[]) => {
        calls.push({ op: 'remove', args });
        return removed;
      },
    },
    workItem: {
      recentTitles: async (...args: unknown[]) => {
        calls.push({ op: 'recentTitles', args });
        return ['Khảo sát hiện trường'];
      },
    },
  } as unknown as WorkspaceStore;
  return { store, calls };
}

describe('CatalogService.removeTag — xoá hẳn nhãn', () => {
  it('chỉ quản trị viên tenant được xoá', async () => {
    const { store, calls } = makeStore(true);
    const service = new CatalogService(store, new ProjectService(store));
    await expect(service.removeTag(actorOf(false), TAG_ID)).rejects.toMatchObject({ statusCode: 403 });
    expect(calls).toEqual([]);
    await service.removeTag(actorOf(true), TAG_ID);
    expect(calls).toEqual([{ op: 'remove', args: ['t1', TAG_ID] }]);
  });

  it('id sai dạng hay nhãn không còn thì báo lỗi', async () => {
    const { store } = makeStore(false);
    const service = new CatalogService(store, new ProjectService(store));
    await expect(service.removeTag(actorOf(true), 'x')).rejects.toThrow('Nhãn không tồn tại.');
    await expect(service.removeTag(actorOf(true), TAG_ID)).rejects.toThrow('Nhãn không tồn tại.');
  });
});

describe('WorkItemService.recentTitles — gợi ý tên công việc', () => {
  it('quản trị viên thấy cả tenant; người khác chỉ việc của mình', async () => {
    const { store, calls } = makeStore(true);
    const service = new WorkItemService(store, new ProjectService(store));
    await expect(service.recentTitles(actorOf(true))).resolves.toEqual(['Khảo sát hiện trường']);
    await service.recentTitles(actorOf(false));
    expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
      ['t1', undefined],
      ['t1', 'u1'],
    ]);
  });
});
