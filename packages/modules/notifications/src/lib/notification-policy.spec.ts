import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import {
  NotificationPolicyRegistry,
  effectiveDelivery,
  type NotificationPolicy,
  type RecipientDirectory,
} from './notification-policy.js';

const event = (payload: Record<string, unknown>): IntegrationEventEnvelope => ({
  id: '10000000-0000-4000-8000-000000000001',
  type: 'workspace.work-item.assigned',
  version: 1,
  occurredAt: '2026-10-01T08:00:00.000Z',
  tenantId: '10000000-0000-4000-8000-000000000002',
  source: 'workspace',
  correlationId: 'work-item-42',
  payload,
});

const policy: NotificationPolicy = {
  eventType: 'workspace.work-item.assigned',
  version: 1,
  module: 'workspace',
  category: 'assignment',
  priority: 'actionable',
  recipients: { kind: 'payload', fields: ['assigneeUserId'] },
  actorField: 'actorUserId',
  template: ({ payload }) => ({
    title: 'Bạn có công việc mới',
    body: String(payload.title),
    deepLink: `/workspace/work-items/${String(payload.workItemId)}`,
    sourceType: 'workspace_work_item',
    sourceId: String(payload.workItemId),
  }),
  aggregation: {
    windowMinutes: 15,
    key: ({ payload }) => `workspace:assignment:${String(payload.projectId)}`,
  },
};

const directory: RecipientDirectory = {
  usersWithPermission: jest.fn(async () => []),
  activeUsers: jest.fn(async (ids) => ids),
};

describe('notification delivery preferences', () => {
  it('keeps required events in feed and toast', () => {
    expect(
      effectiveDelivery('required', { feedEnabled: false, toastEnabled: false }),
    ).toEqual({ feedEnabled: true, toastEnabled: true });
  });

  it('keeps actionable events in feed but allows toast opt-out', () => {
    expect(
      effectiveDelivery('actionable', { feedEnabled: false, toastEnabled: false }),
    ).toEqual({ feedEnabled: true, toastEnabled: false });
  });

  it('allows informational events to opt out of feed and toast', () => {
    expect(
      effectiveDelivery('informational', {
        feedEnabled: false,
        toastEnabled: false,
      }),
    ).toEqual({ feedEnabled: false, toastEnabled: false });
  });
});

describe('NotificationPolicyRegistry', () => {
  it('excludes the actor and carries a 15-minute aggregation key', async () => {
    const registry = new NotificationPolicyRegistry([policy]);
    const resolved = await registry.resolve(
      event({
        workItemId: '42',
        projectId: 'project-1',
        title: 'Chuẩn bị báo cáo',
        assigneeUserId: 'user-2',
        actorUserId: 'user-2',
      }),
      directory,
    );

    expect(resolved).toEqual(
      expect.objectContaining({
        recipients: [],
        aggregationKey: 'workspace:assignment:project-1',
        aggregationWindowMinutes: 15,
      }),
    );
  });

  it('uses the permission directory and removes duplicate recipients', async () => {
    const usersWithPermission = jest.fn(async () => ['user-1', 'user-1', 'user-2']);
    const permissionDirectory: RecipientDirectory = {
      usersWithPermission,
      activeUsers: jest.fn(async (ids) => ids),
    };
    const registry = new NotificationPolicyRegistry([
      {
        ...policy,
        recipients: { kind: 'permission', permission: 'workspace.manage' },
      },
    ]);

    const resolved = await registry.resolve(
      event({ workItemId: '42', projectId: 'project-1', title: 'Báo cáo' }),
      permissionDirectory,
    );

    expect(usersWithPermission).toHaveBeenCalledWith('workspace.manage');
    expect(resolved?.recipients).toEqual(['user-1', 'user-2']);
  });
});
