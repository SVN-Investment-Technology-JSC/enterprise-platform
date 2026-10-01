import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  NotificationClient,
  NotificationPreference,
  NotificationRecord,
  NotificationSocketHandlers,
  NotificationSyncResult,
  RealtimeEventEnvelope,
} from './notification-client';
import {
  NotificationBell,
  NotificationProvider,
  useRealtimeNotifications,
} from './notification-center';

const first: NotificationRecord = {
  id: 'notification-1',
  module: 'workspace',
  category: 'assignment',
  priority: 'actionable',
  title: 'Công việc mới',
  body: 'Bạn được giao một công việc mới.',
  deepLink: '/workspace#my-work',
  sourceType: 'work-item',
  sourceId: 'work-1',
  aggregateCount: 1,
  createdAt: '2026-10-01T07:00:00.000Z',
  updatedAt: '2026-10-01T07:00:00.000Z',
  sequence: 10,
};

const second: NotificationRecord = {
  ...first,
  id: 'notification-2',
  title: 'Yêu cầu cần duyệt',
  sourceId: 'work-2',
  sequence: 11,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeClient(overrides: Partial<NotificationClient> = {}) {
  let handlers: NotificationSocketHandlers | undefined;
  const client: NotificationClient = {
    list: jest.fn().mockResolvedValue({ items: [first] }),
    summary: jest.fn().mockResolvedValue({ unreadCount: 1, lastSequence: 10 }),
    sync: jest.fn().mockResolvedValue({
      resetRequired: false,
      events: [],
      summary: { unreadCount: 1, lastSequence: 10 },
    } satisfies NotificationSyncResult),
    setRead: jest.fn().mockResolvedValue({
      ...first,
      readAt: '2026-10-01T08:00:00.000Z',
      sequence: 11,
    }),
    readAll: jest.fn().mockResolvedValue({ unreadCount: 0, lastSequence: 11 }),
    preferences: jest.fn().mockResolvedValue([]),
    setPreferences: jest.fn().mockImplementation(async (value) => value),
    connect: jest.fn().mockImplementation((nextHandlers: NotificationSocketHandlers) => {
      handlers = nextHandlers;
      return { disconnect: jest.fn() };
    }),
    ...overrides,
  };
  return { client, getHandlers: () => handlers };
}

function Probe() {
  const realtime = useRealtimeNotifications();
  return (
    <div>
      <output aria-label="unread">{realtime.unreadCount}</output>
      <output aria-label="sequence">{realtime.lastSequence}</output>
      <output aria-label="notifications">{realtime.notifications.length}</output>
      <div>{realtime.notifications.map((item) => item.title).join('|')}</div>
      <button type="button" onClick={() => void realtime.markRead(first.id, true)}>
        mark-read
      </button>
      <button
        type="button"
        onClick={() =>
          void realtime.updatePreference({
            module: 'workspace',
            category: 'assignment',
            priority: 'actionable',
            feedEnabled: false,
            toastEnabled: false,
          })
        }
      >
        preference
      </button>
      <button type="button" onClick={() => realtime.setFilter('unread')}>
        unread-filter
      </button>
      <button type="button" onClick={() => void realtime.markAllRead()}>
        mark-all-read
      </button>
    </div>
  );
}

async function renderProvider(client: NotificationClient) {
  render(
    <NotificationProvider client={client}>
      <Probe />
    </NotificationProvider>,
  );
  await waitFor(() => expect(screen.getByText('Công việc mới')).toBeTruthy());
}

describe('NotificationProvider', () => {
  it('keeps the tenant notification bell absent when no provider is mounted', () => {
    render(<NotificationBell />);
    expect(screen.queryByRole('button', { name: /Thông báo/ })).toBeNull();
  });

  it('opens an accessible drawer, moves focus inside and closes with Escape', async () => {
    const fixture = fakeClient();
    render(
      <NotificationProvider client={fixture.client}>
        <NotificationBell />
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Thông báo, 1 chưa đọc' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Thông báo, 1 chưa đọc' }));
    expect(screen.getByRole('dialog', { name: 'Thông báo' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Đóng thông báo' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Thông báo' })).toBeNull();
  });

  it('applies optimistic read state before the REST mutation settles', async () => {
    const pending = deferred<NotificationRecord>();
    const fixture = fakeClient({ setRead: jest.fn(() => pending.promise) });
    await renderProvider(fixture.client);

    fireEvent.click(screen.getByText('mark-read'));

    expect(screen.getByLabelText('unread').textContent).toBe('0');
    expect(fixture.client.setRead).toHaveBeenCalledWith(first.id, true);

    pending.resolve({
      ...first,
      readAt: '2026-10-01T08:00:00.000Z',
      sequence: 11,
    });
    await act(async () => pending.promise);
  });

  it('removes optimistic read-all items from the unread filter before the REST mutation settles', async () => {
    const pending = deferred<{ unreadCount: number; lastSequence: number }>();
    const fixture = fakeClient({ readAll: jest.fn(() => pending.promise) });
    await renderProvider(fixture.client);

    fireEvent.click(screen.getByText('unread-filter'));
    await waitFor(() => expect(fixture.client.list).toHaveBeenLastCalledWith({ limit: 30, unread: true }));
    fireEvent.click(screen.getByText('mark-all-read'));

    expect(screen.getByLabelText('unread').textContent).toBe('0');
    expect(screen.getByLabelText('notifications').textContent).toBe('0');

    pending.resolve({ unreadCount: 0, lastSequence: 11 });
    await act(async () => pending.promise);
  });

  it('deduplicates realtime events by sequence while applying the next event once', async () => {
    const fixture = fakeClient();
    await renderProvider(fixture.client);
    const handlers = fixture.getHandlers();
    expect(handlers).toBeDefined();

    const duplicate: RealtimeEventEnvelope = {
      id: 'event-10',
      event: 'notification.created',
      version: 1,
      tenantId: 'tenant-a',
      userId: 'user-a',
      sequence: 10,
      occurredAt: '2026-10-01T07:00:00.000Z',
      data: { notification: first },
    };
    const next: RealtimeEventEnvelope = {
      ...duplicate,
      id: 'event-11',
      sequence: 11,
      data: { notification: second },
    };

    await act(async () => {
      handlers?.onEvent(duplicate);
      handlers?.onEvent(next);
      handlers?.onEvent(next);
    });

    await waitFor(() => expect(screen.getByText(/Yêu cầu cần duyệt/)).toBeTruthy());
    expect(screen.getByLabelText('unread').textContent).toBe('2');
    expect(screen.getByLabelText('sequence').textContent).toBe('11');
  });

  it('syncs from the last sequence when the socket connects or reconnects', async () => {
    const synced: NotificationSyncResult = {
      resetRequired: false,
      events: [
        {
          id: 'event-11',
          event: 'notification.created',
          version: 1,
          tenantId: 'tenant-a',
          userId: 'user-a',
          sequence: 11,
          occurredAt: '2026-10-01T07:05:00.000Z',
          data: { notification: second },
        },
      ],
      summary: { unreadCount: 2, lastSequence: 11 },
    };
    const fixture = fakeClient({ sync: jest.fn().mockResolvedValue(synced) });
    await renderProvider(fixture.client);

    await act(async () => fixture.getHandlers()?.onConnected());

    await waitFor(() => expect(fixture.client.sync).toHaveBeenCalledWith(10));
    expect(screen.getByLabelText('sequence').textContent).toBe('11');
    expect(screen.getByLabelText('unread').textContent).toBe('2');
  });

  it('reloads the active unread page after a realtime summary update', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce({ items: [first] })
      .mockResolvedValueOnce({ items: [first] })
      .mockResolvedValueOnce({ items: [] });
    const fixture = fakeClient({ list });
    await renderProvider(fixture.client);

    fireEvent.click(screen.getByText('unread-filter'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    await act(async () => {
      fixture.getHandlers()?.onEvent({
        id: 'event-11',
        event: 'notification.summary-updated',
        version: 1,
        tenantId: 'tenant-a',
        userId: 'user-a',
        sequence: 11,
        occurredAt: '2026-10-01T08:00:00.000Z',
        data: { summary: { unreadCount: 0, lastSequence: 11 } },
      });
    });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list).toHaveBeenLastCalledWith({ limit: 30, unread: true });
    expect(screen.getByLabelText('notifications').textContent).toBe('0');
    expect(screen.getByLabelText('unread').textContent).toBe('0');
  });

  it('normalizes required/actionable preferences before persisting them', async () => {
    const initial: NotificationPreference = {
      module: 'workspace',
      category: 'assignment',
      priority: 'actionable',
      feedEnabled: true,
      toastEnabled: true,
    };
    const fixture = fakeClient({
      preferences: jest.fn().mockResolvedValue([initial]),
      setPreferences: jest.fn().mockImplementation(async (value) => value),
    });
    await renderProvider(fixture.client);

    fireEvent.click(screen.getByText('preference'));

    await waitFor(() => expect(fixture.client.setPreferences).toHaveBeenCalled());
    expect(fixture.client.setPreferences).toHaveBeenLastCalledWith([
      expect.objectContaining({
        module: 'workspace',
        category: 'assignment',
        priority: 'actionable',
        feedEnabled: true,
        toastEnabled: false,
      }),
    ]);
  });
});
