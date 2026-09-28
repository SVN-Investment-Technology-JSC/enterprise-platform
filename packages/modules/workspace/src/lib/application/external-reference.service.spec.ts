import type { ExternalReference, WorkItem } from '@enterprise-platform/contracts-workspace';
import type { ExternalReferenceReader } from './external-reference.port.js';
import { ExternalReferenceService } from './external-reference.service.js';
import { ProjectService } from './project.service.js';
import type { WorkspaceActor } from './workspace.application.js';
import type { WorkspaceStore } from './workspace-store.port.js';

const ITEM = { id: 'w1', projectId: 'p1' } as WorkItem;

const REF: ExternalReference = {
  id: 'r1',
  entityType: 'work_item',
  entityId: 'w1',
  projectId: 'p1',
  moduleKey: 'procedure-engine',
  externalId: 'inst-1',
  externalCode: 'QT-001',
  launchUrl: '/modules/procedure#workspace',
  cachedLabel: 'Nhãn cũ',
  cachedStatus: 'running',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function makeStore(refs: ExternalReference[] = [REF]) {
  const upserts: unknown[] = [];
  const refreshed: unknown[] = [];
  const store = {
    project: { findById: async () => ({ id: 'p1' }) },
    member: { roleOf: async () => 'member' },
    workItem: { findById: async (_tenant: string, id: string) => (id === 'w1' ? ITEM : undefined) },
    externalRef: {
      listByEntity: async () => refs,
      listByProject: async () => refs,
      findById: async (_tenant: string, id: string) => refs.find((ref) => ref.id === id),
      upsert: async (_tenant: string, _actor: string, input: unknown) => {
        upserts.push(input);
        return REF;
      },
      refreshCache: async (_tenant: string, updates: unknown[]) => {
        refreshed.push(...updates);
      },
      remove: async () => undefined,
    },
  } as unknown as WorkspaceStore;
  return { store, upserts, refreshed };
}

const actor: WorkspaceActor = {
  tenantId: 't1',
  userId: 'u1',
  displayName: 'u1',
  isTenantAdmin: false,
  canManage: false,
  canWriteTasks: true,
  canWriteDocuments: true,
  canDeleteDocuments: true,
};

function service(store: WorkspaceStore, reader: ExternalReferenceReader) {
  return new ExternalReferenceService(store, new ProjectService(store), reader);
}

describe('ExternalReferenceService — làm mới nhãn', () => {
  it('dùng nhãn mới khi module gốc trả lời', async () => {
    const { store, refreshed } = makeStore();
    const reader: ExternalReferenceReader = {
      read: async () =>
        new Map([['inst-1', { externalId: 'inst-1', label: 'Nhãn mới', status: 'completed' }]]),
    };
    const result = await service(store, reader).listForWorkItem(actor, 'token', 'w1');
    expect(result.degraded).toBe(false);
    expect(result.items[0]).toMatchObject({ cachedLabel: 'Nhãn mới', cachedStatus: 'completed' });
    // Nhãn mới được ghi lại để lần sau module kia tắt vẫn còn bản gần nhất.
    expect(refreshed).toHaveLength(1);
  });

  it('module gốc hỏng thì rơi về nhãn cache và bật cờ degraded, KHÔNG ném lỗi', async () => {
    const { store } = makeStore();
    const reader: ExternalReferenceReader = {
      read: async () => {
        throw new Error('procedure-api đang tắt');
      },
    };
    const result = await service(store, reader).listForWorkItem(actor, 'token', 'w1');
    expect(result.degraded).toBe(true);
    expect(result.items[0]?.cachedLabel).toBe('Nhãn cũ');
  });

  it('không có token của người dùng thì không gọi sang module khác', async () => {
    // Gọi bằng danh nghĩa khác là cho người dùng đọc thứ họ không có quyền.
    const { store } = makeStore();
    let called = false;
    const reader: ExternalReferenceReader = {
      read: async () => {
        called = true;
        return new Map();
      },
    };
    const result = await service(store, reader).listForWorkItem(actor, undefined, 'w1');
    expect(called).toBe(false);
    expect(result.degraded).toBe(true);
  });

  it('gọi module khác dưới đúng danh tính người đang xem', async () => {
    const { store } = makeStore();
    const seen: unknown[] = [];
    const reader: ExternalReferenceReader = {
      read: async (viewer) => {
        seen.push(viewer);
        return new Map();
      },
    };
    await service(store, reader).listForWorkItem(actor, 'token-cua-u1', 'w1');
    expect(seen).toEqual([{ tenantId: 't1', userId: 'u1', accessToken: 'token-cua-u1' }]);
  });

  it('không có con trỏ nào thì không gọi sang module khác', async () => {
    const { store } = makeStore([]);
    let called = false;
    const reader: ExternalReferenceReader = {
      read: async () => {
        called = true;
        return new Map();
      },
    };
    await service(store, reader).listForWorkItem(actor, 'token', 'w1');
    expect(called).toBe(false);
  });
});

describe('ExternalReferenceService — gắn con trỏ', () => {
  const reader: ExternalReferenceReader = { read: async () => new Map() };

  it('nhận đường dẫn nội bộ bắt đầu bằng /modules/', async () => {
    const { store, upserts } = makeStore();
    await service(store, reader).link(actor, 'w1', {
      moduleKey: 'procedure-engine',
      externalId: 'inst-1',
      launchUrl: '/modules/procedure#workspace',
    });
    expect(upserts).toHaveLength(1);
  });

  it.each([
    ['URL tuyệt đối ra ngoài', 'https://evil.example/phish'],
    ['giao thức javascript', 'javascript:alert(1)'],
    ['URL không có giao thức', '//evil.example'],
    ['đường dẫn nội bộ nhưng lẩn // bên trong', '/modules//evil.example'],
    ['đường dẫn ngoài /modules/', '/api/platform/v1/users'],
  ])('từ chối %s', async (_label, launchUrl) => {
    const { store } = makeStore();
    await expect(
      service(store, reader).link(actor, 'w1', {
        moduleKey: 'procedure-engine',
        externalId: 'inst-1',
        launchUrl,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('từ chối module lạ', async () => {
    const { store } = makeStore();
    await expect(
      service(store, reader).link(actor, 'w1', {
        moduleKey: 'khong-co' as never,
        externalId: 'x',
        launchUrl: '/modules/x',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('không gỡ được con trỏ thuộc công việc khác', async () => {
    const { store } = makeStore([{ ...REF, entityId: 'w-khac' }]);
    await expect(service(store, reader).unlink(actor, 'w1', 'r1')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
