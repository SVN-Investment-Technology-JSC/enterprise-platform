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
import { SocialCommentService } from './application/social-comment.service.js';
import { SocialFeedService } from './application/social-feed.service.js';
import { SocialGroupMemberService } from './application/social-group-member.service.js';
import { SocialGroupService } from './application/social-group.service.js';
import { SocialPollService } from './application/social-poll.service.js';
import { SocialPublishingService } from './application/social-publishing.service.js';
import { SocialSchedulerService } from './application/social-scheduler.service.js';
import { SocialSearchService } from './application/social-search.service.js';
import { SocialPostNotFoundError } from './domain/social.error.js';
import { SocialModule } from './social.module.js';

/**
 * Chạy với PostgreSQL dùng một lần ở máy, ví dụ
 * `SOCIAL_TEST_ADMIN_URL=postgresql://tenant:tenant@localhost:15436/postgres`. Tự tạo DB tạm, áp migration
 * tenant (integration + social 0001-0003) rồi xoá DB. Bỏ qua khi không đặt biến môi trường.
 */
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
});
