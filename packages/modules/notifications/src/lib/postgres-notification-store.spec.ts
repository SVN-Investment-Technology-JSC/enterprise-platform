import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  PostgresNotificationStore,
  type NotificationEventInput,
  type ResolvedNotificationPolicy,
} from './postgres-notification-store.js';

const event: NotificationEventInput = {
  id: '10000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  type: 'workspace.work-item.assigned',
  version: 1,
  occurredAt: '2026-10-01T08:00:00.000Z',
  sourceType: 'workspace_work_item',
  sourceId: 'work-item-42',
  title: 'Bạn có công việc mới',
  body: 'Công việc đã được giao cho bạn.',
  deepLink: '/workspace/work-items/42',
};

const policy: ResolvedNotificationPolicy = {
  module: 'workspace',
  category: 'assignment',
  priority: 'actionable',
  feedEnabled: true,
  toastEnabled: true,
};

function result(rowCount = 0, rows: readonly unknown[] = []): QueryResult {
  return {
    command: '',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  } as QueryResult;
}

function fakePool(
  execute: (sql: string) => Promise<QueryResult>,
): { pool: Pool; statements: string[]; release: jest.Mock } {
  const statements: string[] = [];
  const release = jest.fn();
  const client = {
    query: jest.fn(async (sql: string) => {
      statements.push(sql.trim());
      return execute(sql.trim());
    }),
    release,
  } as unknown as PoolClient;
  return {
    pool: { connect: jest.fn(async () => client) } as unknown as Pool,
    statements,
    release,
  };
}

describe('PostgresNotificationStore transaction boundary', () => {
  it('commits an inbox duplicate without mutating user state', async () => {
    const database = fakePool(async (sql) =>
      sql.startsWith('INSERT INTO notification_schema.inbox_messages')
        ? result(0)
        : result(),
    );
    const store = new PostgresNotificationStore(database.pool);

    await expect(store.process(event, policy)).resolves.toEqual({
      status: 'duplicate',
    });
    expect(database.statements).toEqual([
      'BEGIN',
      expect.stringContaining('notification_schema.inbox_messages'),
      'COMMIT',
    ]);
    expect(database.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back the inbox claim when user-state mutation fails', async () => {
    const failure = new Error('foreign key violation');
    const database = fakePool(async (sql) => {
      if (sql.startsWith('INSERT INTO notification_schema.inbox_messages')) {
        return result(1, [{ event_id: event.id }]);
      }
      if (sql.startsWith('INSERT INTO notification_schema.user_state')) {
        throw failure;
      }
      return result();
    });
    const store = new PostgresNotificationStore(database.pool);

    await expect(store.process(event, policy)).rejects.toBe(failure);
    expect(database.statements.at(-1)).toBe('ROLLBACK');
    expect(database.statements).not.toContain('COMMIT');
    expect(database.release).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-origin deep links before opening a transaction', async () => {
    const database = fakePool(async () => result());
    const store = new PostgresNotificationStore(database.pool);

    await expect(
      store.process({ ...event, deepLink: '//external.example/path' }, policy),
    ).rejects.toThrow('deepLink must be a same-origin path');
    expect(database.statements).toEqual([]);
  });
});
