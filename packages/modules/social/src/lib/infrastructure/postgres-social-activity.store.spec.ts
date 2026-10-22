import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { PostgresSocialActivityStore } from './postgres-social-activity.store.js';

function store(insertedRows: number) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, values: unknown[] = []) => {
      statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      return { rowCount: sql.includes('INSERT INTO social_schema.posts') ? insertedRows : 0, rows: [] };
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(async () => client) };
  const pools = { forTenant: jest.fn(async () => pool) } as unknown as PostgresPoolRegistry;
  const references = { require: jest.fn(() => ({})) } as unknown as TenantDatabaseRegistry;
  return { activities: new PostgresSocialActivityStore(references, pools), statements };
}

const input = {
  id: '50000000-0000-4000-8000-000000000001',
  authorId: '20000000-0000-4000-8000-000000000001',
  type: 'avatar.updated' as const,
  payload: {},
  timeZone: 'Asia/Ho_Chi_Minh',
  authorName: 'Bình',
};

describe('PostgresSocialActivityStore.insertDaily', () => {
  it('locks per author and type, inserts once per day and writes the outbox event in the same transaction', async () => {
    const { activities, statements } = store(1);
    await expect(activities.insertDaily('t1', input)).resolves.toBe(true);

    const sqls = statements.map((statement) => statement.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toContain('pg_advisory_xact_lock');
    expect(sqls[2]).toContain("'activity', '', 'published'");
    expect(sqls[2]).toContain('WHERE NOT EXISTS');
    expect(sqls[2]).toContain('(published_at AT TIME ZONE $5::text)::date = (now() AT TIME ZONE $5::text)::date');
    expect(statements[2].values).toEqual([input.id, input.authorId, 'avatar.updated', '{}', 'Asia/Ho_Chi_Minh']);
    expect(sqls[3]).toContain('INSERT INTO integration_schema.outbox_events');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');

    const envelope = JSON.parse(statements[3].values[5] as string) as { type: string; payload: Record<string, unknown> };
    expect(envelope.type).toBe('social.post.published');
    expect(envelope.payload).toEqual({
      postId: input.id,
      authorId: input.authorId,
      authorName: 'Bình',
      kind: 'post',
      mentionsAll: false,
    });
  });

  it('writes nothing more when the daily limit blocks the insert', async () => {
    const { activities, statements } = store(0);
    await expect(activities.insertDaily('t1', input)).resolves.toBe(false);
    expect(statements.some((statement) => statement.sql.includes('outbox_events'))).toBe(false);
  });
});
