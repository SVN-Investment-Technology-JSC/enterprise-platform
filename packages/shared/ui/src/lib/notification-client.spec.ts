import { io } from 'socket.io-client';
import { BrowserNotificationClient } from './notification-client';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

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
