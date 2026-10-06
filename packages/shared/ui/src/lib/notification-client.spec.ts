import { io } from 'socket.io-client';
import { authFetch } from './auth-fetch';
import { BrowserNotificationClient } from './notification-client';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('./auth-fetch', () => ({ authFetch: jest.fn() }));

describe('BrowserNotificationClient list and groups', () => {
  const json = (value: unknown) => ({ ok: true, status: 200, json: async () => value }) as Response;
  beforeEach(() => jest.mocked(authFetch).mockReset());

  it('sends the group and trimmed search filters and reads the group list', async () => {
    jest
      .mocked(authFetch)
      .mockResolvedValueOnce(json({ items: [] }))
      .mockResolvedValueOnce(json([{ module: 'hrm', category: 'approval' }]));
    const client = new BrowserNotificationClient();

    await client.list({ limit: 30, unread: true, module: 'hrm', category: 'approval', query: '  phê duyệt ' });
    await expect(client.groups()).resolves.toEqual([{ module: 'hrm', category: 'approval' }]);

    const first = new URL(String(jest.mocked(authFetch).mock.calls[0][0]), 'http://localhost');
    expect(first.pathname).toBe('/api/realtime/v1/notifications');
    expect(Object.fromEntries(first.searchParams)).toEqual({
      limit: '30',
      unread: 'true',
      module: 'hrm',
      category: 'approval',
      q: 'phê duyệt',
    });
    expect(String(jest.mocked(authFetch).mock.calls[1][0])).toBe('/api/realtime/v1/notifications/groups');
  });

  it('omits an empty search from the request', async () => {
    jest.mocked(authFetch).mockResolvedValueOnce(json({ items: [] }));

    await new BrowserNotificationClient().list({ query: '   ' });

    expect(String(jest.mocked(authFetch).mock.calls[0][0])).toBe('/api/realtime/v1/notifications');
  });
});

describe('BrowserNotificationClient reconnect policy', () => {
  it('spreads reconnect attempts with explicit jittered exponential backoff', () => {
    const socket = {
      on: jest.fn().mockReturnThis(),
      disconnect: jest.fn(),
    };
    jest.mocked(io).mockReturnValue(socket as never);

    new BrowserNotificationClient().connect({
      onConnected: jest.fn(),
      onEvent: jest.fn(),
    });

    expect(io).toHaveBeenCalledWith(
      expect.objectContaining({
        reconnection: true,
        reconnectionDelay: 2_000,
        reconnectionDelayMax: 30_000,
        randomizationFactor: 1,
      }),
    );
  });
});
