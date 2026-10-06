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
  categoryLabel,
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
    groups: jest.fn().mockResolvedValue([]),
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

describe('NotificationDrawer search and group filter', () => {
  const approval: NotificationRecord = {
    ...first,
    id: 'notification-3',
    module: 'hrm',
    category: 'approval',
    title: 'Có yêu cầu cần phê duyệt',
    body: 'Đơn nghỉ phép của Nguyễn Văn A đang chờ bạn phê duyệt.',
    sourceId: 'hrm-1',
    sequence: 12,
  };

  async function openDrawer(client: NotificationClient) {
    render(
      <NotificationProvider client={client}>
        <NotificationBell />
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Thông báo, 1 chưa đọc/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Thông báo, 1 chưa đọc/ }));
  }

  const searchBox = () => screen.getByRole('searchbox', { name: 'Tìm trong thông báo' });

  it('searches on the server after the user stops typing, ignoring case and accents', async () => {
    jest.useFakeTimers();
    try {
      const fixture = fakeClient({
        list: jest
          .fn()
          .mockResolvedValueOnce({ items: [first, approval] })
          .mockResolvedValue({ items: [approval] }),
      });
      await openDrawer(fixture.client);
      await waitFor(() => expect(screen.getByText('Có yêu cầu cần phê duyệt')).toBeTruthy());

      fireEvent.change(searchBox(), { target: { value: '  phe duyet ' } });
      expect(fixture.client.list).toHaveBeenCalledTimes(1);
      await act(async () => {
        jest.advanceTimersByTime(300);
      });

      await waitFor(() => expect(fixture.client.list).toHaveBeenLastCalledWith({ limit: 30, query: 'phe duyet' }));
      await waitFor(() => expect(screen.queryByText('Công việc mới')).toBeNull());
      expect(screen.getByText('Có yêu cầu cần phê duyệt')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('filters by group using the groups the server reports', async () => {
    const fixture = fakeClient({
      groups: jest.fn().mockResolvedValue([
        { module: 'workspace', category: 'assignment' },
        { module: 'hrm', category: 'approval' },
        { module: 'hrm', category: 'request-status' },
      ]),
      list: jest.fn().mockResolvedValue({ items: [first, approval] }),
    });
    await openDrawer(fixture.client);
    await waitFor(() => expect(fixture.client.groups).toHaveBeenCalled());

    fireEvent.click(screen.getByPlaceholderText('Tất cả nhóm'));
    // Module có nhiều loại có thêm mục "cả module"; module một loại chỉ có mục theo loại.
    await waitFor(() => expect(screen.getByText('Nhân sự (tất cả)')).toBeTruthy());
    expect(screen.getByText('Nhân sự · Phê duyệt')).toBeTruthy();
    expect(screen.getByText('Công việc · Giao việc')).toBeTruthy();
    expect(screen.queryByText('Công việc (tất cả)')).toBeNull();

    fireEvent.click(screen.getByText('Nhân sự · Phê duyệt'));
    await waitFor(() =>
      expect(fixture.client.list).toHaveBeenLastCalledWith({ limit: 30, module: 'hrm', category: 'approval' }),
    );
  });

  it('keeps a realtime notification out of the list when it does not match the active search', async () => {
    jest.useFakeTimers();
    try {
      const fixture = fakeClient({ list: jest.fn().mockResolvedValue({ items: [approval] }) });
      await openDrawer(fixture.client);
      fireEvent.change(searchBox(), { target: { value: 'duyet' } });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      await waitFor(() => expect(fixture.client.list).toHaveBeenLastCalledWith({ limit: 30, query: 'duyet' }));

      const handlers = fixture.getHandlers();
      const created = (id: string, sequence: number, notification: NotificationRecord): RealtimeEventEnvelope => ({
        id,
        event: 'notification.created',
        version: 1,
        tenantId: 'tenant-a',
        userId: 'user-a',
        sequence,
        occurredAt: '2026-10-01T09:00:00.000Z',
        data: { notification },
      });
      await act(async () => {
        handlers?.onEvent(created('event-11', 11, { ...second, id: 'other', title: 'Công việc khác', body: 'Không liên quan', sequence: 11 }));
      });
      await act(async () => {
        handlers?.onEvent(created('event-12', 12, { ...approval, id: 'match', title: 'Cần duyệt thêm', sequence: 12 }));
      });

      expect(screen.queryByText('Công việc khác')).toBeNull();
      expect(screen.getByText('Cần duyệt thêm')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a slow response for an older filter when a newer one has already been applied', async () => {
    jest.useFakeTimers();
    try {
      const slow = deferred<{ items: NotificationRecord[] }>();
      const fixture = fakeClient({
        list: jest
          .fn()
          .mockResolvedValueOnce({ items: [first] })
          .mockImplementationOnce(() => slow.promise)
          .mockResolvedValue({ items: [approval] }),
      });
      await openDrawer(fixture.client);
      fireEvent.change(searchBox(), { target: { value: 'cong' } });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      fireEvent.change(searchBox(), { target: { value: 'duyet' } });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      await waitFor(() => expect(screen.getByText('Có yêu cầu cần phê duyệt')).toBeTruthy());

      slow.resolve({ items: [first] });
      await act(async () => slow.promise);

      expect(screen.queryByText('Công việc mới')).toBeNull();
      expect(screen.getByText('Có yêu cầu cần phê duyệt')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('categoryLabel', () => {
  it('shows Vietnamese labels for known categories and keeps unknown technical codes', () => {
    expect(categoryLabel('assignment')).toBe('Giao việc');
    expect(categoryLabel('low-stock')).toBe('Tồn kho thấp');
    expect(categoryLabel('calendar-reminder')).toBe('Nhắc lịch');
    expect(categoryLabel('new-category')).toBe('new-category');
  });
});
