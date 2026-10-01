import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type {
  NotificationPreference,
  NotificationRecord,
  NotificationSummary,
} from '@enterprise-platform/contracts-realtime';
import { NotificationNotFoundError } from '@enterprise-platform/module-notifications';
import {
  RealtimeNotificationsController,
  type RealtimeRequestContext,
  type RealtimeRequestContextResolver,
  type RealtimeNotificationStore,
} from './realtime-notifications.controller';

const principal = {
  kind: 'tenant-user' as const,
  tenantId: 'tenant-a',
  tenantSlug: 'a',
  membershipId: 'membership-a',
  userId: 'user-a',
  sessionId: 'session-a',
  email: 'a@example.test',
  displayName: 'A',
  roles: ['tenant-user'],
  permissions: [],
};

const notification: NotificationRecord = {
  id: '10000000-0000-4000-8000-000000000001',
  module: 'hrm',
  category: 'request-status',
  priority: 'actionable',
  title: 'Request approved',
  body: 'Your request was approved.',
  sourceType: 'hrm.request.status-changed',
  sourceId: 'request-1',
  aggregateCount: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  sequence: 3,
};

function request(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    cookies: { ep_access: 'access', ep_csrf: 'csrf' },
    ...overrides,
  } as unknown as Request;
}

function createStore(): jest.Mocked<RealtimeNotificationStore> {
  return {
    list: jest.fn().mockResolvedValue({ items: [notification], nextCursor: 'next' }),
    sync: jest.fn().mockResolvedValue({
      resetRequired: false,
      events: [],
      summary: { unreadCount: 1, lastSequence: 3 },
    }),
    summary: jest.fn().mockResolvedValue({ unreadCount: 1, lastSequence: 3 }),
    setRead: jest.fn().mockResolvedValue(notification),
    readAll: jest.fn().mockResolvedValue({ unreadCount: 0, lastSequence: 4 }),
    preferences: jest.fn().mockResolvedValue([]),
    setPreferences: jest.fn().mockImplementation(async (_userId, value) => value),
  };
}

function setup() {
  const store = createStore();
  const context: RealtimeRequestContext = { principal, store };
  const contexts: jest.Mocked<RealtimeRequestContextResolver> = {
    resolve: jest.fn().mockResolvedValue(context),
    requireCsrf: jest.fn(),
  };
  return {
    controller: new RealtimeNotificationsController(contexts),
    contexts,
    store,
  };
}

describe('RealtimeNotificationsController', () => {
  it('paginates the authenticated user feed with strict query parsing', async () => {
    const { controller, store } = setup();

    await expect(
      controller.notifications(request(), 'cursor-1', '25', 'true', 'hrm'),
    ).resolves.toEqual({ items: [notification], nextCursor: 'next' });
    expect(store.list).toHaveBeenCalledWith('user-a', {
      cursor: 'cursor-1',
      limit: 25,
      unread: true,
      module: 'hrm',
    });
    await expect(
      controller.notifications(request(), undefined, '0', undefined, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.notifications(request(), undefined, undefined, 'yes', undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.notifications(request(), undefined, undefined, undefined, 'finance'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('syncs from a non-negative sequence and rejects malformed sequence values', async () => {
    const { controller, store } = setup();

    await controller.sync(request(), '3');
    expect(store.sync).toHaveBeenCalledWith('user-a', 3);
    await controller.sync(request(), undefined);
    expect(store.sync).toHaveBeenLastCalledWith('user-a', 0);
    await expect(controller.sync(request(), '-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.sync(request(), '1.5')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uses only authenticated ownership for read and read-all mutations', async () => {
    const { controller, contexts, store } = setup();
    const req = request({
      headers: { 'x-csrf-token': 'csrf' },
    } as Partial<Request>);

    await controller.setRead(req, notification.id, {
      read: true,
      tenantId: 'tenant-b',
      userId: 'user-b',
    } as never);
    expect(contexts.requireCsrf).toHaveBeenCalledWith(req);
    expect(store.setRead).toHaveBeenCalledWith(
      'tenant-a',
      'user-a',
      notification.id,
      true,
    );

    await controller.readAll(req);
    expect(store.readAll).toHaveBeenCalledWith('tenant-a', 'user-a');
  });

  it('maps an unreadable foreign notification to not-found instead of leaking ownership', async () => {
    const { controller, store } = setup();
    store.setRead.mockRejectedValueOnce(new NotificationNotFoundError());

    await expect(
      controller.setRead(request(), notification.id, { read: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns and updates validated preferences for the authenticated user', async () => {
    const { controller, store } = setup();
    const preference: NotificationPreference = {
      module: 'workspace',
      category: 'mention',
      priority: 'actionable',
      feedEnabled: true,
      toastEnabled: false,
    };

    await controller.preferences(request());
    expect(store.preferences).toHaveBeenCalledWith('user-a');

    await controller.setPreferences(request(), { preferences: [preference] });
    expect(store.setPreferences).toHaveBeenCalledWith('user-a', [preference]);
    await expect(
      controller.setPreferences(request(), {
        preferences: [{ ...preference, module: 'finance' } as never],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.setPreferences(request(), {
        preferences: [{ ...preference, priority: 'urgent' } as never],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the persisted summary for the authenticated user', async () => {
    const { controller, store } = setup();
    const expected: NotificationSummary = { unreadCount: 1, lastSequence: 3 };
    store.summary.mockResolvedValueOnce(expected);

    await expect(controller.summary(request())).resolves.toEqual(expected);
    expect(store.summary).toHaveBeenCalledWith('user-a');
  });
});
