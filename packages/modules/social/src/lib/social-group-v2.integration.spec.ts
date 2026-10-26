import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPostgresPool } from '@enterprise-platform/adapter-database';
import type { SocialActor } from './application/social-actor.js';
import { GroupPostingAdapter } from './application/group-posting.adapter.js';
import { SocialGroupMemberService } from './application/social-group-member.service.js';
import { SocialGroupPriorityService } from './application/social-group-priority.service.js';
import { SocialGroupSyncService } from './application/social-group-sync.service.js';
import { SocialGroupTopicService } from './application/social-group-topic.service.js';
import { SocialGroupService } from './application/social-group.service.js';
import { SocialReportService } from './application/social-report.service.js';
import { PostgresSocialGroupV2Store } from './infrastructure/postgres-social-group-v2.store.js';
import { PostgresSocialGroupStore } from './infrastructure/postgres-social-group.store.js';
import { PostgresSocialReportStore } from './infrastructure/postgres-social-report.store.js';

/**
 * Nhóm đợt 2 (store Postgres thật): tạo theo phòng ban, quyền đăng bài, đồng bộ/prune, ưu tiên, gợi ý, chủ đề,
 * báo cáo. Chạy với PostgreSQL dùng một lần ở máy, ví dụ
 * `SOCIAL_TEST_ADMIN_URL=postgresql://tenant:tenant@localhost:15436/postgres`; tự tạo DB tạm (áp migration
 * 0001-0004, 0004 chạy hai lần) rồi xoá. Bỏ qua khi không đặt biến môi trường. Sơ đồ tổ chức và cổng tra
 * đối tượng báo cáo là bản giả (BE-V cấp bản thật).
 */
// Tạo DB tạm và áp toàn bộ migration có thể quá 5 giây (mặc định của Jest) khi máy bận hoặc nhiều suite chạy song song.
jest.setTimeout(30_000);
const integration = process.env.SOCIAL_TEST_ADMIN_URL ? describe : describe.skip;
const MIGRATIONS = [
  'tenant/0001-integration.sql',
  'tenant/social/0001-social-feed.sql',
  'tenant/social/0002-social-groups.sql',
  'tenant/social/0003-social-post-p2.sql',
  'tenant/social/0004-social-visibility-groups-v2.sql',
  'tenant/social/0005-social-comment-reactions.sql',
  'tenant/social/0006-social-comment-attachments.sql',
  'tenant/social/0007-social-video-processing.sql',
  'tenant/social/0008-social-post-media-layout.sql',
  'tenant/social/0009-social-post-topics.sql',
  'tenant/social/0010-social-more-reactions.sql',
  'tenant/social/0011-social-bookmark-folders.sql',
];

function actor(tenantId: string, userId: string, over: Partial<SocialActor> = {}): SocialActor {
  return {
    tenantId,
    userId,
    displayName: 'Ai đó',
    isTenantAdmin: false,
    canRead: true,
    canWrite: true,
    canModerate: false,
    canManage: false,
    ...over,
  };
}

integration('Nhóm đợt 2 trên PostgreSQL thật', () => {
  const databaseName = 'social_tmp_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const [alice, bob, carol, dave, erin] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const unit = randomUUID();
  let unitMembers = [bob, carol];
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let groups: SocialGroupService;
  let members: SocialGroupMemberService;
  let topics: SocialGroupTopicService;
  let priority: SocialGroupPriorityService;
  let sync: SocialGroupSyncService;
  let reports: SocialReportService;
  let posting: GroupPostingAdapter;
  const posts = new Map<string, { authorId: string; groupId?: string; groupPrivacy?: 'public' | 'private' }>();

  beforeAll(async () => {
    const url = new URL(process.env.SOCIAL_TEST_ADMIN_URL as string);
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of MIGRATIONS) {
      await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));
    }
    // chạy lại migration 0004 để kiểm idempotent
    await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', MIGRATIONS[4] as string), 'utf8'));

    const references = { require: () => ({ tenantId }) } as never;
    const pools = { forTenant: async () => pool } as never;
    const store = new PostgresSocialGroupStore(references, pools);
    const v2 = new PostgresSocialGroupV2Store(references, pools);
    const reportStore = new PostgresSocialReportStore(references, pools);
    const directory = {
      resolve: async (_t: string, ids: readonly string[]) =>
        new Map(ids.map((id) => [id.toLowerCase(), { id, name: `Người ${id.slice(0, 4)}` }])),
      search: async () => [],
    };
    const org = {
      listNodes: async () => [],
      nodeRefs: async (_t: string, ids: readonly string[]) =>
        new Map(ids.filter((id) => id === unit).map((id) => [id, { id, name: 'Phòng A', kind: 'unit' as const }])),
      memberIdsOf: async () => unitMembers,
    };
    const resolver = {
      resolveForReporter: async (_a: SocialActor, type: 'post' | 'comment', id: string) => {
        const post = posts.get(id);
        if (!post || type !== 'post') return undefined;
        return {
          targetType: 'post' as const,
          targetId: id,
          postId: id,
          ...(post.groupId ? { groupId: post.groupId, groupPrivacy: post.groupPrivacy } : {}),
          authorId: post.authorId,
          summary: { label: 'Bài mẫu' },
        };
      },
      summariesForHandler: async () => new Map(),
    };
    groups = new SocialGroupService(store, directory, org, v2);
    members = new SocialGroupMemberService(store, directory, groups);
    topics = new SocialGroupTopicService(v2, groups);
    priority = new SocialGroupPriorityService(v2, groups);
    sync = new SocialGroupSyncService(v2, directory, org, groups);
    reports = new SocialReportService(reportStore, store, directory, resolver, groups);
    posting = new GroupPostingAdapter(v2);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('tạo nhóm theo phòng ban, quyền đăng bài, đồng bộ, prune, ưu tiên, gợi ý', async () => {
    const a = actor(tenantId, alice);
    const created = await groups.create(a, {
      name: 'Phòng A',
      privacy: 'public',
      descriptionHtml: '<p>Xin <b>chào</b><script>x</script></p>',
      coverPreset: 'ocean',
      adminUserIds: [dave],
      membership: { mode: 'org', sources: [{ type: 'unit', id: unit }] },
      postPermission: 'selected',
      postPermittedUserIds: [bob],
    });
    expect(created.memberCount).toBe(4);
    expect(created.adminCount).toBe(2);
    expect(created.membershipMode).toBe('org');
    expect(created.memberSources?.[0]?.name).toBe('Phòng A');
    expect(created.postPermittedUsers?.map((u) => u.id)).toEqual([bob]);
    expect(created.description).toBe('Xin chào');
    expect(created.descriptionHtml).not.toMatch(/script/);
    expect(created.lastSyncedAt).toBeDefined();

    expect((await posting.canPost(tenantId, created.id, bob)).allowed).toBe(true);
    expect(await posting.canPost(tenantId, created.id, carol)).toEqual({ allowed: false, reason: 'restricted' });
    expect((await posting.canPost(tenantId, created.id, dave)).allowed).toBe(true);
    expect(await posting.canPost(tenantId, created.id, erin)).toEqual({ allowed: false, reason: 'not-member' });
    expect((await groups.get(actor(tenantId, bob), created.id)).capabilities.canPost).toBe(true);

    // người thêm tay + tự tham gia + đồng bộ
    await members.add(a, created.id, { userIds: [erin] });
    unitMembers = [carol, randomUUID()];
    const first = await sync.sync(a, created.id, {});
    expect(first.added).toHaveLength(1);
    expect(first.removedCount).toBe(0);
    const pruned = await sync.sync(a, created.id, { prune: true });
    expect(pruned.removedCount).toBe(1); // bob (sync) bị gỡ; dave (admin), erin (manual), alice không bị gỡ
    const remaining = (await members.list(a, created.id)).items.map((i) => i.user.id);
    expect(remaining).toEqual(expect.arrayContaining([alice, dave, erin, carol]));
    expect(remaining).not.toContain(bob);
    // bob bị gỡ => khỏi danh sách được chọn đăng
    const row = await pool.query(`SELECT count(*)::int AS n FROM social_schema.group_post_permitted WHERE user_id = $1`, [bob]);
    expect(row.rows[0].n).toBe(0);

    // prune với nguồn rỗng không gỡ ai
    unitMembers = [];
    const guard = await sync.sync(a, created.id, { prune: true });
    expect(guard.removedCount).toBe(0);

    // ưu tiên
    const other = await groups.create(a, { name: 'Nhóm B', privacy: 'public' });
    const third = await groups.create(a, { name: 'Nhóm C', privacy: 'private' });
    await priority.set(a, created.id, { pinned: true });
    await priority.set(a, third.id, { pinned: true });
    const list = await groups.list(a, { scope: 'mine' });
    expect(list.items.map((i) => i.name).slice(0, 2)).toEqual(['Nhóm C', 'Phòng A']);
    expect(list.items.map((i) => i.name)).toEqual(['Nhóm C', 'Phòng A', 'Nhóm B']);
    const small = await groups.list(a, { scope: 'mine', limit: 1 });
    expect(small.items).toHaveLength(3);
    expect(small.nextCursor).toBeUndefined();
    await members.leave(actor(tenantId, erin), created.id);
    const sug = await groups.suggestions(actor(tenantId, erin));
    expect(sug.items.map((i) => i.name)).toEqual(['Phòng A', 'Nhóm B']);
    expect(other.id).toBeDefined();
  });

  it('giới hạn ưu tiên 10 và thành viên rời nhóm thì mất ưu tiên', async () => {
    const e = actor(tenantId, erin);
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1) ids.push((await groups.create(e, { name: `Ưu tiên ${i}`, privacy: 'public' })).id);
    for (const id of ids.slice(0, 10)) await priority.set(e, id, { pinned: true });
    await expect(priority.set(e, ids[10] as string, { pinned: true })).rejects.toMatchObject({ code: 'GROUP_PRIORITY_LIMIT' });
    await members.add(e, ids[0] as string, { userIds: [bob] });
    await members.setRole(e, ids[0] as string, bob, { role: 'admin' });
    await members.leave(e, ids[0] as string);
    const left = await pool.query(`SELECT 1 FROM social_schema.group_priorities WHERE user_id = $1 AND group_id = $2`, [erin, ids[0]]);
    expect(left.rowCount).toBe(0);
  });

  it('chủ đề: giới hạn, trùng tên, bài về không chủ đề khi xoá', async () => {
    const a = actor(tenantId, alice);
    const group = await groups.create(a, { name: 'Có chủ đề', privacy: 'public' });
    const topic = await topics.create(a, group.id, { name: 'Tin tức' });
    await expect(topics.create(a, group.id, { name: 'TIN TỨC' })).rejects.toMatchObject({ code: 'GROUP_TOPIC_NAME_TAKEN' });
    const postId = randomUUID();
    await pool.query(
      `INSERT INTO social_schema.posts (id, author_id, body_html, group_id, group_topic_id) VALUES ($1, $2, '<p>x</p>', $3, $4)`,
      [postId, alice, group.id, topic.id],
    );
    expect((await topics.list(a, group.id)).items[0]?.postCount).toBe(1);
    expect((await topics.update(a, group.id, topic.id, { name: 'Tin mới', position: 2 })).name).toBe('Tin mới');
    await topics.remove(a, group.id, topic.id);
    const after = await pool.query(`SELECT group_topic_id, status FROM social_schema.posts WHERE id = $1`, [postId]);
    expect(after.rows[0]).toMatchObject({ group_topic_id: null, status: 'published' });
    for (let i = 0; i < 30; i += 1) await topics.create(a, group.id, { name: `T${i}` });
    await expect(topics.create(a, group.id, { name: 'Thứ 31' })).rejects.toMatchObject({ code: 'GROUP_TOPIC_LIMIT' });
    expect((await posting.topicsOfGroup(tenantId, group.id, [topic.id])).size).toBe(0);
  });

  it('báo cáo: định tuyến hàng đợi, trùng, xử lý nguyên tử, outbox', async () => {
    const a = actor(tenantId, alice);
    const mod = actor(tenantId, dave, { canModerate: true });
    const open = await groups.create(a, { name: 'Mở báo cáo', privacy: 'public', memberUserIds: [bob] });
    const closed = await groups.create(a, { name: 'Kín báo cáo', privacy: 'private', memberUserIds: [bob] });
    const wallPost = randomUUID();
    const openPost = randomUUID();
    const closedPost = randomUUID();
    posts.set(wallPost, { authorId: alice });
    posts.set(openPost, { authorId: alice, groupId: open.id, groupPrivacy: 'public' });
    posts.set(closedPost, { authorId: alice, groupId: closed.id, groupPrivacy: 'private' });

    const b = actor(tenantId, bob);
    const r1 = await reports.create(b, { targetType: 'post', targetId: wallPost, reason: 'Nội dung không phù hợp' });
    const r2 = await reports.create(b, { targetType: 'post', targetId: openPost, reason: 'Nội dung không phù hợp' });
    const r3 = await reports.create(b, { targetType: 'post', targetId: closedPost, reason: 'Nội dung không phù hợp' });
    const r4 = await reports.create(actor(tenantId, carol), { targetType: 'group', targetId: open.id, reason: 'Nhóm có vấn đề' });
    await expect(reports.create(b, { targetType: 'post', targetId: wallPost, reason: 'Báo cáo lần hai' })).rejects.toMatchObject({
      code: 'REPORT_EXISTS',
    });

    const modQueue = await reports.listForModerators(mod);
    expect(modQueue.items.map((i) => i.id).sort()).toEqual([r1.id, r2.id, r4.id].sort());
    expect(modQueue.openCount).toBe(3);
    expect((await reports.listForModerators(mod, { targetType: 'group' })).items.map((i) => i.id)).toEqual([r4.id]);
    const groupQueue = await reports.listForGroup(a, closed.id);
    expect(groupQueue.items.map((i) => i.id)).toEqual([r3.id]);
    expect((await reports.listForGroup(a, open.id)).items.map((i) => i.id).sort()).toEqual([r2.id, r4.id].sort());
    await expect(reports.resolveAsModerator(mod, r3.id, { status: 'resolved' })).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });

    const [x, y] = await Promise.allSettled([
      reports.resolveAsModerator(mod, r2.id, { status: 'resolved', note: 'ok' }),
      reports.resolveForGroup(a, open.id, r2.id, { status: 'dismissed' }),
    ]);
    expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
    const done = await reports.listForModerators(mod, { status: 'resolved' });
    expect(done.items.map((i) => i.id)).toContain(r2.id);

    const outbox = await pool.query(`SELECT payload FROM integration_schema.outbox_events WHERE event_type = 'social.report.created'`);
    expect(outbox.rowCount).toBe(4);
    const groupEvent = outbox.rows.map((r) => r.payload.payload).find((p) => p.reportId === r3.id);
    expect(groupEvent).toMatchObject({ groupPrivacy: 'private', recipientUserIds: [alice] });
  });
});
