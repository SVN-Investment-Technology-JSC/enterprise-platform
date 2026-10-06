import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  PostgresNotificationScheduler,
  calendarReminderSchedule,
  procedureSlaSchedules,
  type NotificationScheduleCandidate,
} from './notification-scheduler.js';

const candidate: NotificationScheduleCandidate = {
  scheduleKey: 'workspace:calendar:event-1:reminder',
  eventType: 'workspace.calendar-event.reminder',
  aggregateType: 'workspace-calendar-event',
  aggregateId: '20000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000002',
  scheduledFor: '2026-10-25T00:45:00.000Z',
  payload: {
    eventId: '20000000-0000-4000-8000-000000000001',
    participantUserIds: ['20000000-0000-4000-8000-000000000002'],
  },
};

interface FakeDatabase {
  readonly emissions: Set<string>;
  readonly outbox: unknown[][];
  lockAvailable: boolean;
  failOutbox: boolean;
}

function fakePool(database: FakeDatabase): Pool {
  const stagedEmissions = new Set<string>();
  const stagedOutbox: unknown[][] = [];
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql === 'BEGIN') {
        return result([]);
      }
      if (sql === 'COMMIT') {
        for (const key of stagedEmissions) database.emissions.add(key);
        database.outbox.push(...stagedOutbox);
        stagedEmissions.clear();
        stagedOutbox.length = 0;
        return result([]);
      }
      if (sql === 'ROLLBACK') {
        stagedEmissions.clear();
        stagedOutbox.length = 0;
        return result([]);
      }
      if (sql.includes('pg_try_advisory_xact_lock')) {
        return result([{ acquired: database.lockAvailable }]);
      }
      if (sql.includes('notification_schema.schedule_emissions')) {
        const key = `${values[0]}:${values[1]}:${values[2]}`;
        if (database.emissions.has(key) || stagedEmissions.has(key)) return result([]);
        stagedEmissions.add(key);
        return result([{ event_id: values[3] }]);
      }
      if (sql.includes('integration_schema.outbox_events')) {
        if (database.failOutbox) throw new Error('outbox unavailable');
        stagedOutbox.push(values);
        return result([]);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release: jest.fn(),
  } as unknown as PoolClient;
  return {
    connect: jest.fn(async () => client),
  } as unknown as Pool;
}

function result<T>(rows: T[]): QueryResult<T & Record<string, unknown>> {
  return { rows, rowCount: rows.length } as QueryResult<T & Record<string, unknown>>;
}

describe('notification scheduler', () => {
  it('calculates a 15-minute reminder from the absolute occurrence across DST', () => {
    expect(
      calendarReminderSchedule({
        eventId: candidate.aggregateId,
        userId: candidate.userId,
        title: 'DST handover',
        startAt: '2026-10-25T02:00:00+01:00',
        timezone: 'Europe/Berlin',
      }),
    ).toMatchObject({
      scheduleKey: `workspace:calendar:${candidate.aggregateId}:reminder`,
      scheduledFor: '2026-10-25T00:45:00.000Z',
      eventType: 'workspace.calendar-event.reminder',
    });
  });

  it('plans separate one-hour warning and breach emissions for every SLA recipient', () => {
    const schedules = procedureSlaSchedules({
      instanceId: '40000000-0000-4000-8000-000000000001',
      stepInstanceId: '40000000-0000-4000-8000-000000000002',
      title: 'Duyệt đề nghị',
      dueAt: '2026-10-01T10:00:00.000Z',
      recipientUserIds: [
        '40000000-0000-4000-8000-000000000003',
        '40000000-0000-4000-8000-000000000004',
      ],
    });

    expect(schedules).toHaveLength(4);
    expect(schedules.map((item) => item.scheduledFor)).toEqual([
      '2026-10-01T09:00:00.000Z',
      '2026-10-01T10:00:00.000Z',
      '2026-10-01T09:00:00.000Z',
      '2026-10-01T10:00:00.000Z',
    ]);
    expect(schedules.map((item) => item.eventType)).toEqual([
      'procedure.sla.warning',
      'procedure.sla.breached',
      'procedure.sla.warning',
      'procedure.sla.breached',
    ]);
  });

  it('emits once when replicas evaluate the same due schedule', async () => {
    const database: FakeDatabase = {
      emissions: new Set(),
      outbox: [],
      lockAvailable: true,
      failOutbox: false,
    };
    const ids = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
    const scheduler = new PostgresNotificationScheduler(
      fakePool(database),
      () => ids.shift() ?? '30000000-0000-4000-8000-000000000003',
    );

    await expect(
      scheduler.emitDue(
        '30000000-0000-4000-8000-000000000004',
        [candidate],
        new Date('2026-10-25T00:45:30.000Z'),
      ),
    ).resolves.toBe(1);
    await expect(
      scheduler.emitDue(
        '30000000-0000-4000-8000-000000000004',
        [candidate],
        new Date('2026-10-25T00:46:00.000Z'),
      ),
    ).resolves.toBe(0);
    expect(database.outbox).toHaveLength(1);
    expect(String(database.outbox[0][5])).toContain(
      'workspace.calendar-event.reminder',
    );
  });

  it('does no work when another replica owns the tenant advisory lock', async () => {
    const database: FakeDatabase = {
      emissions: new Set(),
      outbox: [],
      lockAvailable: false,
      failOutbox: false,
    };
    const scheduler = new PostgresNotificationScheduler(fakePool(database));

    await expect(
      scheduler.emitDue(
        '30000000-0000-4000-8000-000000000004',
        [candidate],
        new Date('2026-10-25T00:46:00.000Z'),
      ),
    ).resolves.toBe(0);
    expect(database.outbox).toHaveLength(0);
  });

  it('rolls back the idempotency claim when the outbox write fails', async () => {
    const database: FakeDatabase = {
      emissions: new Set(),
      outbox: [],
      lockAvailable: true,
      failOutbox: true,
    };
    const scheduler = new PostgresNotificationScheduler(fakePool(database));

    await expect(
      scheduler.emitDue(
        '30000000-0000-4000-8000-000000000004',
        [candidate],
        new Date('2026-10-25T00:46:00.000Z'),
      ),
    ).rejects.toThrow('outbox unavailable');
    expect(database.emissions.size).toBe(0);
    expect(database.outbox).toHaveLength(0);
  });
});
