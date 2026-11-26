import type { LinkableObject } from '@enterprise-platform/contracts-integration';
import type { ProjectAccess, ProjectService } from './project.service.js';
import {
  LinkableProviderError,
  type LinkableProvider,
  type LinkableProviderRegistry,
  type NewRelatedObject,
  type RelatedObjectStore,
  type StoredRelatedObject,
} from './related-object.port.js';
import { RelatedObjectService } from './related-object.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const actor = { tenantId: 't-1', userId: 'u-1', displayName: 'Người A', isTenantAdmin: false } as WorkspaceActor;
const other = { ...actor, userId: 'u-2', displayName: 'Người B' } as WorkspaceActor;
const TOKEN = 'token';

type Role = 'viewer' | 'member' | 'manager';
const PERMISSIONS: Record<Role, string[]> = {
  viewer: [],
  member: ['project.update_related'],
  manager: ['project.update_all'],
};

function accessAs(role: Role, archived = false): ProjectAccess {
  return {
    project: { id: 'p-1', code: 'DA-01', archivedAt: archived ? '2026-01-01T00:00:00Z' : undefined },
    role,
    isTenantAdmin: false,
    permissions: PERMISSIONS[role],
  } as unknown as ProjectAccess;
}

function contract(id: string, extra: Partial<LinkableObject> = {}): LinkableObject {
  return {
    kind: 'crm.contract',
    id,
    code: `HD-${id}`,
    label: `HD-${id} — Hợp đồng`,
    status: 'Hiệu lực',
    launchUrl: `/modules/crm#contracts/${id}`,
    fields: [{ key: 'value', label: 'Giá trị', type: 'money', value: 100 }],
    upstream: [{ kind: 'crm.quote', id: 'q-1', label: 'BG-010' }],
    prefill: { title: 'Hợp đồng', contractValue: 100 },
    ...extra,
  };
}

class MemoryStore implements RelatedObjectStore {
  rows: StoredRelatedObject[] = [];
  refreshed = 0;
  private next = 1;
  async listByProject(_tenant: string, projectId: string) {
    return this.rows.filter((row) => row.projectId === projectId);
  }
  async listByEntity(_tenant: string, entityType: 'project' | 'work_item', entityId: string) {
    return this.rows.filter((row) => row.entityType === entityType && row.entityId === entityId);
  }
  async findById(_tenant: string, id: string) {
    return this.rows.find((row) => row.id === id);
  }
  async upsert(_tenant: string, input: NewRelatedObject) {
    const found = this.rows.find(
      (row) =>
        row.entityType === input.entityType &&
        row.entityId === input.entityId &&
        row.kind === input.kind &&
        row.objectId === input.objectId,
    );
    if (found) return found;
    const row: StoredRelatedObject = { ...input, id: `r-${this.next++}`, createdAt: '2026-01-01T00:00:00.000Z' };
    this.rows.push(row);
    return row;
  }
  async refreshSnapshots(_tenant: string, updates: readonly unknown[]) {
    this.refreshed += updates.length;
  }
  async remove(_tenant: string, id: string) {
    this.rows = this.rows.filter((row) => row.id !== id);
  }
}

function setup(options: { role?: Role; archived?: boolean; provider?: Partial<LinkableProvider> } = {}) {
  const store = new MemoryStore();
  const objects = new Map([
    ['c-1', contract('c-1')],
    ['c-2', contract('c-2')],
  ]);
  const crm: LinkableProvider = {
    moduleKey: 'crm',
    kinds: jest.fn(async () => [
      { key: 'crm.contract', label: 'Hợp đồng bán', moduleLabel: 'Bán hàng', prefill: true },
    ]),
    search: jest.fn(async () => [{ kind: 'crm.contract', id: 'c-1', label: 'HD-c-1 — Hợp đồng' }]),
    resolve: jest.fn(async (_viewer, _kind, ids: readonly string[]) =>
      ids.flatMap((id) => (objects.has(id) ? [objects.get(id) as LinkableObject] : [])),
    ),
    ...options.provider,
  };
  const providers: LinkableProviderRegistry = {
    all: () => [crm],
    get: (key) => (key === 'crm' ? crm : undefined),
  };
  const workspace = {
    workItem: {
      findById: async (_tenant: string, id: string) =>
        id === 'w-1' ? { id: 'w-1', projectId: 'p-1', code: 'CV-1', title: 'Lắp đặt' } : undefined,
    },
  } as unknown as WorkspaceStore;
  const projects = {
    access: async () => accessAs(options.role ?? 'member', options.archived),
  } as unknown as ProjectService;
  return { service: new RelatedObjectService(store, workspace, projects, providers), store, crm, objects };
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('RelatedObjectService', () => {
  it('gắn vào dự án: hỏi lại module gốc, lưu nhãn của module (không phải của trình duyệt), trả kèm thông tin đầy đủ', async () => {
    const { service, store } = setup();
    const linked = await service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' });
    expect(linked).toMatchObject({
      entityType: 'project',
      kind: 'crm.contract',
      moduleKey: 'crm',
      label: 'HD-c-1 — Hợp đồng',
      kindLabel: 'Hợp đồng bán',
      moduleLabel: 'Bán hàng',
      canRemove: true,
    });
    expect(linked.fields).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ createdBy: 'u-1', createdByName: 'Người A' });
  });

  it('gắn lại đúng hồ sơ không sinh dòng thứ hai', async () => {
    const { service, store } = setup();
    await service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' });
    await service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' });
    expect(store.rows).toHaveLength(1);
  });

  it('không gắn được hồ sơ mà module gốc không trả (không tồn tại hoặc không có quyền)', async () => {
    const { service, store } = setup();
    expect(await errorCode(service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'x' }))).toBe(
      'RELATED_OBJECT_NOT_FOUND',
    );
    expect(store.rows).toHaveLength(0);
  });

  it('người chỉ xem, dự án đã lưu trữ, loại lạ, thiếu token đều bị chặn', async () => {
    expect(
      await errorCode(setup({ role: 'viewer' }).service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' })),
    ).toBe('PROJECT_ROLE_FORBIDDEN');
    expect(
      await errorCode(setup({ archived: true }).service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' })),
    ).toBe('PROJECT_ARCHIVED');
    expect(await errorCode(setup().service.linkToProject(actor, TOKEN, 'p-1', { kind: 'kho', objectId: 'c-1' }))).toBe(
      'VALIDATION',
    );
    expect(
      await errorCode(setup().service.linkToProject(actor, TOKEN, 'p-1', { kind: 'finance.receipt', objectId: 'c-1' })),
    ).toBe('RELATED_MODULE_UNAVAILABLE');
    expect(
      await errorCode(setup().service.linkToProject(actor, undefined, 'p-1', { kind: 'crm.contract', objectId: 'c-1' })),
    ).toBe('RELATED_MODULE_FORBIDDEN');
  });

  it('module bị tắt lúc gắn: báo rõ, không 5xx', async () => {
    const { service } = setup({
      provider: {
        resolve: async () => {
          throw new LinkableProviderError('module_unavailable');
        },
      },
    });
    expect(await errorCode(service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' }))).toBe(
      'RELATED_MODULE_UNAVAILABLE',
    );
  });

  it('tối đa 20 liên kết mỗi dự án', async () => {
    const { service, store } = setup();
    for (let index = 0; index < 20; index += 1) {
      store.rows.push({
        id: `old-${index}`,
        entityType: 'project',
        entityId: 'p-1',
        projectId: 'p-1',
        kind: 'crm.quote',
        moduleKey: 'crm',
        objectId: `q-${index}`,
        label: 'BG',
        launchUrl: '/modules/crm#quotes/q',
        createdBy: 'u-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    }
    expect(await errorCode(service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' }))).toBe(
      'VALIDATION',
    );
  });

  it('gắn vào công việc ghi đúng dự án của công việc', async () => {
    const { service } = setup();
    const linked = await service.linkToWorkItem(actor, TOKEN, 'w-1', { kind: 'crm.contract', objectId: 'c-2' });
    expect(linked).toMatchObject({ entityType: 'work_item', entityId: 'w-1', projectId: 'p-1' });
    expect(await errorCode(service.linkToWorkItem(actor, TOKEN, 'w-x', { kind: 'crm.contract', objectId: 'c-2' }))).toBe(
      'WORK_ITEM_NOT_FOUND',
    );
  });

  describe('danh sách khi module có vấn đề', () => {
    async function linkedThen(provider: Partial<LinkableProvider>) {
      const ready = setup();
      await ready.service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' });
      const broken = setup({ provider });
      broken.store.rows = ready.store.rows;
      return broken.service.listForProject(actor, TOKEN, 'p-1');
    }

    it('đọc được: kèm thông tin đầy đủ, cờ quyền đúng', async () => {
      const { service } = setup();
      await service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' });
      const list = await service.listForProject(actor, TOKEN, 'p-1');
      expect(list).toMatchObject({ canAdd: true, degraded: false });
      expect(list.items[0]?.fields).toHaveLength(1);
      expect(list.items[0]?.unavailableReason).toBeUndefined();
    });

    it('công ty không còn dùng module: vẫn hiện nhãn đã lưu, không lỗi', async () => {
      const list = await linkedThen({
        resolve: async () => {
          throw new LinkableProviderError('module_unavailable');
        },
      });
      expect(list.items[0]).toMatchObject({ label: 'HD-c-1 — Hợp đồng', unavailableReason: 'module_unavailable', fields: [] });
      expect(list.degraded).toBe(false);
    });

    it('người xem không có quyền ở module gốc', async () => {
      const list = await linkedThen({
        resolve: async () => {
          throw new LinkableProviderError('forbidden');
        },
      });
      expect(list.items[0]?.unavailableReason).toBe('forbidden');
    });

    it('module không trả lời: nhãn đã lưu và cờ degraded', async () => {
      const list = await linkedThen({
        resolve: async () => {
          throw new LinkableProviderError('unreachable');
        },
      });
      expect(list.items[0]?.unavailableReason).toBe('unreachable');
      expect(list.degraded).toBe(true);
    });

    it('hồ sơ đã bị xoá ở module gốc', async () => {
      const list = await linkedThen({ resolve: async () => [] });
      expect(list.items[0]?.unavailableReason).toBe('not_found');
    });

    it('lỗi lạ trong module cũng không làm hỏng danh sách', async () => {
      const list = await linkedThen({
        resolve: async () => {
          throw new Error('boom');
        },
      });
      expect(list.items[0]?.unavailableReason).toBe('unreachable');
    });
  });

  it('gỡ liên kết: người thêm hoặc quản lý; thành viên khác không gỡ được', async () => {
    const owner = setup();
    const linked = await owner.service.linkToProject(actor, TOKEN, 'p-1', { kind: 'crm.contract', objectId: 'c-1' });

    const memberB = setup({ role: 'member' });
    memberB.store.rows = owner.store.rows;
    const listForB = await memberB.service.listForProject(other, TOKEN, 'p-1');
    expect(listForB.items[0]?.canRemove).toBe(false);
    expect(await errorCode(memberB.service.unlink(other, linked.id))).toBe('PROJECT_ROLE_FORBIDDEN');

    const manager = setup({ role: 'manager' });
    manager.store.rows = owner.store.rows;
    await manager.service.unlink(other, linked.id);
    expect(manager.store.rows).toHaveLength(0);
  });

  it('danh sách loại: module lỗi chỉ làm thiếu loại của nó', async () => {
    const { service } = setup({
      provider: {
        kinds: async () => {
          throw new LinkableProviderError('unreachable');
        },
      },
    });
    expect(await service.kinds(actor, TOKEN)).toEqual({ kinds: [] });
    const healthy = setup();
    expect((await healthy.service.kinds(actor, TOKEN)).kinds).toEqual([
      { key: 'crm.contract', moduleKey: 'crm', moduleLabel: 'Bán hàng', label: 'Hợp đồng bán', prefill: true },
    ]);
  });

  it('xem trước: kèm chuỗi phía trước có tên loại và gợi ý điền sẵn', async () => {
    const { service } = setup();
    const preview = await service.preview(actor, TOKEN, 'crm.contract', 'c-1');
    expect(preview.upstream).toEqual([{ kind: 'crm.quote', id: 'q-1', label: 'BG-010', kindLabel: undefined }]);
    expect(preview.prefill).toEqual({ title: 'Hợp đồng', contractValue: 100 });
    expect(preview.kindLabel).toBe('Hợp đồng bán');
  });
});
