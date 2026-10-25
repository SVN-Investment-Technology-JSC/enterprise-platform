import { randomUUID } from 'node:crypto';
import { SOCIAL_FEED_PAGE_SIZE, type SocialPost } from '@enterprise-platform/contracts-social';
import { SocialError } from '../domain/social.error.js';
import { PostVisibilityService } from './post-visibility.service.js';
import type { GroupAccessInfo, GroupMembershipPort } from './ports/group-membership.port.js';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import {
  canViewPostInScope,
  type PostVisibilityScope,
  type PostVisibilitySubject,
} from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { FeedPageRead, FeedRead, SocialFeedStore } from './social-feed-store.port.js';
import { SocialFeedService } from './social-feed.service.js';

const TENANT = 'tenant-1';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const PUBLIC_GROUP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIVATE_GROUP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DELETED_GROUP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function actor(userId: string, flags: Partial<SocialActor> = {}): SocialActor {
  return {
    tenantId: TENANT,
    userId,
    displayName: 'Ai đó',
    isTenantAdmin: false,
    canRead: false,
    canWrite: false,
    canModerate: false,
    canManage: false,
    ...flags,
  };
}

const GROUPS: Record<string, GroupAccessInfo> = {
  [PUBLIC_GROUP]: { id: PUBLIC_GROUP, name: 'Mở', privacy: 'public', color: 'blue', icon: 'users', deleted: false },
  [PRIVATE_GROUP]: { id: PRIVATE_GROUP, name: 'Kín', privacy: 'private', color: 'red', icon: 'star', deleted: false },
  [DELETED_GROUP]: { id: DELETED_GROUP, name: 'Đã xoá', privacy: 'public', color: 'blue', icon: 'users', deleted: true },
};

/** Cổng thành viên giả: mỗi người là thành viên của các nhóm khai ở `memberships`. */
function membershipPort(memberships: Record<string, readonly string[]>): GroupMembershipPort {
  return {
    getGroup: async (_t, groupId) => GROUPS[groupId],
    membershipOf: async (_t, groupId, userId) =>
      memberships[userId]?.includes(groupId) ? { role: 'member', joinedAt: '2026-01-01T00:00:00.000Z' } : undefined,
    isMember: async (_t, groupId, userId) => memberships[userId]?.includes(groupId) ?? false,
    isAdmin: async () => false,
    memberGroupIds: async (_t, userId) => memberships[userId] ?? [],
    listMemberIds: async () => [],
    listAdminIds: async () => [],
    groupRefs: async () => new Map(),
  };
}

function row(id: string, overrides: Partial<ExtendedPostRow> = {}): ExtendedPostRow {
  return {
    id,
    authorId: ALICE,
    kind: 'post',
    bodyHtml: '<p>x</p>',
    pinned: false,
    mentionsAll: false,
    publishedAt: '2026-01-01T00:00:00.000000Z',
    commentCount: 0,
    status: 'published',
    requiresReadConfirmation: false,
    ...overrides,
  };
}

/** Store giả ghi lại truy vấn nhận được và trả các dòng đã dựng sẵn. */
class FakeFeedStore implements SocialFeedStore {
  pageReads: FeedPageRead[] = [];
  pinnedReads: FeedRead[] = [];
  constructor(
    private readonly pageRows: ExtendedPostRow[] = [],
    private readonly pinnedRows: ExtendedPostRow[] = [],
  ) {}

  async page(_t: string, read: FeedPageRead): Promise<ExtendedPostRow[]> {
    this.pageReads.push(read);
    return this.pageRows.slice(0, read.limit);
  }

  async pinned(_t: string, read: FeedRead): Promise<ExtendedPostRow[]> {
    this.pinnedReads.push(read);
    return this.pinnedRows;
  }
}

const assembler: PostViewAssembler = {
  assemble: async (_actor, rows) => rows.map((r) => ({ id: r.id }) as unknown as SocialPost),
};

const TOPIC = 'e0000000-0000-4000-8000-00000000000a';
const FOREIGN_TOPIC = 'e0000000-0000-4000-8000-00000000000b';

/** Chủ đề `TOPIC` thuộc nhóm mở; `FOREIGN_TOPIC` thuộc nhóm khác. */
const posting = {
  topicsOfGroup: async (_t: string, groupId: string, ids: readonly string[]) =>
    new Map(groupId === PUBLIC_GROUP ? ids.filter((id) => id === TOPIC).map((id) => [id, { id, name: 'Chủ đề' }] as const) : []),
};

function service(store: SocialFeedStore, memberships: Record<string, readonly string[]> = {}) {
  const membership = membershipPort(memberships);
  return new SocialFeedService(store, new PostVisibilityService(membership), membership, assembler, posting);
}

async function expectCode(promise: Promise<unknown>, code: string, statusCode: number): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SocialError);
  expect({ code: (error as SocialError).code, statusCode: (error as SocialError).statusCode }).toEqual({
    code,
    statusCode,
  });
}

describe('SocialFeedService', () => {
  it('mặc định là Tường công ty (scope wall), giống P1', async () => {
    const store = new FakeFeedStore();
    await service(store).feed(actor(ALICE));
    expect(store.pageReads[0]).toMatchObject({ source: 'wall', limit: SOCIAL_FEED_PAGE_SIZE + 1 });
    expect(store.pageReads[0].groupId).toBeUndefined();
  });

  it('chuyển bộ lọc và scope xuống store, kèm luật nhìn thấy của người xem', async () => {
    const store = new FakeFeedStore();
    const topicId = randomUUID();
    await service(store, { [ALICE]: [PUBLIC_GROUP] }).feed(actor(ALICE, { canModerate: true }), {
      scope: 'all',
      topicId,
      kind: 'announcement',
      authorId: BOB,
    });
    expect(store.pageReads[0]).toMatchObject({
      source: 'all',
      topicId,
      kind: 'announcement',
      authorId: BOB,
      visibility: { viewerId: ALICE, canModerate: true, seesAllGroups: false, memberGroupIds: [PUBLIC_GROUP] },
    });
  });

  it('có groupId thì đọc bài của nhóm đó', async () => {
    const store = new FakeFeedStore();
    await service(store, { [ALICE]: [PRIVATE_GROUP] }).feed(actor(ALICE), { groupId: PRIVATE_GROUP, scope: 'wall' });
    expect(store.pageReads[0].groupId).toBe(PRIVATE_GROUP);
  });

  it('chỉ trang đầu có bài ghim, đứng trước bài thường', async () => {
    const store = new FakeFeedStore([row('b'), row('c')], [row('a', { pinned: true })]);
    const first = await service(store).feed(actor(ALICE));
    expect(first.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);

    const cursor = Buffer.from(JSON.stringify(['2026-01-01T00:00:00.000000Z', randomUUID()])).toString('base64url');
    const next = await service(store).feed(actor(ALICE), { cursor });
    expect(next.items.map((item) => item.id)).toEqual(['b', 'c']);
    expect(store.pinnedReads).toHaveLength(1);
  });

  it('có trang kế tiếp thì trả con trỏ theo bài cuối của trang', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const id3 = randomUUID();
    const store = new FakeFeedStore([
      row(id1, { publishedAt: '2026-01-03T00:00:00.123456Z' }),
      row(id2, { publishedAt: '2026-01-02T00:00:00.123456Z' }),
      row(id3, { publishedAt: '2026-01-01T00:00:00.123456Z' }),
    ]);
    const page = await service(store).feed(actor(ALICE), { limit: 2 });
    expect(page.items).toHaveLength(2);
    const decoded = JSON.parse(Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8')) as string[];
    expect(decoded).toEqual(['2026-01-02T00:00:00.123456Z', id2]);
  });

  it('tham số sai bị từ chối trước khi chạm DB', async () => {
    const store = new FakeFeedStore();
    const svc = service(store);
    await expectCode(svc.feed(actor(ALICE), { scope: 'moon' as 'all' }), 'VALIDATION', 400);
    await expectCode(svc.feed(actor(ALICE), { kind: 'activity' as 'post' }), 'VALIDATION', 400);
    await expectCode(svc.feed(actor(ALICE), { authorId: 'abc' }), 'VALIDATION', 400);
    await expectCode(svc.feed(actor(ALICE), { cursor: 'rác' }), 'VALIDATION', 400);
    expect(store.pageReads).toEqual([]);
  });

  describe('bảng tin của nhóm', () => {
    it('nhóm công khai: ai cũng đọc được', async () => {
      const store = new FakeFeedStore();
      await service(store).groupFeed(actor(BOB), PUBLIC_GROUP);
      expect(store.pageReads[0].groupId).toBe(PUBLIC_GROUP);
    });

    it('nhóm riêng tư: thành viên và quản trị toàn hệ thống đọc được, người ngoài nhận 404', async () => {
      const store = new FakeFeedStore();
      const svc = service(store, { [ALICE]: [PRIVATE_GROUP] });
      await svc.groupFeed(actor(ALICE), PRIVATE_GROUP);
      await svc.groupFeed(actor(BOB, { canManage: true }), PRIVATE_GROUP);
      await svc.groupFeed(actor(BOB, { isTenantAdmin: true }), PRIVATE_GROUP);
      // `social.post.moderate` KHÔNG cho vào nhóm riêng tư.
      await expectCode(svc.groupFeed(actor(BOB, { canModerate: true }), PRIVATE_GROUP), 'GROUP_NOT_FOUND', 404);
      await expectCode(svc.groupFeed(actor(BOB), PRIVATE_GROUP), 'GROUP_NOT_FOUND', 404);
      expect(store.pageReads).toHaveLength(3);
    });

    it('nhóm không có, mã sai hoặc đã xoá: 404', async () => {
      const svc = service(new FakeFeedStore());
      await expectCode(svc.groupFeed(actor(ALICE), randomUUID()), 'GROUP_NOT_FOUND', 404);
      await expectCode(svc.groupFeed(actor(ALICE), 'abc'), 'GROUP_NOT_FOUND', 404);
      await expectCode(svc.groupFeed(actor(ALICE), DELETED_GROUP), 'GROUP_NOT_FOUND', 404);
    });

    it('GET /feed?groupId= cũng kiểm quyền xem nhóm', async () => {
      const svc = service(new FakeFeedStore());
      await expectCode(svc.feed(actor(BOB), { groupId: PRIVATE_GROUP }), 'GROUP_NOT_FOUND', 404);
    });
  });
});

describe('SocialFeedService: lọc theo chủ đề của nhóm (đợt 2)', () => {
  it('bảng tin nhóm lọc theo groupTopicId và chuyển xuống store', async () => {
    const store = new FakeFeedStore();
    await service(store).groupFeed(actor(ALICE), PUBLIC_GROUP, { groupTopicId: TOPIC });
    expect(store.pageReads[0]).toMatchObject({ groupId: PUBLIC_GROUP, groupTopicId: TOPIC });
    await service(store).feed(actor(ALICE), { groupId: PUBLIC_GROUP, groupTopicId: TOPIC });
    expect(store.pageReads[1]).toMatchObject({ groupId: PUBLIC_GROUP, groupTopicId: TOPIC });
  });

  it('không có groupId, chủ đề không thuộc nhóm hoặc mã sai: 400 VALIDATION', async () => {
    const store = new FakeFeedStore();
    await expectCode(service(store).feed(actor(ALICE), { groupTopicId: TOPIC }), 'VALIDATION', 400);
    await expectCode(service(store).groupFeed(actor(ALICE), PUBLIC_GROUP, { groupTopicId: FOREIGN_TOPIC }), 'VALIDATION', 400);
    await expectCode(service(store).groupFeed(actor(ALICE), PUBLIC_GROUP, { groupTopicId: 'abc' }), 'VALIDATION', 400);
    expect(store.pageReads).toHaveLength(0);
  });

  it('nhóm riêng tư người ngoài vẫn 404 trước khi nói gì về chủ đề', async () => {
    await expectCode(
      service(new FakeFeedStore()).groupFeed(actor(BOB), PRIVATE_GROUP, { groupTopicId: TOPIC }),
      'GROUP_NOT_FOUND',
      404,
    );
  });
});

describe('PostVisibilityService', () => {
  const memberships = { [ALICE]: [PRIVATE_GROUP, PUBLIC_GROUP] };
  const UNIT_A = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';
  const viewerScopes = {
    scopeOf: async (_t: string, userId: string) => ({ userId, unitIds: userId === ALICE ? [UNIT_A] : [] }),
    scopesOf: async () => new Map(),
    authorUnitOf: async () => undefined,
  };
  const port = new PostVisibilityService(membershipPort(memberships), viewerScopes);

  it('dựng scope từ quyền và nhóm của người xem', async () => {
    expect(await port.scopeFor(actor(ALICE))).toEqual({
      viewerId: ALICE,
      seesAllGroups: false,
      canModerate: false,
      memberGroupIds: [PRIVATE_GROUP, PUBLIC_GROUP],
      unitIds: [UNIT_A],
    });
    expect(await port.scopeFor(actor(BOB, { canManage: true }))).toMatchObject({ seesAllGroups: true, canModerate: false });
    expect(await port.scopeFor(actor(BOB, { canModerate: true }))).toMatchObject({ seesAllGroups: false, canModerate: true });
    expect(await port.scopeFor(actor(BOB, { isTenantAdmin: true }))).toMatchObject({
      seesAllGroups: true,
      canModerate: true,
    });
  });

  it('quyền xem đợt 2: phòng ban của người xem lấy từ ViewerScopePort; cổng lỗi thì rỗng, không mở rộng quyền', async () => {
    const unitPost = { authorId: BOB, status: 'published', visibility: 'unit', authorUnitId: UNIT_A } as const;
    expect(await port.canView(actor(ALICE), unitPost)).toBe(true);
    expect(await port.canView(actor(BOB), unitPost)).toBe(true); // tác giả luôn thấy bài của mình
    expect(await port.canView(actor('99999999-9999-4999-8999-999999999999'), unitPost)).toBe(false);
    expect(await port.canView(actor(ALICE, { isTenantAdmin: true }), { ...unitPost, authorUnitId: 'khac' })).toBe(false);

    const failing = new PostVisibilityService(membershipPort(memberships), {
      ...viewerScopes,
      scopeOf: async () => {
        throw new Error('Core lỗi');
      },
    });
    expect((await failing.scopeFor(actor(ALICE))).unitIds).toEqual([]);
    expect(await failing.canView(actor(ALICE), unitPost)).toBe(false);
    expect(await failing.canView(actor(ALICE), { ...unitPost, visibility: 'company' })).toBe(true);
    // Không có cổng (đợt 1): cũng không mở rộng.
    expect((await new PostVisibilityService(membershipPort(memberships)).scopeFor(actor(ALICE))).unitIds).toEqual([]);
  });

  it('canView khớp với luật thuần canViewPostInScope trên mọi tổ hợp', async () => {
    const viewers = [actor(ALICE), actor(BOB), actor(BOB, { canModerate: true }), actor(BOB, { canManage: true })];
    const subjects: PostVisibilitySubject[] = [];
    for (const status of ['published', 'pending', 'scheduled', 'rejected', 'deleted'] as const) {
      for (const authorId of [ALICE, BOB]) {
        subjects.push({ authorId, status });
        for (const [groupId, groupPrivacy, groupDeleted] of [
          [PUBLIC_GROUP, 'public', false],
          [PRIVATE_GROUP, 'private', false],
          [DELETED_GROUP, 'public', true],
        ] as const) {
          subjects.push({ authorId, status, groupId, groupPrivacy, groupDeleted });
        }
      }
    }
    for (const viewer of viewers) {
      const scope: PostVisibilityScope = await port.scopeFor(viewer);
      for (const subject of subjects) {
        expect(await port.canView(viewer, subject)).toBe(canViewPostInScope(scope, subject));
      }
    }
  });

  it('luật cụ thể: bài nhóm riêng tư, bài chưa đăng, bài đã xoá', async () => {
    const privatePost = { authorId: BOB, status: 'published', groupId: PRIVATE_GROUP, groupPrivacy: 'private' } as const;
    expect(await port.canView(actor(ALICE), privatePost)).toBe(true);
    expect(await port.canView(actor(BOB), privatePost)).toBe(false); // tác giả đã rời nhóm: không còn thấy
    expect(await port.canView(actor(BOB, { canModerate: true }), { ...privatePost, authorId: ALICE })).toBe(false);
    expect(await port.canView(actor(ALICE, { canManage: true }), { ...privatePost, authorId: BOB })).toBe(true);

    const pending = { authorId: ALICE, status: 'pending' } as const;
    expect(await port.canView(actor(ALICE), pending)).toBe(true);
    expect(await port.canView(actor(BOB), pending)).toBe(false);
    expect(await port.canView(actor(BOB, { canModerate: true }), pending)).toBe(true);
    expect(await port.canView(actor(ALICE, { isTenantAdmin: true }), { authorId: ALICE, status: 'deleted' })).toBe(false);
  });
});
