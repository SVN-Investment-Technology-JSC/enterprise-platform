import type { PostgresPoolRegistry, TenantDatabaseRegistry } from '@enterprise-platform/adapter-database';
import { PostgresSocialSearchStore } from './postgres-social-search.store.js';

const scope = { viewerId: 'viewer-1', seesAllGroups: false, canModerate: false, memberGroupIds: ['g1'], unitIds: ['unit-1'] };

function store(rows: unknown[] = []) {
  const query = jest.fn(async () => ({ rows }));
  const pools = { forTenant: jest.fn(async () => ({ query })) } as unknown as PostgresPoolRegistry;
  const references = { require: jest.fn(() => ({})) } as unknown as TenantDatabaseRegistry;
  return { search: new PostgresSocialSearchStore(references, pools), query };
}

const lastCall = (query: jest.Mock) => {
  const [sql, values] = query.mock.calls[query.mock.calls.length - 1] as [string, unknown[]];
  return { sql: sql.replace(/\s+/g, ' '), values };
};

describe('PostgresSocialSearchStore.searchPosts', () => {
  it('only reads published non-activity posts under the visibility clause and the GIN-indexed expression', async () => {
    const { search, query } = store();
    await search.searchPosts('t1', scope, { tokens: ['hop', 'tong'], limit: 21 });
    const { sql, values } = lastCall(query);
    expect(sql).toContain("p.status = 'published' AND p.kind <> 'activity'");
    expect(sql).toContain("p.status <> 'deleted'");
    expect(sql).toContain('LEFT JOIN social_schema.groups g ON g.id = p.group_id');
    expect(sql).toContain("to_tsvector('simple', p.search_text) @@ to_tsquery('simple', $4)");
    expect(sql).toContain('ORDER BY p.published_at DESC, p.id DESC LIMIT $5');
    expect(values).toEqual([['g1'], 'viewer-1', ['unit-1'], 'hop:* & tong:*', 21]);
  });

  it('adds filters and the cursor as parameters, never inline', async () => {
    const { search, query } = store();
    await search.searchPosts('t1', scope, {
      tokens: ['a1'],
      topicId: 'topic-value',
      groupId: 'group',
      authorId: 'author',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-02T00:00:00.000Z',
      cursor: { at: '2026-10-01T00:00:00.000001Z', id: 'cursor-id' },
      limit: 6,
    });
    const { sql, values } = lastCall(query);
    expect(sql).not.toContain('topic-value');
    expect(sql).toContain('(p.published_at, p.id) < ($10::timestamptz, $11::uuid)');
    expect(values.slice(4)).toEqual([
      'topic-value',
      'group',
      'author',
      '2026-10-01T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
      '2026-10-01T00:00:00.000001Z',
      'cursor-id',
      6,
    ]);
  });

  it('maps rows including group columns', async () => {
    const { search } = store([
      {
        id: 'p1',
        author_id: 'a1',
        kind: 'post',
        title: null,
        body_html: '<p>Họp</p>',
        topic_id: null,
        topic_name: null,
        pinned: false,
        mentions_all: false,
        published_at: '2026-10-01T00:00:00.000001Z',
        edited_at: null,
        comment_count: 2,
        status: 'published',
        group_id: 'g1',
        group_name: 'Dự án A',
        group_privacy: 'private',
        group_color: 'blue',
        group_icon: 'users',
        group_deleted: false,
        scheduled_at: null,
        moderated_by: null,
        moderated_at: null,
        reject_reason: null,
        requires_read_confirmation: true,
      },
    ]);
    const [post] = await search.searchPosts('t1', scope, { tokens: ['hop'], limit: 5 });
    expect(post).toMatchObject({
      id: 'p1',
      bodyHtml: '<p>Họp</p>',
      commentCount: 2,
      groupId: 'g1',
      groupPrivacy: 'private',
      groupDeleted: false,
      requiresReadConfirmation: true,
    });
  });
});

describe('PostgresSocialSearchStore.searchGroups', () => {
  it('hides private groups from non-members unless the viewer sees every group', async () => {
    const { search, query } = store();
    await search.searchGroups('t1', scope, { tokens: ['du', 'an'], limit: 6 });
    let call = lastCall(query);
    expect(call.sql).toContain("g.deleted_at IS NULL AND (g.privacy = 'public' OR FALSE OR mm.user_id IS NOT NULL)");
    expect(call.sql).toContain('g.search_text LIKE ALL ($2::text[])');
    expect(call.values).toEqual(['viewer-1', ['%du%', '%an%'], 6]);

    await search.searchGroups('t1', { ...scope, seesAllGroups: true }, { tokens: ['du'], limit: 6 });
    call = lastCall(query);
    expect(call.sql).toContain("g.privacy = 'public' OR TRUE");
  });

  it('maps membership and pending request', async () => {
    const { search } = store([
      {
        id: 'g1',
        name: 'Dự án A',
        description: null,
        privacy: 'private',
        color: 'teal',
        icon: 'rocket',
        created_at: '2026-09-01T00:00:00.000001Z',
        member_count: 4,
        my_role: null,
        my_joined_at: null,
        my_request_id: 'r1',
      },
    ]);
    const [group] = await search.searchGroups('t1', { ...scope, seesAllGroups: true }, { tokens: ['du'], limit: 5 });
    expect(group).toEqual({
      id: 'g1',
      name: 'Dự án A',
      privacy: 'private',
      color: 'teal',
      icon: 'rocket',
      memberCount: 4,
      myJoinRequestId: 'r1',
      createdAt: '2026-09-01T00:00:00.000001Z',
    });
  });
});

describe('PostgresSocialSearchStore.countVisibleAuthorPosts', () => {
  it('counts published non-activity posts of one author under the visibility clause', async () => {
    const { search, query } = store([{ total: 9 }]);
    await expect(search.countVisibleAuthorPosts('t1', scope, 'author-1')).resolves.toBe(9);
    const { sql, values } = lastCall(query);
    expect(sql).toContain("p.status = 'published' AND p.kind <> 'activity'");
    expect(sql).toContain('p.author_id = $4::uuid');
    expect(values).toEqual([['g1'], 'viewer-1', ['unit-1'], 'author-1']);
  });
});

describe('PostgresSocialSearchStore errors', () => {
  it('reports an unprovisioned tenant when the table is missing', async () => {
    const query = jest.fn(async () => {
      throw Object.assign(new Error('missing'), { code: '42P01' });
    });
    const pools = { forTenant: jest.fn(async () => ({ query })) } as unknown as PostgresPoolRegistry;
    const references = { require: jest.fn(() => ({})) } as unknown as TenantDatabaseRegistry;
    const search = new PostgresSocialSearchStore(references, pools);
    await expect(search.countVisibleAuthorPosts('t1', scope, 'a')).rejects.toMatchObject({
      code: 'MODULE_NOT_PROVISIONED',
    });
  });
});
