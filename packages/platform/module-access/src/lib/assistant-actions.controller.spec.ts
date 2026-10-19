import { defineAssistantActions } from '@enterprise-platform/contracts-assistant';
import type { AuthenticatedPrincipal } from '@enterprise-platform/contracts-identity';
import type { Request } from 'express';
import { assistantActionsController } from './assistant-actions.controller';
import { ModuleAccess } from './module-access';

const ACTIONS = defineAssistantActions('workspace', {
  meeting: {
    key: 'workspace.event.create',
    title: 'Tạo cuộc họp',
    permission: 'workspace.task.write',
    page: '/modules/workspace#my-work',
    draft: { title: 'Tiêu đề' },
  },
  read: {
    key: 'workspace.project.view',
    title: 'Xem dự án',
    permission: 'workspace.read',
    page: '/modules/workspace#projects',
    draft: {},
  },
});

function controllerFor(granted: string[]) {
  const asked: string[] = [];
  const access = new ModuleAccess({
    moduleKey: 'workspace',
    verifyToken: async () =>
      ({ kind: 'tenant-user', sessionId: 's1', tenantId: 't1', userId: 'u1' }) as unknown as AuthenticatedPrincipal,
    fetcher: async (_input, init) => {
      const permission = JSON.parse(String(init?.body)).permission as string;
      asked.push(permission);
      return { ok: true, status: 200, json: async () => ({ allowed: granted.includes(permission) }) } as Response;
    },
  });
  const Controller = assistantActionsController('workspace', ACTIONS, access);
  return { controller: new Controller() as { list(request: Request): Promise<{ actions: { key: string }[] }> }, asked };
}

const request = { headers: { authorization: 'Bearer t' }, cookies: {} } as unknown as Request;

describe('assistantActionsController', () => {
  it('chỉ trả thao tác người gọi có quyền, hỏi mỗi khoá quyền một lần', async () => {
    const { controller, asked } = controllerFor(['workspace.read']);
    const { actions } = await controller.list(request);
    expect(actions.map((a) => a.key)).toEqual(['workspace.project.view']);
    expect(asked.sort()).toEqual(['workspace.read', 'workspace.task.write']);
  });

  it('không có quyền nào thì danh mục rỗng', async () => {
    const { controller } = controllerFor([]);
    expect((await controller.list(request)).actions).toEqual([]);
  });
});
