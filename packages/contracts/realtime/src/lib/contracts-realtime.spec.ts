import {
  normalizeNotificationPreference,
  parseRealtimeEventEnvelope,
} from './contracts-realtime.js';

describe('realtime contracts', () => {
  it('rejects envelopes that cannot participate in ordered recovery', () => {
    expect(() =>
      parseRealtimeEventEnvelope({
        id: 'event-1',
        event: 'notification.created',
        version: 1,
        tenantId: 'tenant-1',
        userId: 'user-1',
        sequence: 0,
        occurredAt: '2026-10-01T08:00:00.000Z',
        data: {},
      }),
    ).toThrow('sequence');

    expect(() =>
      parseRealtimeEventEnvelope({
        id: 'event-2',
        event: 'notification.unknown',
        version: 1,
        tenantId: 'tenant-1',
        userId: 'user-1',
        sequence: 1,
        occurredAt: '2026-10-01T08:00:00.000Z',
        data: {},
      }),
    ).toThrow('event');
  });

  it('preserves a valid versioned envelope without changing its payload', () => {
    const input = {
      id: 'event-3',
      event: 'notification.updated',
      version: 1,
      tenantId: 'tenant-1',
      userId: 'user-1',
      sequence: 42,
      occurredAt: '2026-10-01T08:00:00.000Z',
      data: { notificationId: 'notification-1', aggregateCount: 3 },
    } as const;

    expect(parseRealtimeEventEnvelope(input)).toEqual(input);
  });

  it('enforces mandatory feed channels while retaining optional choices', () => {
    expect(
      normalizeNotificationPreference({
        module: 'workspace',
        category: 'assignment',
        priority: 'required',
        feedEnabled: false,
        toastEnabled: false,
      }),
    ).toEqual({
      module: 'workspace',
      category: 'assignment',
      priority: 'required',
      feedEnabled: true,
      toastEnabled: true,
    });

    expect(
      normalizeNotificationPreference({
        module: 'workspace',
        category: 'assignment',
        priority: 'actionable',
        feedEnabled: false,
        toastEnabled: false,
      }),
    ).toEqual({
      module: 'workspace',
      category: 'assignment',
      priority: 'actionable',
      feedEnabled: true,
      toastEnabled: false,
    });
  });
});
