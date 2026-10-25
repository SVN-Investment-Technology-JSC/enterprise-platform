import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  type PostgresPoolRegistry,
  type TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import type { SocialGroupPrivacy, SocialPostStatus, SocialPostVisibility } from '@enterprise-platform/contracts-social';
import {
  canViewPostInScope,
  type PostVisibilityScope,
  type PostVisibilitySubject,
} from './application/ports/post-visibility.port.js';
import { PostgresSocialFeedStore } from './infrastructure/postgres-social-feed.store.js';
import { PostgresSocialPostHistoryStore } from './infrastructure/postgres-social-post-history.store.js';
import { PostgresSocialPublishingStore } from './infrastructure/postgres-social-publishing.store.js';
import { PostgresSocialSearchStore } from './infrastructure/postgres-social-search.store.js';
import { postVisibilitySql } from './infrastructure/post-visibility-sql.js';

/**
 * Chạy với PostgreSQL dùng một lần ở máy, ví dụ
 * `SOCIAL_TEST_ADMIN_URL=postgresql://tenant:tenant@localhost:15436/postgres`. Tự tạo DB tạm, áp migration
 * tenant (integration + social 0001-0004) rồi xoá DB. Bỏ qua khi không đặt biến môi trường.
 *
 * Đối chiếu `postVisibilitySql` chạy trên PostgreSQL thật với `canViewPostInScope` và kiểm mọi đường
 * truy vấn trả bài (bảng tin, tìm kiếm, đếm, đã lưu, bài của tôi) bằng cùng một bộ dữ liệu.
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
];

const tenantId = 'tenant-visibility';
const [AUTHOR, SAME_UNIT, CHILD_UNIT_USER, OUTSIDER, MODERATOR, ADMIN, MEMBER, PICKED, UNIT_PICKED] = Array.from(
  { length: 9 },
  () => randomUUID(),
);
const [PARENT, CHILD, OTHER] = Array.from({ length: 3 }, () => randomUUID());
const groupIds = { public: randomUUID(), private: randomUUID(), deleted: randomUUID() };

const viewers: { name: string; scope: PostVisibilityScope }[] = [
  { name: 'tác giả', scope: { viewerId: AUTHOR, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [PARENT] } },
  { name: 'cùng phòng', scope: { viewerId: SAME_UNIT, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [PARENT] } },
  { name: 'phòng con', scope: { viewerId: CHILD_UNIT_USER, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [CHILD, PARENT] } },
  { name: 'người ngoài', scope: { viewerId: OUTSIDER, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [OTHER] } },
  { name: 'không phòng ban', scope: { viewerId: OUTSIDER, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [] } },
  { name: 'moderator', scope: { viewerId: MODERATOR, seesAllGroups: false, canModerate: true, memberGroupIds: [], unitIds: [PARENT, CHILD] } },
  { name: 'quản trị tenant', scope: { viewerId: ADMIN, seesAllGroups: true, canModerate: true, memberGroupIds: [], unitIds: [PARENT] } },
  { name: 'thành viên nhóm', scope: { viewerId: MEMBER, seesAllGroups: false, canModerate: false, memberGroupIds: [groupIds.private], unitIds: [] } },
  { name: 'chia sẻ theo người', scope: { viewerId: PICKED, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [OTHER] } },
  { name: 'chia sẻ theo phòng', scope: { viewerId: UNIT_PICKED, seesAllGroups: false, canModerate: false, memberGroupIds: [], unitIds: [OTHER, CHILD] } },
];

interface Seed {
  readonly id: string;
  readonly subject: PostVisibilitySubject;
}

integration('Quyền xem bài trên PostgreSQL thật', () => {
  const databaseName = 'social_vis_' + randomUUID().replace(/-/g, '');
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let publishing: PostgresSocialPublishingStore;
  let feedStore: PostgresSocialFeedStore;
  let searchStore: PostgresSocialSearchStore;
  let history: PostgresSocialPostHistoryStore;
  const seeds: Seed[] = [];
  const seedOf = (match: (seed: Seed) => boolean): Seed => {
    const found = seeds.find(match);
    if (!found) throw new Error('Thiếu dữ liệu mẫu.');
    return found;
  };

  beforeAll(async () => {
    const url = new URL(process.env.SOCIAL_TEST_ADMIN_URL ?? '');
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of MIGRATIONS) await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));

    const references = { require: () => ({}) } as unknown as TenantDatabaseRegistry;
    const pools = { forTenant: async () => pool } as unknown as PostgresPoolRegistry;
    publishing = new PostgresSocialPublishingStore(references, pools);
    feedStore = new PostgresSocialFeedStore(references, pools);
    searchStore = new PostgresSocialSearchStore(references, pools);
    history = new PostgresSocialPostHistoryStore(references, pools);

    await pool.query(
      `INSERT INTO social_schema.groups (id, name, privacy, created_by, deleted_at, deleted_by) VALUES
         ($1, 'Nhóm công khai', 'public', $4, NULL, NULL),
         ($2, 'Nhóm riêng tư', 'private', $4, NULL, NULL),
         ($3, 'Nhóm đã xoá', 'public', $4, now(), $4)`,
      [groupIds.public, groupIds.private, groupIds.deleted, AUTHOR],
    );
    await pool.query(`INSERT INTO social_schema.group_members (group_id, user_id) VALUES ($1, $2)`, [groupIds.private, MEMBER]);

    const statuses: SocialPostStatus[] = ['published', 'pending', 'scheduled', 'rejected', 'deleted'];
    const visibilities: SocialPostVisibility[] = ['company', 'unit', 'custom', 'private'];
    const places: { groupId?: string; privacy?: SocialGroupPrivacy; deleted?: boolean }[] = [
      {},
      { groupId: groupIds.public, privacy: 'public' },
      { groupId: groupIds.private, privacy: 'private' },
      { groupId: groupIds.deleted, privacy: 'public', deleted: true },
    ];
    for (const status of statuses) {
      for (const place of places) {
        for (const visibility of visibilities) {
          if (place.groupId && visibility !== 'company') continue;
          const id = randomUUID();
          await pool.query(
            `INSERT INTO social_schema.posts
               (id, author_id, body_html, status, group_id, visibility, author_unit_id, scheduled_at, reject_reason,
                deleted_at, deleted_by)
             VALUES ($1, $2, '<p>noi dung kiem tra</p>', $3::varchar, $4, $5, $6,
                     CASE WHEN $3::varchar = 'scheduled' THEN now() + interval '1 day' END,
                     CASE WHEN $3::varchar = 'rejected' THEN 'lý do' END,
                     CASE WHEN $3::varchar = 'deleted' THEN now() END,
                     CASE WHEN $3::varchar = 'deleted' THEN $2::uuid END)`,
            [id, AUTHOR, status, place.groupId ?? null, visibility, visibility === 'unit' ? PARENT : null],
          );
          if (visibility === 'custom') {
            await pool.query(
              `INSERT INTO social_schema.post_audience (post_id, principal_type, principal_id) VALUES ($1, 'user', $2), ($1, 'unit', $3)`,
              [id, PICKED, CHILD],
            );
          }
          seeds.push({
            id,
            subject: {
              authorId: AUTHOR,
              status,
              ...(place.groupId
                ? { groupId: place.groupId, groupPrivacy: place.privacy, groupDeleted: place.deleted === true }
                : {}),
              visibility,
              ...(visibility === 'unit' ? { authorUnitId: PARENT } : {}),
              ...(visibility === 'custom' ? { audienceUserIds: [PICKED], audienceUnitIds: [CHILD] } : {}),
            },
          });
        }
      }
    }
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('mệnh đề SQL trả đúng những bài mà canViewPostInScope cho phép, với mọi người xem', async () => {
    for (const viewer of viewers) {
      const clause = postVisibilitySql(viewer.scope, { firstParam: 1 });
      const result = await pool.query<{ id: string }>(
        `SELECT p.id FROM social_schema.posts p LEFT JOIN social_schema.groups g ON g.id = p.group_id WHERE ${clause.sql}`,
        [...clause.params],
      );
      const fromSql = new Set(result.rows.map((row) => row.id));
      const fromRule = new Set(seeds.filter((seed) => canViewPostInScope(viewer.scope, seed.subject)).map((seed) => seed.id));
      expect({ viewer: viewer.name, ids: [...fromSql].sort() }).toEqual({ viewer: viewer.name, ids: [...fromRule].sort() });
    }
  });

  it('mọi đường đọc bài chỉ trả bài thấy được: bảng tin, tìm kiếm, đếm bài của tác giả, bài của tôi', async () => {
    for (const viewer of viewers) {
      const visibleToViewer = (seed: Seed) => canViewPostInScope(viewer.scope, seed.subject);
      const expectedPublished = seeds.filter((seed) => visibleToViewer(seed) && seed.subject.status === 'published');

      const feed = await feedStore.page(tenantId, { visibility: viewer.scope, source: 'all', limit: 500 });
      expect(feed.map((row) => row.id).sort()).toEqual(expectedPublished.map((seed) => seed.id).sort());
      const wall = await feedStore.page(tenantId, { visibility: viewer.scope, source: 'wall', limit: 500 });
      expect(wall.every((row) => row.groupId === undefined)).toBe(true);
      expect(wall.map((row) => row.id).sort()).toEqual(
        expectedPublished.filter((seed) => seed.subject.groupId === undefined).map((seed) => seed.id).sort(),
      );

      const found = await searchStore.searchPosts(tenantId, viewer.scope, { tokens: ['kiem'], limit: 500 });
      expect(found.map((row) => row.id).sort()).toEqual(expectedPublished.map((seed) => seed.id).sort());
      expect(await searchStore.countVisibleAuthorPosts(tenantId, viewer.scope, AUTHOR)).toBe(expectedPublished.length);

      for (const status of ['pending', 'scheduled', 'rejected'] as const) {
        const mine = await publishing.listByAuthor(tenantId, AUTHOR, status, viewer.scope, { limit: 500 });
        const expected = seeds.filter((seed) => seed.subject.status === status && visibleToViewer(seed));
        expect(mine.map((row) => row.id).sort()).toEqual(expected.map((seed) => seed.id).sort());
      }
      const queue = await publishing.listPending(tenantId, viewer.scope, { limit: 500 });
      expect(queue.map((row) => row.id).sort()).toEqual(
        seeds
          .filter((seed) => seed.subject.status === 'pending' && seed.subject.groupId === undefined && visibleToViewer(seed))
          .map((seed) => seed.id)
          .sort(),
      );
    }
  });

  it('đã lưu và số đếm: bài không còn thấy được biến mất khỏi danh sách', async () => {
    for (const seed of seeds.filter((s) => s.subject.status === 'published')) {
      await pool.query(`INSERT INTO social_schema.post_bookmarks (user_id, post_id) VALUES ($1, $2)`, [OUTSIDER, seed.id]);
    }
    for (const viewer of viewers.filter((v) => v.scope.viewerId === OUTSIDER)) {
      const listed = await publishing.listBookmarks(tenantId, OUTSIDER, viewer.scope, { limit: 500 });
      const expected = seeds.filter((seed) => seed.subject.status === 'published' && canViewPostInScope(viewer.scope, seed.subject));
      expect(listed.map((entry) => entry.post.id).sort()).toEqual(expected.map((seed) => seed.id).sort());
      expect((await publishing.counts(tenantId, OUTSIDER, false, viewer.scope)).bookmarks).toBe(expected.length);
    }
  });

  it('findForWrite nạp danh sách chia sẻ; engagement chỉ trả danh sách cho tác giả', async () => {
    const custom = seedOf(
      (seed) => seed.subject.visibility === 'custom' && seed.subject.status === 'published' && !seed.subject.groupId,
    );
    const row = await publishing.findForWrite(tenantId, custom.id);
    expect(row).toMatchObject({ visibility: 'custom', audienceUserIds: [PICKED], audienceUnitIds: [CHILD] });
    const unit = seedOf((seed) => seed.subject.visibility === 'unit' && seed.subject.status === 'published');
    expect(await publishing.findForWrite(tenantId, unit.id)).toMatchObject({ visibility: 'unit', authorUnitId: PARENT });

    const mine = await publishing.engagement(tenantId, [custom.id], AUTHOR);
    expect(mine.audiences?.get(custom.id)).toEqual({ userIds: [PICKED], unitIds: [CHILD] });
    const others = await publishing.engagement(tenantId, [custom.id], OUTSIDER);
    expect(others.audiences?.size ?? 0).toBe(0);
  });

  it('sửa bài: lưu lịch sử trước khi ghi đè, giữ 50 bản gần nhất; đổi quyền xem không tính là sửa', async () => {
    const id = randomUUID();
    await publishing.insert(tenantId, {
      id,
      authorId: AUTHOR,
      kind: 'post',
      title: 'Tiêu đề 0',
      bodyHtml: '<p>Bản 0</p>',
      pinned: false,
      mentionsAll: false,
      mentionUserIds: [],
      attachmentIds: [],
      uploaderId: AUTHOR,
      status: 'published',
      exemptFromApproval: false,
      requiresReadConfirmation: false,
      visibility: 'custom',
      audience: { userIds: [PICKED], unitIds: [] },
      events: [],
    });

    for (let index = 1; index <= 55; index += 1) {
      await publishing.update(tenantId, id, {
        expectedStatus: 'published',
        bodyHtml: `<p>Bản ${index}</p>`,
        uploaderId: AUTHOR,
        editorId: index % 2 === 0 ? MODERATOR : AUTHOR,
        events: [],
      });
    }
    const afterEdits = await publishing.findForWrite(tenantId, id);
    expect(afterEdits?.editCount).toBe(55);
    expect(afterEdits?.bodyHtml).toBe('<p>Bản 55</p>');
    expect(afterEdits?.editedAt).toBeDefined();

    const versions = await history.list(tenantId, id);
    expect(versions).toHaveLength(50);
    expect(versions[0]).toMatchObject({ version: 55, bodyHtml: '<p>Bản 54</p>', editedBy: AUTHOR });
    expect(versions[49].version).toBe(6);
    expect(versions[49].bodyHtml).toBe('<p>Bản 5</p>');
    expect(versions.map((v) => v.version)).toEqual(Array.from({ length: 50 }, (_, i) => 55 - i));
    const stored = await pool.query(`SELECT count(*)::int AS n FROM social_schema.post_edits WHERE post_id = $1`, [id]);
    expect(stored.rows[0].n).toBe(50);

    // Lưu lại đúng nội dung cũ, hoặc chỉ đổi quyền xem / bật tắt bình luận: không có bản mới, không đổi edited_at.
    const editedAt = afterEdits?.editedAt;
    await publishing.update(tenantId, id, { expectedStatus: 'published', bodyHtml: '<p>Bản 55</p>', uploaderId: AUTHOR, events: [] });
    await publishing.update(tenantId, id, {
      expectedStatus: 'published',
      visibility: 'unit',
      authorUnitId: PARENT,
      audience: { userIds: [], unitIds: [] },
      commentsDisabled: true,
      mentionUserIds: [],
      uploaderId: AUTHOR,
      events: [],
    });
    const settled = await publishing.findForWrite(tenantId, id);
    expect(settled).toMatchObject({ editCount: 55, visibility: 'unit', authorUnitId: PARENT, commentsDisabled: true });
    expect(settled?.editedAt).toBe(editedAt);
    expect(settled?.audienceUserIds).toBeUndefined();
    expect((await history.list(tenantId, id))[0].version).toBe(55);

    // Trở lại custom với danh sách mới thay hoàn toàn danh sách cũ.
    await publishing.update(tenantId, id, {
      expectedStatus: 'published',
      visibility: 'custom',
      authorUnitId: null,
      audience: { userIds: [UNIT_PICKED], unitIds: [OTHER] },
      uploaderId: AUTHOR,
      events: [],
    });
    expect(await publishing.findForWrite(tenantId, id)).toMatchObject({
      visibility: 'custom',
      audienceUserIds: [UNIT_PICKED],
      audienceUnitIds: [OTHER],
    });
    const check = await pool.query(`SELECT author_unit_id FROM social_schema.posts WHERE id = $1`, [id]);
    expect(check.rows[0].author_unit_id).toBeNull();
  });
});
