import type { IntegrationEventEnvelope } from '@enterprise-platform/contracts-integration';
import type {
  NotificationPreference,
  NotificationRecord,
} from '@enterprise-platform/contracts-realtime';
import {
  NotificationPolicyRegistry,
  type NotificationPolicy,
} from '@enterprise-platform/module-notifications';
import { PermanentMessageError } from '@enterprise-platform/adapter-events';
import {
  NotificationProcessor,
  type NotificationTenantRuntime,
} from './notification-processor.js';

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
};

const event: IntegrationEventEnvelope = {
  id: '10000000-0000-4000-8000-000000000001',
  type: policy.eventType,
  version: 1,
  occurredAt: '2026-10-01T08:00:00.000Z',
  tenantId: '10000000-0000-4000-8000-000000000002',
  source: 'workspace',
  correlationId: 'work-item-42',
  payload: {
    workItemId: '42',
    title: 'Chuẩn bị báo cáo',
    assigneeUserId: '10000000-0000-4000-8000-000000000003',
    actorUserId: '10000000-0000-4000-8000-000000000004',
  },
};

function runtime(): NotificationTenantRuntime {
  const preferences: readonly NotificationPreference[] = [
    {
      module: 'workspace',
      category: 'assignment',
      priority: 'actionable',
      feedEnabled: true,
      toastEnabled: false,
    },
  ];
  const notification: NotificationRecord = {
    id: '10000000-0000-4000-8000-000000000005',
    module: 'workspace',
    category: 'assignment',
    priority: 'actionable',
    title: 'Bạn có công việc mới',
    body: 'Chuẩn bị báo cáo',
    deepLink: '/workspace/work-items/42',
    sourceType: 'workspace_work_item',
    sourceId: '42',
    aggregateCount: 1,
    createdAt: event.occurredAt,
    updatedAt: event.occurredAt,
    sequence: 1,
  };
  return {
    directory: {
      usersWithPermission: jest.fn(async () => []),
      activeUsers: jest.fn(async (ids) => ids),
    },
    store: {
      preferences: jest.fn(async () => preferences),
      process: jest.fn(async () => ({
        status: 'created' as const,
        notification,
        sequence: 1,
        toastEnabled: false,
      })),
    },
    relay: { flush: jest.fn(async () => 1) },
  };
}

describe('NotificationProcessor', () => {
  it('processes active recipients with their effective preference then relays', async () => {
    const tenant = runtime();
    const processor = new NotificationProcessor(
      { resolve: jest.fn(async () => tenant) },
      new NotificationPolicyRegistry([policy]),
    );

    await expect(processor.handle(event)).resolves.toEqual({
      status: 'processed',
      recipients: 1,
      mutations: 1,
    });
    expect(tenant.store.process).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '10000000-0000-4000-8000-000000000003',
        sourceId: '42',
      }),
      expect.objectContaining({ feedEnabled: true, toastEnabled: false }),
    );
    expect(tenant.relay.flush).toHaveBeenCalledTimes(1);
  });

  it('acknowledges events for a tenant that is no longer active', async () => {
    const processor = new NotificationProcessor(
      { resolve: jest.fn(async () => undefined) },
      new NotificationPolicyRegistry([policy]),
    );

    await expect(processor.handle(event)).resolves.toEqual({
      status: 'tenant-inactive',
      recipients: 0,
      mutations: 0,
    });
  });

  it('flushes a pending delivery when the domain event is redelivered', async () => {
    const tenant = runtime();
    jest.mocked(tenant.store.process).mockResolvedValue({
      status: 'duplicate',
    });
    const processor = new NotificationProcessor(
      { resolve: jest.fn(async () => tenant) },
      new NotificationPolicyRegistry([policy]),
    );

    await expect(processor.handle(event)).resolves.toEqual({
      status: 'processed',
      recipients: 1,
      mutations: 0,
    });
    expect(tenant.relay.flush).toHaveBeenCalledTimes(1);
  });

  it('classifies an invalid envelope as a permanent message failure', async () => {
    const processor = new NotificationProcessor(
      { resolve: jest.fn(async () => runtime()) },
      new NotificationPolicyRegistry([policy]),
    );

    await expect(
      processor.handle({ ...event, occurredAt: 'invalid' }),
    ).rejects.toBeInstanceOf(PermanentMessageError);
  });
});
