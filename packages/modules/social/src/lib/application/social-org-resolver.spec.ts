import type { SocialOrgNode } from '@enterprise-platform/contracts-social';
import { SocialError, SocialPostNotFoundError } from '../domain/social.error.js';
import { SocialPostStateError } from '../domain/social-publishing.error.js';
import type { SocialActor } from './social-actor.js';
import { SocialOrgService } from './social-org.service.js';
import type { SocialPostAccess } from './social-post-access.js';
import { SocialReportTargetResolver } from './social-report-target.resolver.js';
import type { CommentRow, SocialStore } from './social-store.port.js';

const TENANT = 'tenant-1';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const POST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SECRET_POST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRAFT_POST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COMMENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DELETED_COMMENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SECRET_COMMENT = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const GROUP = '99999999-9999-4999-8999-999999999999';
const LONG_COMMENT = '12345678-1234-4234-8234-123456789abc';

function actor(userId: string): SocialActor {
  return {
    tenantId: TENANT,
    userId,
    displayName: 'Ai đó',
    isTenantAdmin: false,
    canRead: true,
    canWrite: true,
    canModerate: false,
    canManage: false,
  };
}

describe('SocialOrgService', () => {
  const nodes: SocialOrgNode[] = [{ id: 'n1', name: 'Phòng Kho', kind: 'unit', memberCount: 2 }];
  const listNodes = jest.fn(async () => nodes);
  const service = new SocialOrgService({ listNodes });

  beforeEach(() => listNodes.mockClear());

  it('mặc định 50 mục, tối đa 200, bỏ qua tham số rỗng', async () => {
    expect(await service.list(actor(ALICE))).toEqual({ items: nodes });
    expect(listNodes).toHaveBeenLastCalledWith(TENANT, { limit: 50 });
    await service.list(actor(ALICE), { kind: 'position', query: '  kho ', limit: '999' });
    expect(listNodes).toHaveBeenLastCalledWith(TENANT, { kind: 'position', query: 'kho', limit: 200 });
    await service.list(actor(ALICE), { kind: '', query: '', limit: '' });
    expect(listNodes).toHaveBeenLastCalledWith(TENANT, { limit: 50 });
  });

  it('loại, từ khoá hoặc số mục sai là 400 VALIDATION', async () => {
    for (const query of [{ kind: 'team' }, { query: 'x'.repeat(101) }, { limit: 0 }, { limit: 'abc' }, { limit: 1.5 }]) {
      const error = await service.list(actor(ALICE), query).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(SocialError);
      expect(error).toMatchObject({ code: 'VALIDATION', statusCode: 400 });
    }
    expect(listNodes).not.toHaveBeenCalled();
  });
});

describe('SocialReportTargetResolver', () => {
  const posts: Record<string, { title?: string; bodyHtml: string; authorId: string; groupId?: string; groupPrivacy?: 'public' | 'private' }> = {
    [POST]: { title: 'Kế hoạch quý', bodyHtml: '<p>nội dung</p>', authorId: ALICE },
    [GROUP]: { bodyHtml: '<p>Bài trong nhóm kín</p>', authorId: ALICE, groupId: GROUP, groupPrivacy: 'private' },
  };
  /** Chỉ Alice thấy bài bí mật (như quyền xem `private`); Bob không. */
  const access = {
    requirePublished: async (who: SocialActor, id: string) => {
      if (id === DRAFT_POST) throw new SocialPostStateError();
      if (id === SECRET_POST) {
        if (who.userId !== ALICE) throw new SocialPostNotFoundError();
        return { id, authorId: ALICE, bodyHtml: '<p>bí mật</p>' };
      }
      const post = posts[id];
      if (!post) throw new SocialPostNotFoundError();
      return { id, ...post };
    },
  } as unknown as SocialPostAccess;
  const comments: Record<string, CommentRow> = {
    [COMMENT]: { id: COMMENT, postId: POST, authorId: BOB, body: 'Bình luận\n  rất  dài', createdAt: '', deleted: false, replyCount: 0 },
    [DELETED_COMMENT]: { id: DELETED_COMMENT, postId: POST, authorId: BOB, body: 'x', createdAt: '', deleted: true, replyCount: 0 },
    [SECRET_COMMENT]: { id: SECRET_COMMENT, postId: SECRET_POST, authorId: ALICE, body: 'ghi chú riêng', createdAt: '', deleted: false, replyCount: 0 },
  };
  const store = { comments: { findById: async (_t: string, id: string) => comments[id] } } as unknown as Pick<SocialStore, 'comments'>;
  const directory = {
    resolve: async (_t: string, ids: readonly string[]) =>
      new Map(ids.map((id) => [id.toLowerCase(), { id, name: id === ALICE ? 'Alice' : 'Bob' }] as const)),
    search: async () => [],
  };
  const resolver = new SocialReportTargetResolver({ access, store, directory });

  it('bài thấy được: trả nhóm, tác giả và tóm tắt (tiêu đề hoặc đoạn đầu nội dung)', async () => {
    expect(await resolver.resolveForReporter(actor(BOB), 'post', POST)).toEqual({
      targetType: 'post',
      targetId: POST,
      postId: POST,
      authorId: ALICE,
      summary: { label: 'Kế hoạch quý', postId: POST, authorName: 'Alice' },
    });
    expect(await resolver.resolveForReporter(actor(BOB), 'post', GROUP)).toMatchObject({
      groupId: GROUP,
      groupPrivacy: 'private',
      summary: { label: 'Bài trong nhóm kín' },
    });
  });

  it('bình luận: tóm tắt gọn chữ thuần kèm bài và tác giả', async () => {
    expect(await resolver.resolveForReporter(actor(ALICE), 'comment', COMMENT)).toMatchObject({
      targetType: 'comment',
      postId: POST,
      authorId: BOB,
      summary: { label: 'Bình luận rất dài', postId: POST, commentId: COMMENT, authorName: 'Bob' },
    });
    comments[LONG_COMMENT] = { ...comments[COMMENT], id: LONG_COMMENT, body: 'a'.repeat(300) };
    const resolved = await resolver.resolveForReporter(actor(ALICE), 'comment', LONG_COMMENT);
    expect(resolved?.summary.label).toHaveLength(120);
    expect(resolved?.summary.label.endsWith('…')).toBe(true);
  });

  it('không thấy, chưa đăng, đã xoá hoặc id lạ đều như không có (không dò ra bài quyền hẹp)', async () => {
    expect(await resolver.resolveForReporter(actor(BOB), 'post', SECRET_POST)).toBeUndefined();
    expect(await resolver.resolveForReporter(actor(BOB), 'comment', SECRET_COMMENT)).toBeUndefined();
    expect(await resolver.resolveForReporter(actor(BOB), 'post', DRAFT_POST)).toBeUndefined();
    expect(await resolver.resolveForReporter(actor(BOB), 'comment', DELETED_COMMENT)).toBeUndefined();
    expect(await resolver.resolveForReporter(actor(BOB), 'post', 'khong-phai-uuid')).toBeUndefined();
    expect(await resolver.resolveForReporter(actor(BOB), 'comment', '12345678-1234-4234-8234-123456789012')).toBeUndefined();
  });

  it('hàng đợi của người xử lý: bỏ mục không xem được, giữ khoá targetType:targetId', async () => {
    const summaries = await resolver.summariesForHandler(actor(BOB), [
      { targetType: 'post', targetId: POST },
      { targetType: 'post', targetId: SECRET_POST },
      { targetType: 'comment', targetId: COMMENT },
      { targetType: 'comment', targetId: SECRET_COMMENT },
    ]);
    expect([...summaries.keys()]).toEqual([`post:${POST}`, `comment:${COMMENT}`]);
    expect(summaries.get(`post:${POST}`)).toMatchObject({ label: 'Kế hoạch quý', postId: POST });
  });
});
