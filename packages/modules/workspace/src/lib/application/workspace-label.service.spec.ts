import { DEFAULT_WORKSPACE_LABEL_SETTINGS } from '@enterprise-platform/contracts-workspace';
import type { WorkspaceActor } from './workspace.application.js';
import { WorkspaceLabelService } from './workspace-label.service.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const admin = { tenantId: 't1', userId: 'admin', canManage: true, isTenantAdmin: false } as WorkspaceActor;
const member = { tenantId: 't1', userId: 'u1', canManage: false, isTenantAdmin: false } as WorkspaceActor;

function makeStore(inUse: string[] = []) {
  const saved = new Map<string, unknown>();
  const store = {
    settings: {
      get: async (_tenant: string, key: string) => saved.get(key),
      set: async (_tenant: string, key: string, value: unknown) => {
        saved.set(key, value);
      },
      prioritiesInUse: async (_tenant: string, keys: readonly string[]) =>
        keys.filter((key) => inUse.includes(key)),
    },
  } as unknown as WorkspaceStore;
  return { store, saved };
}

const defaults = DEFAULT_WORKSPACE_LABEL_SETTINGS;

describe('WorkspaceLabelService', () => {
  it('chưa lưu gì thì trả mặc định; người thường không sửa được', async () => {
    const service = new WorkspaceLabelService(makeStore().store);
    const view = await service.settings(member);
    expect(view.priorities).toEqual(defaults.priorities);
    expect(view.canEdit).toBe(false);
    await expect(service.save(member, defaults)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('đổi tên trạng thái, thêm mức ưu tiên mới (server cấp khoá) và dùng được ngay', async () => {
    const service = new WorkspaceLabelService(makeStore().store);
    const saved = await service.save(admin, {
      ...defaults,
      workItemStatuses: defaults.workItemStatuses.map((option) =>
        option.key === 'todo' ? { ...option, label: 'Chưa thực hiện' } : option,
      ),
      priorities: [...defaults.priorities, { label: 'Rất gấp', color: '#7F1D1D' }],
    });
    expect(saved.workItemStatuses[0]?.label).toBe('Chưa thực hiện');
    const added = saved.priorities[4];
    expect(added).toMatchObject({ label: 'Rất gấp', color: '#7f1d1d' });
    await expect(service.requirePriority('t1', added?.key)).resolves.toBe(added?.key);
    await expect(service.requirePriority('t1', 'khong-co')).rejects.toThrow('không có trong danh mục');
    await expect(service.requirePriority('t1', '')).resolves.toBe('normal');
  });

  it('không bỏ được trạng thái có sẵn, mức mặc định, hay mức còn việc dùng', async () => {
    const service = new WorkspaceLabelService(makeStore(['high']).store);
    await expect(
      service.save(admin, { ...defaults, workItemStatuses: defaults.workItemStatuses.slice(1) }),
    ).rejects.toThrow('đủ các trạng thái');
    await expect(
      service.save(admin, { ...defaults, priorities: defaults.priorities.filter((p) => p.key !== 'normal') }),
    ).rejects.toThrow('mặc định');
    await expect(
      service.save(admin, { ...defaults, priorities: defaults.priorities.filter((p) => p.key !== 'high') }),
    ).rejects.toThrow('"Cao"');
  });
});
