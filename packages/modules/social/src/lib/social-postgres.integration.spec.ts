import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPostgresPool,
  PostgresPoolRegistry,
  TenantDatabaseRegistry,
} from '@enterprise-platform/adapter-database';
import { Test, type TestingModule } from '@nestjs/testing';
import { ATTACHMENT_STORAGE } from './application/attachment-storage.port.js';
import { ORGANIZATION_DIRECTORY } from './application/organization-directory.port.js';
import { PEOPLE_PROFILE } from './application/ports/people-profile.port.js';
import { HttpOrgStructure } from './infrastructure/http-org-structure.js';
import type { SocialActor } from './application/social-actor.js';
import { SocialBookmarkService } from './application/social-bookmark.service.js';
import { SocialCommentService } from './application/social-comment.service.js';
import { SocialFeedService } from './application/social-feed.service.js';
import { SocialGroupMemberService } from './application/social-group-member.service.js';
import { SocialGroupService } from './application/social-group.service.js';
import { SocialModerationService } from './application/social-moderation.service.js';
import { SocialMyPostsService } from './application/social-my-posts.service.js';
import { SocialPollService } from './application/social-poll.service.js';
import { SocialPublishingService } from './application/social-publishing.service.js';
import { SocialSchedulerService } from './application/social-scheduler.service.js';
import { SocialSearchService } from './application/social-search.service.js';
import { SocialTopicService } from './application/social-topic.service.js';
import { SocialPostNotFoundError, SocialValidationError } from './domain/social.error.js';
import { SOCIAL_STORE, type SocialStore } from './application/social-store.port.js';
import { SocialModule } from './social.module.js';

/**
 * Chạy với PostgreSQL dùng một lần ở máy, ví dụ
 * `SOCIAL_TEST_ADMIN_URL=postgresql://tenant:tenant@localhost:15436/postgres`. Tự tạo DB tạm, áp migration
 * tenant (integration + social 0001-0003) rồi xoá DB. Bỏ qua khi không đặt biến môi trường.
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
    displayName: userId.slice(0, 4),
    isTenantAdmin: false,
    canRead: true,
    canWrite: true,
    canModerate: false,
    canManage: false,
    ...over,
  };
}

integration('Mạng nội bộ P2/P3 trên PostgreSQL thật', () => {
  const databaseName = 'social_test_' + randomUUID().replace(/-/g, '');
  const tenantId = randomUUID();
  const alice = randomUUID();
  const bob = randomUUID();
  const carol = randomUUID();
  let admin: ReturnType<typeof createPostgresPool>;
  let pool: ReturnType<typeof createPostgresPool>;
  let moduleRef: TestingModule;
  let publishing: SocialPublishingService;
  let groups: SocialGroupService;
  let members: SocialGroupMemberService;
  let feed: SocialFeedService;
  let search: SocialSearchService;
  let polls: SocialPollService;
  let scheduler: SocialSchedulerService;
  let comments: SocialCommentService;
  let topics: SocialTopicService;
  const deletedKeys: string[] = [];

  beforeAll(async () => {
    const url = new URL(process.env.SOCIAL_TEST_ADMIN_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Only local disposable PostgreSQL is allowed');
    admin = createPostgresPool(url.toString());
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = '/' + databaseName;
    pool = createPostgresPool(url.toString());
    for (const path of MIGRATIONS) await pool.query(await readFile(resolve(process.cwd(), '../../../migrations', path), 'utf8'));

    const directory = {
      resolve: async (_tenant: string, ids: readonly string[]) =>
        new Map(ids.map((id) => [id.toLowerCase(), { id, name: `Người ${id.slice(0, 4)}` }])),
      search: async () => [],
    };
    const people = { listActiveUserIds: async () => [alice, bob, carol] };
    moduleRef = await Test.createTestingModule({ imports: [SocialModule] })
      .overrideProvider(ORGANIZATION_DIRECTORY)
      .useValue(directory)
      .overrideProvider(ATTACHMENT_STORAGE)
      .useValue({
        createDownloadUrl: async (key: string) => `https://storage.test/${key}`,
        deleteObjects: async (keys: readonly string[]) => {
          deletedKeys.push(...keys);
          return { failed: [] };
        },
      })
      .overrideProvider(PEOPLE_PROFILE)
      .useValue(people)
      .overrideProvider(HttpOrgStructure)
      .useValue({
        scopeOf: async (_tenant: string, userId: string) => ({ userId, unitIds: [] }),
        scopesOf: async (_tenant: string, ids: readonly string[]) =>
          new Map(ids.map((id) => [id.toLowerCase(), { userId: id, unitIds: [] }])),
        authorUnitOf: async () => undefined,
        listNodes: async () => [],
        nodeRefs: async () => new Map(),
        memberIdsOf: async () => [],
      })
      .overrideProvider(PostgresPoolRegistry)
      .useValue({ forTenant: async () => pool })
      .compile();
    moduleRef.get(TenantDatabaseRegistry).register({ tenantId } as unknown as Parameters<TenantDatabaseRegistry['register']>[0]);

    publishing = moduleRef.get(SocialPublishingService);
    groups = moduleRef.get(SocialGroupService);
    members = moduleRef.get(SocialGroupMemberService);
    feed = moduleRef.get(SocialFeedService);
    search = moduleRef.get(SocialSearchService);
    polls = moduleRef.get(SocialPollService);
    scheduler = moduleRef.get(SocialSchedulerService);
    comments = moduleRef.get(SocialCommentService);
    topics = moduleRef.get(SocialTopicService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  });

  it('tạo bài Tường công ty, đọc lại và thấy trong bảng tin; sự kiện ghi vào outbox', async () => {
    const post = await publishing.create(actor(tenantId, alice), { bodyHtml: '<p>Chào mừng nhân viên mới</p>' });
    expect(post.status).toBe('published');
    expect((await publishing.get(actor(tenantId, bob), post.id)).id).toBe(post.id);
    const page = await feed.feed(actor(tenantId, bob), {});
    expect(page.items.map((item) => item.id)).toContain(post.id);
    const outbox = await pool.query(`SELECT 1 FROM integration_schema.outbox_events WHERE event_type = 'social.post.published'`);
    expect(outbox.rowCount).toBeGreaterThan(0);
  });

  it('một bài có nhiều chuyên mục: lọc theo từng chuyên mục, đếm bài, đổi và bỏ chuyên mục', async () => {
    const manager = actor(tenantId, alice, { canModerate: true, canManage: true });
    const a = await topics.create(manager, { name: 'Chuyên mục A' });
    const b = await topics.create(manager, { name: 'Chuyên mục B' });
    const c = await topics.create(manager, { name: 'Chuyên mục C' });
    const idsInFeed = async (topicId: string) =>
      (await feed.feed(actor(tenantId, bob), { topicId })).items.map((item) => item.id);
    const countOf = async (id: string) => (await topics.list(manager)).items.find((item) => item.id === id)?.postCount;

    const post = await publishing.create(actor(tenantId, alice), { bodyHtml: '<p>Nhiều chuyên mục</p>', topicIds: [b.id, a.id] });
    expect(post.topics?.map((topic) => topic.id)).toEqual([b.id, a.id]);
    expect(post.topic?.id).toBe(b.id);
    expect(await idsInFeed(a.id)).toContain(post.id);
    expect(await idsInFeed(b.id)).toContain(post.id);
    expect(await idsInFeed(c.id)).not.toContain(post.id);
    expect([await countOf(a.id), await countOf(b.id), await countOf(c.id)]).toEqual([1, 1, 0]);

    const moved = await publishing.update(actor(tenantId, alice), post.id, { topicIds: [c.id] });
    expect(moved.topics?.map((topic) => topic.id)).toEqual([c.id]);
    expect(await idsInFeed(a.id)).not.toContain(post.id);
    expect(await idsInFeed(c.id)).toContain(post.id);
    expect([await countOf(a.id), await countOf(c.id)]).toEqual([0, 1]);

    const cleared = await publishing.update(actor(tenantId, alice), post.id, { topicIds: [] });
    expect(cleared.topics).toBeUndefined();
    expect(cleared.topic).toBeUndefined();
    expect(await countOf(c.id)).toBe(0);

    const legacy = await publishing.create(actor(tenantId, alice), { bodyHtml: '<p>Một chuyên mục</p>', topicId: a.id });
    expect(legacy.topics?.map((topic) => topic.id)).toEqual([a.id]);
    expect(await idsInFeed(a.id)).toContain(legacy.id);

    await expect(
      publishing.create(actor(tenantId, alice), {
        bodyHtml: '<p>Quá nhiều</p>',
        topicIds: Array.from({ length: 6 }, () => randomUUID()),
      }),
    ).rejects.toBeInstanceOf(SocialValidationError);
  });

  it('xoá bài xoá luôn dòng và object của tệp bài lẫn tệp bình luận (kể cả poster và bản gốc video)', async () => {
    const addFile = async (purpose: 'post' | 'comment', extra: { poster?: string; source?: string } = {}) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO social_schema.attachments
           (id, uploaded_by, file_name, content_type, size_bytes, storage_key, completed_at, purpose,
            processing_status, poster_key, source_key)
         VALUES ($1, $2, 'clip.mp4', 'video/mp4', 10, $3, now(), $4, 'ready', $5, $6)`,
        [id, alice, `k/${id}/video.mp4`, purpose, extra.poster ?? null, extra.source ?? null],
      );
      return id;
    };
    const postFile = await addFile('post', { poster: 'k/post-poster.jpg' });
    const commentFile = await addFile('comment', { poster: 'k/comment-poster.jpg', source: 'k/comment-source.mov' });
    const post = await publishing.create(actor(tenantId, alice), { bodyHtml: '<p>Có video</p>', attachmentIds: [postFile] });
    await comments.create(actor(tenantId, bob), post.id, { body: 'Bình luận có video', attachmentIds: [] });
    const comment = await comments.create(actor(tenantId, alice), post.id, { body: '', attachmentIds: [commentFile] });
    expect(comment.attachments).toHaveLength(1);
    deletedKeys.length = 0;

    await publishing.remove(actor(tenantId, alice), post.id);

    const left = await pool.query(`SELECT id FROM social_schema.attachments WHERE id = ANY($1::uuid[])`, [[postFile, commentFile]]);
    expect(left.rows).toEqual([]);
    expect(deletedKeys.sort()).toEqual(
      [
        `k/${postFile}/video.mp4`,
        'k/post-poster.jpg',
        `k/${commentFile}/video.mp4`,
        'k/comment-poster.jpg',
        'k/comment-source.mov',
      ].sort(),
    );
  });

  it('cổng SQL gắn video: queued và processing gắn được (không lộ url), failed bị từ chối; xoá bài khi đang xử lý xoá ngay', async () => {
    const addVideo = async (purpose: 'post' | 'comment', status: string) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO social_schema.attachments
           (id, uploaded_by, file_name, content_type, size_bytes, storage_key, completed_at, purpose, processing_status)
         VALUES ($1, $2, 'clip.mov', 'video/quicktime', 10, $3, now(), $4, $5)`,
        [id, alice, `k/${id}/original`, purpose, status],
      );
      return id;
    };
    const rejected = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (error: unknown) => error,
      );
    const a = actor(tenantId, alice);

    const queued = await addVideo('post', 'queued');
    const post = await publishing.create(a, { bodyHtml: '<p>Video chờ</p>', attachmentIds: [queued] });
    expect(post.attachments?.[0]).toMatchObject({ id: queued, processingStatus: 'queued' });
    expect(post.attachments?.[0]).not.toHaveProperty('url');
    const fetched = await publishing.get(actor(tenantId, bob), post.id);
    expect(fetched.attachments?.[0]).toMatchObject({ id: queued, processingStatus: 'queued' });
    expect(fetched.attachments?.[0]).not.toHaveProperty('url');

    const processing = await addVideo('comment', 'processing');
    const comment = await comments.create(a, post.id, { body: 'x', attachmentIds: [processing] });
    expect(comment.attachments?.[0]).toMatchObject({ id: processing, processingStatus: 'processing' });
    expect(comment.attachments?.[0]).not.toHaveProperty('url');

    const brokenPost = await addVideo('post', 'failed');
    expect(await rejected(publishing.create(a, { bodyHtml: '<p>x</p>', attachmentIds: [brokenPost] }))).toMatchObject({
      code: 'SOCIAL_VIDEO_FAILED',
      statusCode: 409,
    });
    const brokenComment = await addVideo('comment', 'failed');
    expect(await rejected(comments.create(a, post.id, { body: 'x', attachmentIds: [brokenComment] }))).toMatchObject({
      code: 'SOCIAL_VIDEO_FAILED',
      statusCode: 409,
    });
    // Tệp chưa tải xong vẫn là "không dùng được", không phải lỗi video.
    const unfinished = randomUUID();
    await pool.query(
      `INSERT INTO social_schema.attachments (id, uploaded_by, file_name, content_type, size_bytes, storage_key, purpose, processing_status)
       VALUES ($1, $2, 'clip.mov', 'video/quicktime', 10, $3, 'comment', 'queued')`,
      [unfinished, alice, `k/${unfinished}/original`],
    );
    expect(await rejected(comments.create(a, post.id, { body: 'x', attachmentIds: [unfinished] }))).toMatchObject({
      code: 'ATTACHMENT_UNAVAILABLE',
    });

    await publishing.remove(a, post.id);
    const left = await pool.query(`SELECT id FROM social_schema.attachments WHERE id = ANY($1::uuid[])`, [[queued, processing]]);
    expect(left.rows).toEqual([]);
  });

  it('setDimensions ghi kích thước ảnh một lần, không ghi đè; view của bài trả width/height', async () => {
    const store = moduleRef.get<SocialStore>(SOCIAL_STORE);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO social_schema.attachments
         (id, uploaded_by, file_name, content_type, size_bytes, storage_key, completed_at, purpose, processing_status)
       VALUES ($1, $2, 'a.png', 'image/png', 10, $3, now(), 'post', 'none')`,
      [id, alice, `k/${id}/a.png`],
    );
    await store.attachments.setDimensions(tenantId, id, 1200, 800);
    await store.attachments.setDimensions(tenantId, id, 10, 10);
    const row = await pool.query(`SELECT width, height FROM social_schema.attachments WHERE id = $1`, [id]);
    expect(row.rows[0]).toEqual({ width: 1200, height: 800 });

    const post = await publishing.create(actor(tenantId, alice), { bodyHtml: '<p>Ảnh</p>', attachmentIds: [id] });
    expect(post.attachments?.[0]).toMatchObject({ id, isImage: true, width: 1200, height: 800 });
    const fetched = await publishing.get(actor(tenantId, bob), post.id);
    expect(fetched.attachments?.[0]).toMatchObject({ id, width: 1200, height: 800 });
  });

  it('bài nhóm riêng tư ẩn với người ngoài, hiện với thành viên', async () => {
    const group = await groups.create(actor(tenantId, alice), { name: 'Ban lãnh đạo', privacy: 'private' });
    const post = await publishing.create(actor(tenantId, alice), { bodyHtml: '<p>Kế hoạch bí mật</p>', groupId: group.id });

    await expect(publishing.get(actor(tenantId, bob), post.id)).rejects.toBeInstanceOf(SocialPostNotFoundError);
    const outsiderFeed = await feed.feed(actor(tenantId, bob), { scope: 'all' });
    expect(outsiderFeed.items.map((item) => item.id)).not.toContain(post.id);
    const outsiderSearch = await search.posts(actor(tenantId, bob), { q: 'bi mat' });
    expect(outsiderSearch.items.map((item) => item.id)).not.toContain(post.id);
    const outsiderGroups = await groups.list(actor(tenantId, bob), { scope: 'all' });
    expect(outsiderGroups.items.map((item) => item.id)).not.toContain(group.id);

    await members.add(actor(tenantId, alice), group.id, { userIds: [bob] });
    expect((await publishing.get(actor(tenantId, bob), post.id)).id).toBe(post.id);
    const memberFeed = await feed.feed(actor(tenantId, bob), { groupId: group.id });
    expect(memberFeed.items.map((item) => item.id)).toContain(post.id);
  });

  it('tìm kiếm bài bằng search_text: không dấu, không phân biệt hoa thường, theo tiền tố', async () => {
    const post = await publishing.create(actor(tenantId, alice), {
      title: 'Thông báo nghỉ lễ',
      bodyHtml: '<p>Công ty nghỉ Quốc khánh ngày 2 tháng 9</p>',
    });
    for (const q of ['nghi le', 'QUOC KHANH', 'Thông báo', 'quoc kha']) {
      const result = await search.posts(actor(tenantId, carol), { q });
      expect(result.items.map((item) => item.id)).toContain(post.id);
    }
    const none = await search.posts(actor(tenantId, carol), { q: 'khongcotuvaynay' });
    expect(none.items).toHaveLength(0);
    const groupHits = await search.groups(actor(tenantId, alice), { q: 'ban lanh dao' });
    expect(groupHits.items.length).toBeGreaterThan(0);
  });

  it('bình chọn: bỏ phiếu, đổi phiếu, đếm đúng', async () => {
    const post = await publishing.create(actor(tenantId, alice), {
      bodyHtml: '<p>Họp mặt cuối năm ở đâu?</p>',
      poll: { question: 'Địa điểm', options: ['Nhà hàng A', 'Nhà hàng B'] },
    });
    const [first, second] = post.poll!.options;
    const voted = await polls.vote(actor(tenantId, bob), post.id, { optionIds: [first.id] });
    expect(voted.totalVoters).toBe(1);
    expect(voted.myOptionIds).toEqual([first.id]);
    await polls.vote(actor(tenantId, carol), post.id, { optionIds: [first.id] });
    const changed = await polls.vote(actor(tenantId, bob), post.id, { optionIds: [second.id] });
    expect(changed.options.find((option) => option.id === first.id)?.voteCount).toBe(1);
    expect(changed.options.find((option) => option.id === second.id)?.voteCount).toBe(1);
    expect(changed.totalVoters).toBe(2);
  });

  it('bài hẹn giờ ẩn với người khác, đến hạn thì scheduler đăng', async () => {
    const at = new Date(Date.now() + 5 * 60_000).toISOString();
    const post = await publishing.create(actor(tenantId, alice), { bodyHtml: '<p>Bài hẹn giờ</p>', scheduledAt: at });
    expect(post.status).toBe('scheduled');
    expect((await feed.feed(actor(tenantId, bob), {})).items.map((item) => item.id)).not.toContain(post.id);

    await pool.query(`UPDATE social_schema.posts SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [post.id]);
    const result = await scheduler.publishDueScheduled(tenantId);
    expect(result.failures).toEqual([]);
    expect(result.published).toBe(1);
    expect((await feed.feed(actor(tenantId, bob), {})).items.map((item) => item.id)).toContain(post.id);
  });

  describe('ảnh, video và tài liệu trong một bài: thứ tự và bố cục', () => {
    const addFile = async (contentType: string, fileName: string, extra: { status?: string; purpose?: string } = {}) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO social_schema.attachments
           (id, uploaded_by, file_name, content_type, size_bytes, storage_key, completed_at, purpose, processing_status)
         VALUES ($1, $2, $3, $4, 10, $5, now(), $6, $7)`,
        [id, alice, fileName, contentType, `k/${id}/${fileName}`, extra.purpose ?? 'post', extra.status ?? 'none'],
      );
      return id;
    };
    const idsOf = (post: { attachments?: readonly { id: string }[] }) => (post.attachments ?? []).map((file) => file.id);
    const a = () => actor(tenantId, alice);
    const viewer = () => actor(tenantId, bob);
    const moderator = () => actor(tenantId, carol, { canModerate: true });
    const mixed = async () => ({
      pdf: await addFile('application/pdf', 'bao-cao.pdf'),
      video: await addFile('video/mp4', 'clip.mp4', { status: 'ready' }),
      image: await addFile('image/png', 'anh.png'),
      image2: await addFile('image/jpeg', 'anh2.jpg'),
    });

    it('migration 0008 thêm cột media_layout (mặc định auto, chỉ nhận 5 giá trị) và position, áp lại không lỗi', async () => {
      const columns = await pool.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'social_schema' AND table_name IN ('posts', 'attachments')
            AND column_name IN ('media_layout', 'position')`,
      );
      expect(columns.rows.map((row) => `${row.table_name}.${row.column_name}`).sort()).toEqual([
        'attachments.position',
        'posts.media_layout',
      ]);
      await expect(
        pool.query(`INSERT INTO social_schema.posts (id, author_id, body_html, media_layout) VALUES ($1, $2, 'x', 'mosaic')`, [
          randomUUID(),
          alice,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await pool.query(
        await readFile(resolve(process.cwd(), '../../../migrations/tenant/social/0008-social-post-media-layout.sql'), 'utf8'),
      );
    });

    it('bài gồm ảnh, video và tài liệu đăng được; thứ tự tác giả sắp được giữ ở chi tiết, bảng tin, tìm kiếm, đã lưu', async () => {
      const f = await mixed();
      const order = [f.pdf, f.image, f.video, f.image2];
      const post = await publishing.create(a(), {
        bodyHtml: '<p>Tuyenbocuc album hon hop</p>',
        attachmentIds: order,
        mediaLayout: 'featured',
      });
      expect(post.mediaLayout).toBe('featured');
      expect(idsOf(post)).toEqual(order);

      const detail = await publishing.get(viewer(), post.id);
      expect(idsOf(detail)).toEqual(order);
      expect(detail.mediaLayout).toBe('featured');

      const inFeed = (await feed.feed(viewer(), {})).items.find((item) => item.id === post.id);
      expect(idsOf(inFeed ?? {})).toEqual(order);
      expect(inFeed?.mediaLayout).toBe('featured');

      const found = (await search.posts(viewer(), { q: 'tuyenbocuc' })).items.find((item) => item.id === post.id);
      expect(idsOf(found ?? {})).toEqual(order);
      expect(found?.mediaLayout).toBe('featured');

      const bookmarks = moduleRef.get(SocialBookmarkService);
      await bookmarks.set(viewer(), post.id, { bookmarked: true });
      const saved = (await bookmarks.list(viewer())).items.find((item) => item.id === post.id);
      expect(idsOf(saved ?? {})).toEqual(order);
      expect(saved?.mediaLayout).toBe('featured');

      const positions = await pool.query<{ position: number }>(
        `SELECT position FROM social_schema.attachments WHERE post_id = $1 ORDER BY position`,
        [post.id],
      );
      expect(positions.rows.map((row) => row.position)).toEqual([0, 1, 2, 3]);
    });

    it('bài không gửi bố cục dùng auto; bố cục sai bị từ chối và không ghi gì', async () => {
      const plain = await publishing.create(a(), { bodyHtml: '<p>Không bố cục</p>' });
      expect(plain.mediaLayout).toBe('auto');
      const stored = await pool.query(`SELECT media_layout FROM social_schema.posts WHERE id = $1`, [plain.id]);
      expect(stored.rows[0]).toEqual({ media_layout: 'auto' });

      const before = await pool.query(`SELECT count(*)::int AS n FROM social_schema.posts`);
      const file = await addFile('image/png', 'x.png');
      await expect(
        publishing.create(a(), { bodyHtml: '<p>Sai</p>', attachmentIds: [file], mediaLayout: 'mosaic' as never }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(publishing.update(a(), plain.id, { mediaLayout: 'mosaic' as never })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      const after = await pool.query(`SELECT count(*)::int AS n FROM social_schema.posts`);
      expect(after.rows[0]).toEqual(before.rows[0]);
      const free = await pool.query(`SELECT post_id FROM social_schema.attachments WHERE id = $1`, [file]);
      expect(free.rows[0]).toEqual({ post_id: null });
    });

    it('sửa bài đổi được thứ tự và bố cục; sửa chỉ nội dung giữ nguyên cả hai; gỡ tệp thì tệp thành mồ côi', async () => {
      const f = await mixed();
      const post = await publishing.create(a(), {
        bodyHtml: '<p>Sắp xếp</p>',
        attachmentIds: [f.image, f.video, f.pdf],
        mediaLayout: 'grid',
      });
      expect(idsOf(post)).toEqual([f.image, f.video, f.pdf]);

      const reordered = await publishing.update(a(), post.id, {
        attachmentIds: [f.pdf, f.video, f.image],
        mediaLayout: 'carousel',
      });
      expect(idsOf(reordered)).toEqual([f.pdf, f.video, f.image]);
      expect(reordered.mediaLayout).toBe('carousel');
      expect(idsOf(await publishing.get(viewer(), post.id))).toEqual([f.pdf, f.video, f.image]);

      // Cùng tập tệp, chỉ đổi thứ tự.
      const sameSet = await publishing.update(a(), post.id, { attachmentIds: [f.video, f.image, f.pdf] });
      expect(idsOf(sameSet)).toEqual([f.video, f.image, f.pdf]);
      expect(sameSet.mediaLayout).toBe('carousel');

      const textOnly = await publishing.update(a(), post.id, { bodyHtml: '<p>Sắp xếp lại nội dung</p>' });
      expect(idsOf(textOnly)).toEqual([f.video, f.image, f.pdf]);
      expect(textOnly.mediaLayout).toBe('carousel');

      const removed = await publishing.update(a(), post.id, { attachmentIds: [f.image2, f.image] });
      expect(idsOf(removed)).toEqual([f.image2, f.image]);
      const orphan = await pool.query(`SELECT post_id FROM social_schema.attachments WHERE id = $1`, [f.pdf]);
      expect(orphan.rows[0]).toEqual({ post_id: null });
    });

    it('bài hẹn giờ và bài chờ duyệt giữ bố cục và thứ tự khi được đăng hoặc duyệt', async () => {
      const f = await mixed();
      const order = [f.video, f.pdf, f.image];
      const scheduled = await publishing.create(a(), {
        bodyHtml: '<p>Hẹn giờ có media</p>',
        attachmentIds: order,
        mediaLayout: 'stack',
        scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      });
      expect(scheduled.status).toBe('scheduled');
      const mine = (await moduleRef.get(SocialMyPostsService).list(a(), { status: 'scheduled' })).items.find(
        (item) => item.id === scheduled.id,
      );
      expect(idsOf(mine ?? {})).toEqual(order);
      expect(mine?.mediaLayout).toBe('stack');
      await pool.query(`UPDATE social_schema.posts SET scheduled_at = now() - interval '1 minute' WHERE id = $1`, [scheduled.id]);
      const due = await scheduler.publishDueScheduled(tenantId);
      expect(due.failures).toEqual([]);
      const live = await publishing.get(viewer(), scheduled.id);
      expect(live.status).toBe('published');
      expect(idsOf(live)).toEqual(order);
      expect(live.mediaLayout).toBe('stack');

      const g = await mixed();
      const pendingOrder = [g.image2, g.video, g.pdf];
      await pool.query(
        `INSERT INTO social_schema.settings (key, value, updated_by) VALUES ('wall.requireApproval', 'true'::jsonb, $1)
         ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`,
        [alice],
      );
      try {
        const pending = await publishing.create(a(), {
          bodyHtml: '<p>Chờ duyệt có media</p>',
          attachmentIds: pendingOrder,
          mediaLayout: 'grid',
        });
        expect(pending.status).toBe('pending');
        const moderation = moduleRef.get(SocialModerationService);
        const queued = (await moderation.listPending(moderator())).items.find((item) => item.id === pending.id);
        expect(idsOf(queued ?? {})).toEqual(pendingOrder);
        expect(queued?.mediaLayout).toBe('grid');
        const approved = await moderation.approve(moderator(), pending.id);
        expect(approved.status).toBe('published');
        expect(idsOf(approved)).toEqual(pendingOrder);
        expect(approved.mediaLayout).toBe('grid');
      } finally {
        await pool.query(`UPDATE social_schema.settings SET value = 'false'::jsonb WHERE key = 'wall.requireApproval'`);
      }
    });

    it('vượt 3 video hoặc 10 tệp vẫn bị từ chối dù đã bỏ luật không trộn ảnh với video', async () => {
      const videos = await Promise.all([1, 2, 3, 4].map((n) => addFile('video/mp4', `v${n}.mp4`, { status: 'ready' })));
      await expect(publishing.create(a(), { bodyHtml: '<p>4 video</p>', attachmentIds: videos })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      const files = await Promise.all(Array.from({ length: 11 }, (_, n) => addFile('image/png', `i${n}.png`)));
      await expect(publishing.create(a(), { bodyHtml: '<p>11 tệp</p>', attachmentIds: files })).rejects.toMatchObject({
        code: 'VALIDATION',
      });
    });
  });
});
