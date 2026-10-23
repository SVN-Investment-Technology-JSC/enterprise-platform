import { randomUUID } from 'node:crypto';
import { SOCIAL_EVENT_TYPES, type SocialReactionType, type SocialUserRef } from '@enterprise-platform/contracts-social';
import {
  SocialAttachmentUnavailableError,
  SocialError,
  SocialForbiddenError,
  SocialPostNotFoundError,
  SocialRateLimitedError,
  SocialTopicNameTakenError,
} from '../domain/social.error.js';
import { UploadRateLimiter } from './upload-rate-limiter.js';
import { SocialStorageQuotaExceededError } from '../domain/social.error.js';
import type { AttachmentStorage } from './attachment-storage.port.js';
import type { OrganizationDirectory } from './organization-directory.port.js';
import type { SocialActor } from './social-actor.js';
import { SocialAttachmentService } from './social-attachment.service.js';
import type { StorageQuotaPort } from './ports/storage-quota.port.js';
import type { SocialCommentAttachmentStore } from './social-comment-attachment-store.port.js';
import type { SocialCommentReactionStore } from './social-comment-reaction-store.port.js';
import { SocialCommentService } from './social-comment.service.js';
import { SocialMeService } from './social-me.service.js';
import { SocialPostService } from './social-post.service.js';
import { SocialReactionService } from './social-reaction.service.js';
import type {
  AttachmentRow,
  CommentRow,
  FeedFilter,
  PostRow,
  ReactionSummaryRow,
  SocialOutboxEvent,
  SocialStore,
  TopicRow,
} from './social-store.port.js';
import { SocialTopicService } from './social-topic.service.js';

const TENANT = 'tenant-1';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';
const STRANGER = '99999999-9999-4999-8999-999999999999';

const NAMES: Record<string, SocialUserRef> = {
  [ALICE]: { id: ALICE, name: 'Alice Nguyễn', position: 'Trưởng phòng', unitName: 'Phòng Dự án' },
  [BOB]: { id: BOB, name: 'Bob Trần' },
  [CAROL]: { id: CAROL, name: 'Carol Lê' },
};

function actor(userId: string, flags: Partial<SocialActor> = {}): SocialActor {
  return {
    tenantId: TENANT,
    userId,
    displayName: NAMES[userId]?.name ?? 'Ai đó',
    isTenantAdmin: false,
    canRead: true,
    canWrite: true,
    canModerate: false,
    canManage: false,
    ...flags,
  };
}

const alice = actor(ALICE);
const bob = actor(BOB);
const moderator = actor(CAROL, { canModerate: true });
const readOnly = actor(BOB, { canWrite: false });

/* --------------------------------------------------------------- bản giả */

interface StoredPost extends Omit<PostRow, 'pinned'> {
  pinned: boolean;
  status: 'published' | 'deleted';
}
interface StoredComment {
  id: string;
  postId: string;
  parentId?: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt?: string;
  deleted: boolean;
}

class FakeStore implements SocialStore {
  posts_: StoredPost[] = [];
  mentionsByPost = new Map<string, string[]>();
  attachments_ = new Map<string, AttachmentRow>();
  comments_: StoredComment[] = [];
  mentionsByComment = new Map<string, string[]>();
  reactions_ = new Map<string, SocialReactionType>(); // `${postId}|${userId}`
  topics_ = new Map<string, { id: string; name: string; isActive: boolean }>();
  events: SocialOutboxEvent[] = [];
  private tick = 0;

  private stamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0) + this.tick * 1000).toISOString();
  }

  private view(post: StoredPost): PostRow {
    const topic = post.topicId ? this.topics_.get(post.topicId) : undefined;
    return {
      ...post,
      ...(topic ? { topicName: topic.name } : {}),
      commentCount: this.comments_.filter((c) => c.postId === post.id && !c.deleted).length,
    };
  }

  private matches(post: StoredPost, filter: FeedFilter): boolean {
    return (
      post.status === 'published' &&
      (!filter.topicId || post.topicId === filter.topicId) &&
      (!filter.kind || post.kind === filter.kind) &&
      (!filter.authorId || post.authorId === filter.authorId)
    );
  }

  readonly posts: SocialStore['posts'] = {
    pinned: async (_t, filter, limit) =>
      this.posts_
        .filter((p) => p.pinned && this.matches(p, filter))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
        .slice(0, limit)
        .map((p) => this.view(p)),
    feed: async (_t, query) =>
      this.posts_
        .filter((p) => !p.pinned && this.matches(p, query))
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id))
        .filter(
          (p) =>
            !query.cursor ||
            p.publishedAt < query.cursor.at ||
            (p.publishedAt === query.cursor.at && p.id < query.cursor.id),
        )
        .slice(0, query.limit)
        .map((p) => this.view(p)),
    findById: async (_t, id) => {
      const post = this.posts_.find((p) => p.id === id && p.status === 'published');
      return post ? this.view(post) : undefined;
    },
    relations: async (_t, postIds, viewerId) => {
      const mentions = new Map<string, string[]>();
      const attachments = new Map<string, AttachmentRow[]>();
      const reactions = new Map<string, { counts: Partial<Record<SocialReactionType, number>>; total: number; mine?: SocialReactionType }>();
      for (const id of postIds) {
        mentions.set(id, this.mentionsByPost.get(id) ?? []);
        attachments.set(
          id,
          [...this.attachments_.values()].filter((a) => a.postId === id && a.completed),
        );
        reactions.set(id, this.reactionSummary(id, viewerId));
      }
      return { mentions, attachments, reactions };
    },
    insert: async (_t, input) => {
      this.checkAttachments(input.id, input.attachmentIds, input.uploaderId);
      this.posts_.push({
        id: input.id,
        authorId: input.authorId,
        kind: input.kind,
        ...(input.title ? { title: input.title } : {}),
        bodyHtml: input.bodyHtml,
        ...(input.topicId ? { topicId: input.topicId } : {}),
        pinned: input.pinned,
        mentionsAll: input.mentionsAll,
        publishedAt: this.stamp(),
        commentCount: 0,
        status: 'published',
      });
      this.mentionsByPost.set(input.id, [...input.mentionUserIds]);
      this.events.push(...input.events);
    },
    update: async (_t, id, patch) => {
      const index = this.posts_.findIndex((p) => p.id === id && p.status === 'published');
      if (index === -1) throw new SocialPostNotFoundError();
      if (patch.attachmentIds) this.checkAttachments(id, patch.attachmentIds, patch.uploaderId);
      const current = this.posts_[index];
      this.posts_[index] = {
        ...current,
        title: undefined,
        ...(patch.title === undefined ? (current.title ? { title: current.title } : {}) : patch.title ? { title: patch.title } : {}),
        bodyHtml: patch.bodyHtml ?? current.bodyHtml,
        ...(patch.topicId === undefined ? (current.topicId ? { topicId: current.topicId } : {}) : patch.topicId ? { topicId: patch.topicId } : {}),
        editedAt: this.stamp(),
      };
      if (patch.mentionUserIds) this.mentionsByPost.set(id, [...patch.mentionUserIds]);
      if (patch.attachmentIds) {
        for (const [key, row] of this.attachments_) {
          if (row.postId === id && !patch.attachmentIds.includes(key)) {
            this.attachments_.set(key, { ...row, postId: undefined });
          }
        }
      }
      this.events.push(...patch.events);
    },
    softDelete: async (_t, id) => {
      const post = this.posts_.find((p) => p.id === id && p.status === 'published');
      if (!post) throw new SocialPostNotFoundError();
      post.status = 'deleted';
      post.pinned = false;
    },
    setPinned: async (_t, id, pinned) => {
      const post = this.posts_.find((p) => p.id === id && p.status === 'published');
      if (!post) throw new SocialPostNotFoundError();
      post.pinned = pinned;
    },
  };

  private checkAttachments(postId: string, ids: readonly string[], uploaderId: string): void {
    const rows = ids.map((id) => this.attachments_.get(id));
    for (const row of rows) {
      const ok = row && row.completed && (row.postId === postId || (!row.postId && row.uploadedBy === uploaderId));
      if (!ok) throw new SocialAttachmentUnavailableError();
    }
    for (const row of rows as AttachmentRow[]) this.attachments_.set(row.id, { ...row, postId });
  }

  private reactionSummary(postId: string, viewerId: string) {
    const counts: Partial<Record<SocialReactionType, number>> = {};
    let total = 0;
    for (const [key, type] of this.reactions_) {
      if (!key.startsWith(`${postId}|`)) continue;
      counts[type] = (counts[type] ?? 0) + 1;
      total += 1;
    }
    const mine = this.reactions_.get(`${postId}|${viewerId}`);
    return { counts, total, ...(mine ? { mine } : {}) };
  }

  readonly reactions: SocialStore['reactions'] = {
    set: async (_t, postId, userId, type) => void this.reactions_.set(`${postId}|${userId}`, type),
    remove: async (_t, postId, userId) => void this.reactions_.delete(`${postId}|${userId}`),
    summary: async (_t, postId, viewerId) => this.reactionSummary(postId, viewerId),
    list: async (_t, postId, limit) =>
      [...this.reactions_]
        .filter(([key]) => key.startsWith(`${postId}|`))
        .slice(0, limit)
        .map(([key, type]) => ({ userId: key.split('|')[1], type, reactedAt: '2026-01-01T00:00:00.000000Z' })),
  };

  linkToComment(attachmentId: string, commentId: string): void {
    const row = this.attachments_.get(attachmentId);
    if (row) this.attachments_.set(attachmentId, { ...row, commentId });
  }

  private commentView(comment: StoredComment): CommentRow {
    return {
      ...comment,
      replyCount: this.comments_.filter((c) => c.parentId === comment.id && !c.deleted).length,
    };
  }

  readonly comments: SocialStore['comments'] = {
    findById: async (_t, id) => {
      const found = this.comments_.find((c) => c.id === id);
      return found ? this.commentView(found) : undefined;
    },
    list: async (_t, query) =>
      this.comments_
        .filter((c) =>
          query.parentId
            ? c.parentId === query.parentId && !c.deleted
            : c.postId === query.postId &&
              !c.parentId &&
              (!c.deleted || this.comments_.some((r) => r.parentId === c.id && !r.deleted)),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .filter((c) => !query.cursor || c.createdAt > query.cursor.at || (c.createdAt === query.cursor.at && c.id > query.cursor.id))
        .slice(0, query.limit)
        .map((c) => this.commentView(c)),
    mentions: async (_t, ids) => new Map(ids.map((id) => [id, this.mentionsByComment.get(id) ?? []])),
    insert: async (_t, input) => {
      this.comments_.push({
        id: input.id,
        postId: input.postId,
        ...(input.parentId ? { parentId: input.parentId } : {}),
        authorId: input.authorId,
        body: input.body,
        createdAt: this.stamp(),
        deleted: false,
      });
      this.mentionsByComment.set(input.id, [...input.mentionUserIds]);
      for (const attachmentId of input.attachmentIds ?? []) this.linkToComment(attachmentId, input.id);
      this.events.push(...input.events);
    },
    update: async (_t, id, patch) => {
      const comment = this.comments_.find((c) => c.id === id);
      if (comment) {
        comment.body = patch.body;
        comment.editedAt = this.stamp();
      }
      this.mentionsByComment.set(id, [...patch.mentionUserIds]);
      for (const attachmentId of patch.attachmentIds ?? []) this.linkToComment(attachmentId, id);
      this.events.push(...patch.events);
    },
    softDelete: async (_t, id) => {
      const comment = this.comments_.find((c) => c.id === id);
      if (comment) comment.deleted = true;
    },
  };

  readonly topics: SocialStore['topics'] = {
    list: async (_t, includeInactive) =>
      [...this.topics_.values()].filter((t) => includeInactive || t.isActive).map((t) => this.topicRow(t.id)),
    findById: async (_t, id) => (this.topics_.has(id) ? this.topicRow(id) : undefined),
    insert: async (_t, input) => {
      if ([...this.topics_.values()].some((t) => t.name.toLowerCase() === input.name.toLowerCase())) {
        throw new SocialTopicNameTakenError(input.name);
      }
      this.topics_.set(input.id, { id: input.id, name: input.name, isActive: true });
    },
    update: async (_t, id, patch) => {
      const topic = this.topics_.get(id);
      if (topic) this.topics_.set(id, { ...topic, ...patch });
    },
  };

  private topicRow(id: string): TopicRow {
    const topic = this.topics_.get(id) as { id: string; name: string; isActive: boolean };
    return {
      ...topic,
      postCount: this.posts_.filter((p) => p.topicId === id && p.status === 'published').length,
    };
  }

  readonly attachments: SocialStore['attachments'] = {
    insert: async (_t, input) => void this.attachments_.set(input.id, { ...input, completed: false }),
    findById: async (_t, id) => this.attachments_.get(id),
    markCompleted: async (_t, id, sizeBytes) => {
      const row = this.attachments_.get(id);
      if (row) this.attachments_.set(id, { ...row, sizeBytes, completed: true });
    },
    listOrphans: async (_t, _olderThan, limit) =>
      [...this.attachments_.values()]
        .filter((a) => !a.postId && !a.commentId)
        .slice(0, limit)
        .map((a) => ({ id: a.id, storageKey: a.storageKey })),
    deleteByIds: async (_t, ids) => {
      for (const id of ids) this.attachments_.delete(id);
    },
    countPending: async (_t, uploaderId) =>
      [...this.attachments_.values()].filter(
        (a) => a.uploadedBy === uploaderId && !a.completed && !a.postId && !a.commentId,
      ).length,
  };
}

class FakeDirectory implements OrganizationDirectory {
  async resolve(_tenantId: string, ids: readonly string[]) {
    return new Map(ids.filter((id) => NAMES[id.toLowerCase()]).map((id) => [id.toLowerCase(), NAMES[id.toLowerCase()]]));
  }
  async search(_tenantId: string, query: string, limit: number) {
    return Object.values(NAMES)
      .filter((u) => u.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit);
  }
}

class FakeStorage implements AttachmentStorage {
  uploaded = new Map<string, number>();
  deleted: string[] = [];
  failDelete = new Set<string>();
  /** Nội dung đầu tệp theo khoá; thiếu thì suy ra từ đuôi tên tệp (đủ chữ ký hợp lệ). */
  heads = new Map<string, Uint8Array>();
  downloadTtls: number[] = [];
  async readHead(key: string) {
    const custom = this.heads.get(key);
    if (custom) return custom;
    const lower = key.toLowerCase();
    if (lower.endsWith('.png')) return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (lower.endsWith('.jpg')) return Uint8Array.from([0xff, 0xd8, 0xff]);
    if (lower.endsWith('.mp4')) return Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
    if (lower.endsWith('.webm')) return Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
    return new Uint8Array();
  }
  /** Kích thước đã ghim của từng URL tải lên, theo khoá. */
  pinnedSizes = new Map<string, number>();
  /** Phiên nhiều phần đang mở: uploadId -> khoá và các phần đã "tải". */
  multipart = new Map<string, { key: string; parts: Map<number, { etag: string; sizeBytes: number }> }>();
  aborted: string[] = [];
  completedMultipart: string[] = [];
  failAbortMultipart = false;
  async createUploadUrl({ key, sizeBytes }: { key: string; sizeBytes?: number }) {
    if (sizeBytes !== undefined) this.pinnedSizes.set(key, sizeBytes);
    return `https://storage.test/up/${key}`;
  }
  async createMultipartUpload(key: string) {
    const uploadId = `upload-${this.multipart.size + 1}`;
    this.multipart.set(uploadId, { key, parts: new Map() });
    return uploadId;
  }
  async createUploadPartUrl(input: { key: string; uploadId: string; partNumber: number; sizeBytes: number }) {
    return `https://storage.test/up/${input.key}?uploadId=${input.uploadId}&part=${input.partNumber}&len=${input.sizeBytes}`;
  }
  /** Giả lập trình duyệt PUT một phần lên URL đã ký. */
  putPart(uploadId: string, partNumber: number, sizeBytes: number) {
    this.multipart.get(uploadId)?.parts.set(partNumber, { etag: `"etag-${partNumber}"`, sizeBytes });
  }
  async listParts(key: string, uploadId: string) {
    const session = this.multipart.get(uploadId);
    if (!session || session.key !== key) throw new Error('NoSuchUpload');
    return [...session.parts].map(([partNumber, part]) => ({ partNumber, ...part }));
  }
  async completeMultipartUpload(key: string, uploadId: string, parts: readonly { partNumber: number }[]) {
    const session = this.multipart.get(uploadId);
    if (!session) throw new Error('NoSuchUpload');
    let total = 0;
    for (const { partNumber } of parts) total += session.parts.get(partNumber)?.sizeBytes ?? 0;
    this.uploaded.set(key, total);
    this.completedMultipart.push(uploadId);
    this.multipart.delete(uploadId);
  }
  async abortMultipartUpload(_key: string, uploadId: string) {
    if (this.failAbortMultipart) throw new Error('S3 down');
    this.aborted.push(uploadId);
    this.multipart.delete(uploadId);
  }
  async createDownloadUrl(key: string, expiresInSeconds?: number) {
    this.downloadTtls.push(expiresInSeconds ?? 0);
    return `https://storage.test/down/${key}`;
  }
  async objectMetadata(key: string) {
    const size = this.uploaded.get(key);
    if (size === undefined) throw new Error('NotFound');
    return { sizeBytes: size, contentType: 'application/pdf' };
  }
  async deleteObjects(keys: readonly string[]) {
    const failed = keys.filter((key) => this.failDelete.has(key));
    this.deleted.push(...keys.filter((key) => !this.failDelete.has(key)));
    return { failed };
  }
}

class FakeCommentAttachments implements SocialCommentAttachmentStore {
  constructor(private readonly store: FakeStore) {}
  async forComments(_tenantId: string, commentIds: readonly string[]) {
    const map = new Map<string, AttachmentRow[]>();
    for (const row of this.store.attachments_.values()) {
      if (row.commentId && row.completed && commentIds.includes(row.commentId)) {
        map.set(row.commentId, [...(map.get(row.commentId) ?? []), row]);
      }
    }
    return map;
  }
  async detach(_tenantId: string, commentId: string, keepIds: readonly string[]) {
    const detached: AttachmentRow[] = [];
    for (const [id, row] of this.store.attachments_) {
      if (row.commentId === commentId && !keepIds.includes(id)) {
        const { commentId: _removed, ...rest } = row;
        this.store.attachments_.set(id, rest);
        detached.push(row);
      }
    }
    return detached;
  }
}

class FakeCommentReactions implements SocialCommentReactionStore {
  private readonly rows = new Map<string, Map<string, SocialReactionType>>();
  async set(_tenantId: string, commentId: string, userId: string, type: SocialReactionType) {
    this.rows.set(commentId, (this.rows.get(commentId) ?? new Map()).set(userId, type));
  }
  async remove(_tenantId: string, commentId: string, userId: string) {
    this.rows.get(commentId)?.delete(userId);
  }
  async list(_tenantId: string, commentId: string) {
    return [...(this.rows.get(commentId) ?? [])].map(([userId, type]) => ({
      userId,
      type,
      reactedAt: new Date().toISOString(),
    }));
  }
  async summaries(_tenantId: string, commentIds: readonly string[], viewerId: string) {
    const result = new Map<string, ReactionSummaryRow>();
    for (const id of commentIds) {
      const counts: Partial<Record<SocialReactionType, number>> = {};
      for (const type of this.rows.get(id)?.values() ?? []) counts[type] = (counts[type] ?? 0) + 1;
      const mine = this.rows.get(id)?.get(viewerId);
      result.set(id, {
        counts,
        total: Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0),
        ...(mine ? { mine } : {}),
      });
    }
    return result;
  }
}

function setup() {
  const store = new FakeStore();
  const directory = new FakeDirectory();
  const storage = new FakeStorage();
  return {
    store,
    storage,
    posts: new SocialPostService(store, directory, storage),
    reactions: new SocialReactionService(store, directory),
    comments: new SocialCommentService(
      store,
      directory,
      undefined,
      undefined,
      new FakeCommentReactions(),
      new FakeCommentAttachments(store),
      storage,
    ),
    topics: new SocialTopicService(store),
    attachments: new SocialAttachmentService(store, storage),
    me: new SocialMeService(directory),
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SocialError);
  expect((error as SocialError).code).toBe(code);
}

/* ------------------------------------------------------------------ test */

describe('bài viết', () => {
  it('tạo bài: làm sạch HTML, gắn người nhắc, trả về đủ thông tin', async () => {
    const { posts } = setup();
    const post = await posts.create(alice, {
      title: '  Thông báo  ',
      bodyHtml: '<p onclick="x()">Chào <strong>cả nhà</strong></p><script>alert(1)</script>',
      mentionUserIds: [BOB, STRANGER],
    });
    expect(post.bodyHtml).toBe('<p>Chào <strong>cả nhà</strong></p>');
    expect(post.title).toBe('Thông báo');
    expect(post.author.name).toBe('Alice Nguyễn');
    expect(post.mentions.map((u) => u.id)).toEqual([BOB]); // id lạ bị bỏ
    expect(post.capabilities).toEqual({ canEdit: true, canDelete: true, canPin: false, canComment: true });
  });

  it('người chỉ đọc không đăng được bài', async () => {
    const { posts } = setup();
    await expectCode(posts.create(readOnly, { bodyHtml: '<p>x</p>' }), 'FORBIDDEN');
  });

  it('không có quyền đọc thì không xem được bảng tin', async () => {
    const { posts } = setup();
    const nobody = actor(BOB, { canRead: false, canWrite: false });
    await expectCode(posts.feed(nobody), 'FORBIDDEN');
  });

  it('@all và ghim cần social.post.moderate', async () => {
    const { posts } = setup();
    await expectCode(posts.create(alice, { bodyHtml: '<p>x</p>', mentionsAll: true }), 'FORBIDDEN');
    await expectCode(posts.create(alice, { bodyHtml: '<p>x</p>', pinned: true }), 'FORBIDDEN');
    const post = await posts.create(moderator, { bodyHtml: '<p>x</p>', mentionsAll: true, pinned: true });
    expect(post.mentionsAll).toBe(true);
    expect(post.pinned).toBe(true);
  });

  it('bài rỗng bị từ chối, bài chỉ có tệp thì được', async () => {
    const { posts, attachments, storage } = setup();
    await expectCode(posts.create(alice, { bodyHtml: '<p><br></p>' }), 'VALIDATION');
    const { attachmentId } = await attachments.initiate(alice, {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });
    await uploadAndComplete(attachments, storage, alice, attachmentId, 100);
    const post = await posts.create(alice, { bodyHtml: '', attachmentIds: [attachmentId] });
    expect(post.attachments).toHaveLength(1);
    expect(post.attachments[0].url).toContain('https://storage.test/down/');
  });

  it('chỉ tác giả hoặc người kiểm duyệt mới sửa và xoá được', async () => {
    const { posts } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>gốc</p>' });
    await expectCode(posts.update(bob, post.id, { bodyHtml: '<p>sửa</p>' }), 'FORBIDDEN');
    await expectCode(posts.remove(bob, post.id), 'FORBIDDEN');

    const edited = await posts.update(alice, post.id, { bodyHtml: '<p>sửa</p><script>x</script>' });
    expect(edited.bodyHtml).toBe('<p>sửa</p>');
    expect(edited.editedAt).toBeDefined();
    expect((await posts.update(moderator, post.id, { title: 'Tiêu đề mới' })).title).toBe('Tiêu đề mới');

    await posts.remove(moderator, post.id);
    await expectCode(posts.get(alice, post.id), 'POST_NOT_FOUND');
  });

  it('chỉ người kiểm duyệt mới ghim được', async () => {
    const { posts } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    await expectCode(posts.setPinned(alice, post.id, { pinned: true }), 'FORBIDDEN');
    expect((await posts.setPinned(moderator, post.id, { pinned: true })).pinned).toBe(true);
  });

  it('id không phải UUID là lỗi xác thực, không chạm DB', async () => {
    const { posts } = setup();
    await expectCode(posts.get(alice, 'abc'), 'VALIDATION');
  });

  it('chuyên mục phải có và đang dùng', async () => {
    const { posts, topics } = setup();
    await expectCode(posts.create(alice, { bodyHtml: '<p>x</p>', topicId: randomUUID() }), 'TOPIC_NOT_FOUND');
    const topic = await topics.create(actor(ALICE, { canManage: true }), { name: 'Tin tức' });
    await topics.update(actor(ALICE, { canManage: true }), topic.id, { isActive: false });
    await expectCode(posts.create(alice, { bodyHtml: '<p>x</p>', topicId: topic.id }), 'TOPIC_INACTIVE');
  });

  it('tệp của người khác hoặc chưa tải xong không gắn được', async () => {
    const { posts, attachments, storage } = setup();
    const pending = await attachments.initiate(alice, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 5 });
    await expectCode(posts.create(alice, { bodyHtml: '<p>x</p>', attachmentIds: [pending.attachmentId] }), 'ATTACHMENT_UNAVAILABLE');

    const done = await attachments.initiate(alice, { fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 5 });
    await uploadAndComplete(attachments, storage, alice, done.attachmentId, 5);
    await expectCode(posts.create(bob, { bodyHtml: '<p>x</p>', attachmentIds: [done.attachmentId] }), 'ATTACHMENT_UNAVAILABLE');
  });
});

describe('bảng tin', () => {
  it('phân trang theo con trỏ, mới nhất trước, không lặp và không sót', async () => {
    const { posts } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await posts.create(alice, { bodyHtml: `<p>bài ${i}</p>` })).id);

    const first = await posts.feed(alice, { limit: 2 });
    expect(first.items.map((p) => p.id)).toEqual([ids[4], ids[3]]);
    expect(first.nextCursor).toBeDefined();

    const second = await posts.feed(alice, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((p) => p.id)).toEqual([ids[2], ids[1]]);

    const third = await posts.feed(alice, { limit: 2, cursor: second.nextCursor });
    expect(third.items.map((p) => p.id)).toEqual([ids[0]]);
    expect(third.nextCursor).toBeUndefined();
  });

  it('bài ghim nằm đầu trang đầu và không lặp ở các trang sau', async () => {
    const { posts } = setup();
    const old = await posts.create(moderator, { bodyHtml: '<p>cũ</p>', pinned: true });
    const a = await posts.create(alice, { bodyHtml: '<p>a</p>' });
    const b = await posts.create(alice, { bodyHtml: '<p>b</p>' });
    const c = await posts.create(alice, { bodyHtml: '<p>c</p>' });

    const first = await posts.feed(alice, { limit: 2 });
    expect(first.items.map((p) => p.id)).toEqual([old.id, c.id, b.id]);
    const second = await posts.feed(alice, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((p) => p.id)).toEqual([a.id]);
  });

  it('con trỏ giả bị từ chối', async () => {
    const { posts } = setup();
    await expectCode(posts.feed(alice, { cursor: 'xyz' }), 'VALIDATION');
  });

  it('lọc theo chuyên mục và bài xoá không hiện', async () => {
    const { posts, topics } = setup();
    const topic = await topics.create(actor(ALICE, { canManage: true }), { name: 'Sự kiện' });
    const inTopic = await posts.create(alice, { bodyHtml: '<p>1</p>', topicId: topic.id });
    await posts.create(alice, { bodyHtml: '<p>2</p>' });
    const gone = await posts.create(alice, { bodyHtml: '<p>3</p>', topicId: topic.id });
    await posts.remove(alice, gone.id);
    const page = await posts.feed(alice, { topicId: topic.id });
    expect(page.items.map((p) => p.id)).toEqual([inTopic.id]);
    expect(page.items[0].topic).toEqual({ id: topic.id, name: 'Sự kiện' });
  });
});

describe('phản ứng', () => {
  it('đặt, đổi, bỏ phản ứng và cập nhật số đếm', async () => {
    const { posts, reactions } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });

    expect(await reactions.set(bob, post.id, { type: 'like' })).toEqual({
      reactionCounts: { like: 1 },
      reactionTotal: 1,
      myReaction: 'like',
    });
    await reactions.set(alice, post.id, { type: 'love' });
    const changed = await reactions.set(bob, post.id, { type: 'celebrate' });
    expect(changed.reactionCounts).toEqual({ love: 1, celebrate: 1 });
    expect(changed.reactionTotal).toBe(2);

    const removed = await reactions.set(bob, post.id, { type: null });
    expect(removed.myReaction).toBeUndefined();
    expect(removed.reactionTotal).toBe(1);

    const list = await reactions.reactors(bob, post.id);
    expect(list.items.map((r) => r.user.name)).toEqual(['Alice Nguyễn']);
  });

  it('loại lạ và người chỉ đọc bị từ chối', async () => {
    const { posts, reactions } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    await expectCode(reactions.set(bob, post.id, { type: 'angry' as never }), 'VALIDATION');
    await expectCode(reactions.set(readOnly, post.id, { type: 'like' }), 'FORBIDDEN');
  });

  it('bài không tồn tại thì 404', async () => {
    const { reactions } = setup();
    await expectCode(reactions.set(bob, randomUUID(), { type: 'like' }), 'POST_NOT_FOUND');
  });
});

describe('bình luận', () => {
  it('chỉ hai cấp: trả lời bình luận gốc được, trả lời một trả lời thì bị từ chối', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    const root = await comments.create(bob, post.id, { body: 'gốc' });
    const reply = await comments.create(alice, post.id, { body: 'trả lời', parentId: root.id });
    expect(reply.parentId).toBe(root.id);
    await expectCode(comments.create(bob, post.id, { body: 'cấp ba', parentId: reply.id }), 'VALIDATION');
  });

  it('liệt kê bình luận gốc kèm replyCount, rồi trả lời theo parentId', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    const root = await comments.create(bob, post.id, { body: 'gốc' });
    await comments.create(alice, post.id, { body: 'r1', parentId: root.id });
    await comments.create(alice, post.id, { body: 'r2', parentId: root.id });

    const roots = await comments.list(alice, post.id);
    expect(roots.items.map((c) => [c.body, c.replyCount])).toEqual([['gốc', 2]]);
    const replies = await comments.list(alice, post.id, { parentId: root.id });
    expect(replies.items.map((c) => c.body)).toEqual(['r1', 'r2']);
    expect((await posts.get(alice, post.id)).commentCount).toBe(3);
  });

  it('phân trang bình luận theo con trỏ', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    for (let i = 0; i < 3; i += 1) await comments.create(bob, post.id, { body: `c${i}` });
    const first = await comments.list(alice, post.id, { limit: 2 });
    expect(first.items.map((c) => c.body)).toEqual(['c0', 'c1']);
    const second = await comments.list(alice, post.id, { limit: 2, cursor: first.nextCursor });
    expect(second.items.map((c) => c.body)).toEqual(['c2']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('trả lời bình luận của bài khác bị từ chối', async () => {
    const { posts, comments } = setup();
    const p1 = await posts.create(alice, { bodyHtml: '<p>1</p>' });
    const p2 = await posts.create(alice, { bodyHtml: '<p>2</p>' });
    const root = await comments.create(bob, p1.id, { body: 'gốc' });
    await expectCode(comments.create(bob, p2.id, { body: 'lạc', parentId: root.id }), 'COMMENT_NOT_FOUND');
  });

  it('sửa và xoá: chỉ tác giả hoặc người kiểm duyệt; xoá mềm giữ chuỗi trả lời', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    const root = await comments.create(bob, post.id, { body: 'gốc' });
    await comments.create(alice, post.id, { body: 'trả lời', parentId: root.id });

    await expectCode(comments.update(alice, root.id, { body: 'sửa hộ' }), 'FORBIDDEN');
    await expectCode(comments.remove(alice, root.id), 'FORBIDDEN');
    expect((await comments.update(bob, root.id, { body: 'đã sửa' })).editedAt).toBeDefined();

    await comments.remove(moderator, root.id);
    const roots = await comments.list(alice, post.id);
    expect(roots.items).toHaveLength(1);
    expect(roots.items[0]).toMatchObject({ deleted: true, body: '', replyCount: 1 });
    await expectCode(comments.update(bob, root.id, { body: 'x' }), 'COMMENT_NOT_FOUND');
  });

  it('người chỉ đọc không bình luận được; bình luận rỗng bị từ chối', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    await expectCode(comments.create(readOnly, post.id, { body: 'x' }), 'FORBIDDEN');
    await expectCode(comments.create(bob, post.id, { body: '   ' }), 'VALIDATION');
  });
});

describe('xin lại URL từng phần của tệp nhiều phần', () => {
  const MB = 1024 * 1024;

  it('ký lại đúng phần với đúng cỡ; chỉ chủ tệp, chỉ khi chưa hoàn tất, số phần hợp lệ', async () => {
    const { attachments } = setup();
    const ticket = await attachments.initiate(alice, {
      fileName: 'v.webm',
      contentType: 'video/webm',
      sizeBytes: 20 * MB,
      purpose: 'comment',
    });
    const uploadId = ticket.multipart?.uploadId as string;
    expect(ticket.multipart?.parts.map((part) => part.sizeBytes)).toEqual([8 * MB, 8 * MB, 4 * MB]);

    const fresh = await attachments.refreshParts(alice, ticket.attachmentId, { uploadId, partNumbers: [3, 1] });
    expect(fresh.parts.map((part) => [part.partNumber, part.sizeBytes])).toEqual([
      [3, 4 * MB],
      [1, 8 * MB],
    ]);
    expect(fresh.parts.every((part) => part.url.length > 0)).toBe(true);

    await expectCode(attachments.refreshParts(bob, ticket.attachmentId, { uploadId, partNumbers: [1] }), 'ATTACHMENT_NOT_FOUND');
    await expectCode(attachments.refreshParts(alice, ticket.attachmentId, { uploadId, partNumbers: [4] }), 'VALIDATION');
    await expectCode(attachments.refreshParts(alice, ticket.attachmentId, { uploadId, partNumbers: [] }), 'VALIDATION');
    await expectCode(attachments.refreshParts(alice, ticket.attachmentId, { uploadId: '', partNumbers: [1] }), 'VALIDATION');
    await expectCode(
      attachments.refreshParts(alice, ticket.attachmentId, { uploadId, partNumbers: [1.5] }),
      'VALIDATION',
    );
  });

  it('tệp nhỏ không tải theo phần nên không ký lại được', async () => {
    const { attachments } = setup();
    const small = await attachments.initiate(alice, {
      fileName: 'a.png',
      contentType: 'image/png',
      sizeBytes: 1000,
      purpose: 'comment',
    });
    await expectCode(
      attachments.refreshParts(alice, small.attachmentId, { uploadId: 'x', partNumbers: [1] }),
      'VALIDATION',
    );
  });
});

describe('hạn mức dung lượng khi xin URL tải lên', () => {
  it('vượt hạn mức thì dừng trước khi tạo dòng và ký URL; còn chỗ thì cho qua', async () => {
    const store = new FakeStore();
    const storage = new FakeStorage();
    const asked: number[] = [];
    let exceeded = true;
    const quota: StorageQuotaPort = {
      async ensureCapacity(_tenantId, additionalBytes) {
        asked.push(additionalBytes);
        if (exceeded) throw new SocialStorageQuotaExceededError('Kho đã đầy.');
      },
    };
    const attachments = new SocialAttachmentService(store, storage, undefined, quota);
    const file = { fileName: 'a.png', contentType: 'image/png', sizeBytes: 1234, purpose: 'comment' as const };

    await expectCode(attachments.initiate(alice, file), 'STORAGE_QUOTA_EXCEEDED');
    expect(asked).toEqual([1234]);
    expect(store.attachments_.size).toBe(0);

    exceeded = false;
    const ok = await attachments.initiate(alice, file);
    expect(ok.attachmentId).toBeDefined();
    expect(store.attachments_.size).toBe(1);
  });
});

describe('tệp đính kèm của bình luận', () => {
  type Services = ReturnType<typeof setup>;

  /** Tải xong một tệp (initiate + upload giả + complete) và trả id. */
  async function uploadFile(
    services: Services,
    who: SocialActor,
    file: { fileName?: string; contentType?: string; sizeBytes?: number } = {},
    purpose: 'post' | 'comment' = 'comment',
  ): Promise<string> {
    const sizeBytes = file.sizeBytes ?? 100;
    const { attachmentId } = await services.attachments.initiate(who, {
      fileName: file.fileName ?? 'anh.png',
      contentType: file.contentType ?? 'image/png',
      sizeBytes,
      purpose,
    });
    services.storage.uploaded.set(await findKey(services.attachments, attachmentId), sizeBytes);
    await services.attachments.complete(who, attachmentId);
    return attachmentId;
  }

  it('initiate theo nơi gắn: bình luận chỉ nhận ảnh tối đa 10 MB, bài viết vẫn nhận PDF', async () => {
    const { attachments } = setup();
    const MB = 1024 * 1024;
    await expectCode(
      attachments.initiate(alice, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, purpose: 'comment' }),
      'VALIDATION',
    );
    await expectCode(
      attachments.initiate(alice, { fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 * MB + 1, purpose: 'comment' }),
      'VALIDATION',
    );
    await attachments.initiate(alice, { fileName: 'a.png', contentType: 'image/png', sizeBytes: 10 * MB, purpose: 'comment' });
    await attachments.initiate(alice, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 20 * MB });
    await expectCode(
      attachments.initiate(alice, { fileName: 'a.png', contentType: 'image/png', sizeBytes: 1, purpose: 'video' as never }),
      'VALIDATION',
    );
  });

  it('bình luận nhận video mp4/webm tới 50 MB, từ chối quá cỡ và kiểu khác', async () => {
    const { attachments } = setup();
    const MB = 1024 * 1024;
    await attachments.initiate(alice, { fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 50 * MB, purpose: 'comment' });
    await attachments.initiate(alice, { fileName: 'a.webm', contentType: 'video/webm', sizeBytes: 1, purpose: 'comment' });
    await expectCode(
      attachments.initiate(alice, { fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 50 * MB + 1, purpose: 'comment' }),
      'VALIDATION',
    );
    await expectCode(
      attachments.initiate(alice, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, purpose: 'comment' }),
      'VALIDATION',
    );
    await expectCode(
      attachments.initiate(alice, { fileName: 'a.mov', contentType: 'video/quicktime', sizeBytes: 10, purpose: 'comment' }),
      'VALIDATION',
    );
  });

  it('mỗi bình luận tối đa 1 video; video có isVideo và URL sống lâu hơn ảnh', async () => {
    const services = setup();
    const post = await services.posts.create(alice, { bodyHtml: '<p>x</p>' });
    const video = await uploadFile(services, bob, { fileName: 'v.mp4', contentType: 'video/mp4' });
    const video2 = await uploadFile(services, bob, { fileName: 'w.webm', contentType: 'video/webm' });
    const image = await uploadFile(services, bob);
    await expectCode(services.comments.create(bob, post.id, { body: 'x', attachmentIds: [video, video2] }), 'VALIDATION');

    services.storage.downloadTtls = [];
    const created = await services.comments.create(bob, post.id, { body: 'x', attachmentIds: [video, image] });
    const byId = new Map(created.attachments.map((file) => [file.id, file]));
    expect(byId.get(video)).toMatchObject({ isVideo: true, isImage: false });
    expect(byId.get(image)?.isVideo).toBeUndefined();
    expect(services.storage.downloadTtls).toEqual(expect.arrayContaining([3600, 300]));

    // Sửa để thêm video thứ hai cũng bị chặn.
    await expectCode(
      services.comments.update(bob, created.id, { body: 'x', attachmentIds: [video, image, video2] }),
      'VALIDATION',
    );
  });

  it('complete từ chối tệp giả kiểu: xoá object và dòng', async () => {
    const services = setup();
    const { attachmentId } = await services.attachments.initiate(bob, {
      fileName: 'gia.png',
      contentType: 'image/png',
      sizeBytes: 20,
      purpose: 'comment',
    });
    const key = await findKey(services.attachments, attachmentId);
    services.storage.uploaded.set(key, 20);
    services.storage.heads.set(key, new TextEncoder().encode('chỉ là chữ'));
    await expectCode(services.attachments.complete(bob, attachmentId), 'UPLOAD_MISMATCH');
    expect(services.storage.deleted).toContain(key);
    expect(await services.store.attachments.findById(TENANT, attachmentId)).toBeUndefined();
  });

  it('complete vẫn nhận ảnh cho bài viết và tệp không kiểm chữ ký (PDF)', async () => {
    const services = setup();
    const png = await uploadFile(services, bob, {}, 'post');
    const pdf = await uploadFile(services, bob, { fileName: 'a.pdf', contentType: 'application/pdf' }, 'post');
    expect(await services.store.attachments.findById(TENANT, png)).toMatchObject({ completed: true });
    expect(await services.store.attachments.findById(TENANT, pdf)).toMatchObject({ completed: true });
  });

  it('bình luận kèm ảnh hiện tệp có URL; chỉ có ảnh thì nội dung được để trống', async () => {
    const services = setup();
    const post = await services.posts.create(alice, { bodyHtml: '<p>x</p>' });
    const fileId = await uploadFile(services, bob);
    const created = await services.comments.create(bob, post.id, { body: '', attachmentIds: [fileId] });
    expect(created.attachments.map((file) => [file.id, file.isImage])).toEqual([[fileId, true]]);
    expect(created.attachments[0]?.url).toContain('https://storage.test/down/');
    const listed = (await services.comments.list(alice, post.id)).items[0];
    expect(listed?.attachments).toHaveLength(1);
    await expectCode(services.comments.create(bob, post.id, { body: '   ' }), 'VALIDATION');
  });

  it('từ chối tệp của người khác, chưa tải xong, không phải ảnh, quá 4 tệp hoặc đã gắn nơi khác', async () => {
    const services = setup();
    const post = await services.posts.create(alice, { bodyHtml: '<p>x</p>' });
    const mine = await uploadFile(services, bob);
    await expectCode(services.comments.create(alice, post.id, { body: 'x', attachmentIds: [mine] }), 'ATTACHMENT_UNAVAILABLE');

    const pending = (
      await services.attachments.initiate(bob, { fileName: 'b.png', contentType: 'image/png', sizeBytes: 5, purpose: 'comment' })
    ).attachmentId;
    await expectCode(services.comments.create(bob, post.id, { body: 'x', attachmentIds: [pending] }), 'ATTACHMENT_UNAVAILABLE');

    // PDF tải lên cho bài viết không gắn được vào bình luận.
    const pdf = await uploadFile(services, bob, { fileName: 'a.pdf', contentType: 'application/pdf' }, 'post');
    await expectCode(services.comments.create(bob, post.id, { body: 'x', attachmentIds: [pdf] }), 'ATTACHMENT_UNAVAILABLE');

    const five = await Promise.all([1, 2, 3, 4, 5].map(() => uploadFile(services, bob)));
    await expectCode(services.comments.create(bob, post.id, { body: 'x', attachmentIds: five }), 'VALIDATION');

    await services.comments.create(bob, post.id, { body: 'một', attachmentIds: [mine] });
    await expectCode(services.comments.create(bob, post.id, { body: 'hai', attachmentIds: [mine] }), 'ATTACHMENT_UNAVAILABLE');
  });

  it('sửa bình luận: thiếu attachmentIds là giữ nguyên, gỡ tệp thì xoá khỏi kho ngay', async () => {
    const services = setup();
    const post = await services.posts.create(alice, { bodyHtml: '<p>x</p>' });
    const first = await uploadFile(services, bob);
    const second = await uploadFile(services, bob);
    const created = await services.comments.create(bob, post.id, { body: 'a', attachmentIds: [first, second] });

    const kept = await services.comments.update(bob, created.id, { body: 'a sửa' });
    expect(kept.attachments).toHaveLength(2);

    const trimmed = await services.comments.update(bob, created.id, { body: 'a sửa', attachmentIds: [first] });
    expect(trimmed.attachments.map((file) => file.id)).toEqual([first]);
    expect(services.storage.deleted).toHaveLength(1);
    expect(await services.store.attachments.findById(TENANT, second)).toBeUndefined();

    // Gỡ hết tệp mà không còn chữ thì bình luận rỗng bị từ chối.
    await expectCode(services.comments.update(bob, created.id, { body: ' ', attachmentIds: [] }), 'VALIDATION');
  });

  it('xoá bình luận thì xoá ngay tệp trong kho; kho từ chối xoá thì giữ dòng cho job dọn thử lại', async () => {
    const services = setup();
    const post = await services.posts.create(alice, { bodyHtml: '<p>x</p>' });
    const fileId = await uploadFile(services, bob);
    const stuckId = await uploadFile(services, bob);
    const withFile = await services.comments.create(bob, post.id, { body: 'a', attachmentIds: [fileId] });
    await services.comments.remove(bob, withFile.id);
    expect(services.storage.deleted).toHaveLength(1);
    expect(await services.store.attachments.findById(TENANT, fileId)).toBeUndefined();

    const other = await services.comments.create(bob, post.id, { body: 'b', attachmentIds: [stuckId] });
    services.storage.failDelete.add(await findKey(services.attachments, stuckId));
    await services.comments.remove(bob, other.id);
    // Dòng còn lại, đã gỡ khỏi bình luận (mồ côi) để job dọn thử lại.
    const left = await services.store.attachments.findById(TENANT, stuckId);
    expect(left).toBeDefined();
    expect(left?.commentId).toBeUndefined();
  });

  it('bình luận đã xoá không lộ tệp; trang bình luận mặc định 10', async () => {
    const services = setup();
    const post = await services.posts.create(alice, { bodyHtml: '<p>x</p>' });
    for (let i = 0; i < 12; i += 1) await services.comments.create(bob, post.id, { body: `c${i}` });
    const page = await services.comments.list(alice, post.id);
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeDefined();
  });
});

describe('phản ứng trên bình luận', () => {
  it('đặt, đổi và bỏ phản ứng; số đếm và phản ứng của tôi hiện trong danh sách', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    const root = await comments.create(bob, post.id, { body: 'gốc' });
    expect(root.reactionTotal).toBe(0);

    expect(await comments.react(alice, root.id, { type: 'like' })).toEqual({
      reactionCounts: { like: 1 },
      reactionTotal: 1,
      myReaction: 'like',
    });
    const other = await comments.react(bob, root.id, { type: 'love' });
    expect(other.reactionTotal).toBe(2);

    // Đặt lại là đổi loại, không cộng thêm.
    const changed = await comments.react(alice, root.id, { type: 'love' });
    expect(changed.reactionCounts).toEqual({ love: 2 });

    const listed = (await comments.list(alice, post.id)).items[0];
    expect([listed?.reactionTotal, listed?.myReaction]).toEqual([2, 'love']);

    const cleared = await comments.react(alice, root.id, { type: null });
    expect([cleared.reactionTotal, cleared.myReaction]).toEqual([1, undefined]);
  });

  it('liệt kê người đã phản ứng kèm loại', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    const root = await comments.create(bob, post.id, { body: 'gốc' });
    await comments.react(alice, root.id, { type: 'like' });
    await comments.react(bob, root.id, { type: 'celebrate' });
    const { items } = await comments.reactors(alice, root.id);
    expect(items.map((item) => [item.user.id, item.type]).sort()).toEqual(
      [
        [ALICE, 'like'],
        [BOB, 'celebrate'],
      ].sort(),
    );
    await comments.remove(bob, root.id);
    await expectCode(comments.reactors(alice, root.id), 'COMMENT_NOT_FOUND');
  });

  it('từ chối loại không hợp lệ, người chỉ đọc và bình luận đã xoá', async () => {
    const { posts, comments } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>' });
    const root = await comments.create(bob, post.id, { body: 'gốc' });
    await expectCode(comments.react(alice, root.id, { type: 'wow' as never }), 'VALIDATION');
    await expectCode(comments.react(readOnly, root.id, { type: 'like' }), 'FORBIDDEN');
    await comments.remove(bob, root.id);
    await expectCode(comments.react(alice, root.id, { type: 'like' }), 'COMMENT_NOT_FOUND');
  });
});

describe('sự kiện outbox', () => {
  it('đăng bài phát postPublished kèm authorName và một mention cho mỗi người được nhắc (trừ tác giả)', async () => {
    const { posts, store } = setup();
    const post = await posts.create(alice, {
      title: 'Tin',
      bodyHtml: '<p>x</p>',
      mentionUserIds: [BOB, CAROL, ALICE],
    });
    const published = store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.postPublished);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      aggregateType: 'social-post',
      aggregateId: post.id,
      payload: {
        postId: post.id,
        authorId: ALICE,
        authorName: 'Alice Nguyễn',
        title: 'Tin',
        kind: 'post',
        mentionsAll: false,
        mentionedUserIds: [BOB, CAROL, ALICE],
        actorUserId: ALICE,
      },
    });
    const mentions = store.events.filter((e) => e.type === SOCIAL_EVENT_TYPES.mentioned);
    expect(mentions.map((e) => e.payload['mentionedUserId'])).toEqual([BOB, CAROL]);
    expect(mentions[0].payload).toMatchObject({ postId: post.id, authorName: 'Alice Nguyễn' });
  });

  it('bình luận phát commentCreated và mention theo token trong nội dung', async () => {
    const { posts, comments, store } = setup();
    const post = await posts.create(alice, { title: 'Tin', bodyHtml: '<p>x</p>' });
    const root = await comments.create(bob, post.id, { body: 'gốc' });
    store.events.length = 0;

    const reply = await comments.create(carol(), post.id, {
      body: `Chào @[${ALICE}]`,
      parentId: root.id,
    });
    expect(store.events.map((e) => e.type)).toEqual([
      SOCIAL_EVENT_TYPES.commentCreated,
      SOCIAL_EVENT_TYPES.mentioned,
    ]);
    expect(store.events[0].payload).toMatchObject({
      postId: post.id,
      commentId: reply.id,
      postAuthorId: ALICE,
      parentAuthorId: BOB,
      authorId: CAROL,
      authorName: 'Carol Lê',
      postTitle: 'Tin',
      mentionedUserIds: [ALICE],
    });
    expect(store.events[1]).toMatchObject({
      aggregateType: 'social-comment',
      aggregateId: reply.id,
      payload: { postId: post.id, commentId: reply.id, mentionedUserId: ALICE },
    });
  });

  it('sửa bài chỉ phát mention cho người mới được nhắc', async () => {
    const { posts, store } = setup();
    const post = await posts.create(alice, { bodyHtml: '<p>x</p>', mentionUserIds: [BOB] });
    store.events.length = 0;
    await posts.update(alice, post.id, { mentionUserIds: [BOB, CAROL] });
    expect(store.events.map((e) => e.payload['mentionedUserId'])).toEqual([CAROL]);
  });

  it('thao tác lỗi quyền thì không phát sự kiện nào', async () => {
    const { posts, store } = setup();
    await expect(posts.create(readOnly, { bodyHtml: '<p>x</p>' })).rejects.toBeInstanceOf(SocialForbiddenError);
    expect(store.events).toEqual([]);
  });
});

function carol(): SocialActor {
  return actor(CAROL);
}

async function uploadAndComplete(
  attachments: SocialAttachmentService,
  storage: FakeStorage,
  who: SocialActor,
  attachmentId: string,
  size: number,
): Promise<void> {
  // Kho giả: object xuất hiện đúng với khoá mà service đã sinh.
  storage.uploaded.set(await findKey(attachments, attachmentId), size);
  await attachments.complete(who, attachmentId);
}

async function findKey(attachments: SocialAttachmentService, attachmentId: string): Promise<string> {
  const store = (attachments as unknown as { store: FakeStore }).store;
  const row = await store.attachments.findById(TENANT, attachmentId);
  return (row as AttachmentRow).storageKey;
}

describe('tệp đính kèm', () => {
  it('initiate kiểm kiểu và cỡ rồi trả URL ký sẵn', async () => {
    const { attachments } = setup();
    const result = await attachments.initiate(alice, {
      fileName: 'Báo cáo.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(result.uploadUrl).toContain(`tenants/${TENANT}/social/${result.attachmentId}/Bao-cao.pdf`);
    expect(result.expiresInSeconds).toBe(300);
    await expectCode(
      attachments.initiate(alice, { fileName: 'x.exe', contentType: 'application/x-msdownload', sizeBytes: 1 }),
      'VALIDATION',
    );
    await expectCode(
      attachments.initiate(readOnly, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 }),
      'FORBIDDEN',
    );
  });

  it('complete: chưa tải lên hoặc sai cỡ thì lỗi; đúng thì hoàn tất; người khác không thấy', async () => {
    const { attachments, storage } = setup();
    const { attachmentId } = await attachments.initiate(alice, {
      fileName: 'a.png',
      contentType: 'image/png',
      sizeBytes: 50,
    });
    await expectCode(attachments.complete(alice, attachmentId), 'UPLOAD_MISMATCH');
    await expectCode(attachments.complete(bob, attachmentId), 'ATTACHMENT_NOT_FOUND');
    storage.uploaded.set(await findKey(attachments, attachmentId), 50);
    const done = await attachments.complete(alice, attachmentId);
    expect(done).toMatchObject({ fileName: 'a.png', isImage: true, sizeBytes: 50 });
    expect(done.url).toBeDefined();
  });

  it('complete: dung lượng sai thì xoá ngay object và dòng', async () => {
    const { attachments, storage, store } = setup();
    const { attachmentId } = await attachments.initiate(alice, {
      fileName: 'a.png',
      contentType: 'image/png',
      sizeBytes: 50,
    });
    const key = await findKey(attachments, attachmentId);
    storage.uploaded.set(key, 49);
    await expectCode(attachments.complete(alice, attachmentId), 'UPLOAD_MISMATCH');
    expect(storage.deleted).toEqual([key]);
    expect(store.attachments_.has(attachmentId)).toBe(false);
    await expectCode(attachments.complete(alice, attachmentId), 'ATTACHMENT_NOT_FOUND');
  });

  it('complete: dung lượng sai mà kho từ chối xoá thì giữ dòng cho job dọn', async () => {
    const { attachments, storage, store } = setup();
    const { attachmentId } = await attachments.initiate(alice, {
      fileName: 'a.png',
      contentType: 'image/png',
      sizeBytes: 50,
    });
    const key = await findKey(attachments, attachmentId);
    storage.uploaded.set(key, 51);
    storage.failDelete.add(key);
    await expectCode(attachments.complete(alice, attachmentId), 'UPLOAD_MISMATCH');
    expect(store.attachments_.has(attachmentId)).toBe(true);
  });

  it('initiate ghim độ dài URL tải lên theo dung lượng khai báo', async () => {
    const { attachments, storage } = setup();
    const { attachmentId } = await attachments.initiate(alice, {
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: 777,
    });
    expect(storage.pinnedSizes.get(await findKey(attachments, attachmentId))).toBe(777);
  });
});

describe('giới hạn tần suất tải lên', () => {
  const file = { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 };

  it('cửa sổ trượt: 30 lần mỗi phút mỗi người, hết cửa sổ thì dùng lại được', () => {
    let at = 1_000_000;
    const limiter = new UploadRateLimiter(() => at);
    for (let i = 0; i < 30; i += 1) {
      limiter.consume(TENANT, ALICE);
      at += 1000; // trải đều 30 giây
    }
    expect(() => limiter.consume(TENANT, ALICE)).toThrow(SocialRateLimitedError);
    // 1 giây sau lần đầu + 60 giây: chỉ lần đầu rời cửa sổ, nên đúng một chỗ trống.
    at = 1_000_000 + 60_000;
    limiter.consume(TENANT, ALICE);
    expect(() => limiter.consume(TENANT, ALICE)).toThrow(SocialRateLimitedError);
    at += 60_000;
    limiter.consume(TENANT, ALICE);
  });

  it('tính riêng từng người và từng tenant; 300 lần mỗi phút mỗi tenant', () => {
    const limiter = new UploadRateLimiter(() => 5000);
    for (let i = 0; i < 30; i += 1) limiter.consume(TENANT, ALICE);
    expect(() => limiter.consume(TENANT, ALICE)).toThrow(SocialRateLimitedError);
    limiter.consume(TENANT, BOB);
    limiter.consume('other-tenant', ALICE);

    const tenantLimiter = new UploadRateLimiter(() => 5000);
    for (let i = 0; i < 300; i += 1) tenantLimiter.consume(TENANT, `user-${i % 15}-${Math.floor(i / 15)}`);
    expect(() => tenantLimiter.consume(TENANT, 'someone-new')).toThrow(SocialRateLimitedError);
    tenantLimiter.consume('other-tenant', 'someone-new');
  });

  it('lần bị từ chối không làm dài thêm cửa sổ', () => {
    let at = 0;
    const limiter = new UploadRateLimiter(() => at, { windowMs: 1000, perUser: 1, perTenant: 10 });
    limiter.consume(TENANT, ALICE);
    at = 500;
    expect(() => limiter.consume(TENANT, ALICE)).toThrow(SocialRateLimitedError);
    at = 1000;
    limiter.consume(TENANT, ALICE);
  });

  it('initiate trả 429 SOCIAL_RATE_LIMITED khi vượt, kèm thông báo tiếng Việt', async () => {
    const { store, storage } = setup();
    const limiter = new UploadRateLimiter(() => 1, { windowMs: 60_000, perUser: 2, perTenant: 10 });
    const attachments = new SocialAttachmentService(store, storage, undefined, undefined, limiter);
    await attachments.initiate(alice, file);
    await attachments.initiate(alice, file);
    const error = await attachments.initiate(alice, file).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SocialRateLimitedError);
    expect(error).toMatchObject({
      code: 'SOCIAL_RATE_LIMITED',
      statusCode: 429,
      message: 'Bạn tải lên quá nhanh. Hãy thử lại sau ít giây.',
    });
    await attachments.initiate(bob, file);
  });

  it('quá 20 lần tải dang dở thì 429 SOCIAL_TOO_MANY_PENDING_UPLOADS; tệp hoàn tất không tính', async () => {
    const { store, storage } = setup();
    const limiter = new UploadRateLimiter(() => 1, { windowMs: 60_000, perUser: 1000, perTenant: 1000 });
    const attachments = new SocialAttachmentService(store, storage, undefined, undefined, limiter);
    const first = await attachments.initiate(alice, file);
    for (let i = 1; i < 20; i += 1) await attachments.initiate(alice, file);
    await expectCode(attachments.initiate(alice, file), 'SOCIAL_TOO_MANY_PENDING_UPLOADS');
    await attachments.initiate(bob, file);

    await uploadAndComplete(attachments, storage, alice, first.attachmentId, 1);
    await attachments.initiate(alice, file);
  });
});

describe('tải nhiều phần', () => {
  const MB = 1024 * 1024;
  const video = { fileName: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 20 * MB, purpose: 'comment' as const };

  it('tệp tới ngưỡng 10 MB vẫn tải một lệnh PUT; lớn hơn thì chia phần 8 MB, phần cuối còn lại', async () => {
    const { attachments, storage } = setup();
    const small = await attachments.initiate(alice, { ...video, sizeBytes: 10 * MB });
    expect(small.multipart).toBeUndefined();
    expect(small.uploadUrl).not.toBe('');

    const big = await attachments.initiate(alice, video);
    expect(big.uploadUrl).toBe('');
    expect(big.multipart?.uploadId).toBeDefined();
    expect(big.multipart?.parts.map((p) => [p.partNumber, p.sizeBytes])).toEqual([
      [1, 8 * MB],
      [2, 8 * MB],
      [3, 4 * MB],
    ]);
    expect(big.multipart?.parts[2].url).toContain(`len=${4 * MB}`);
    expect(storage.multipart.size).toBe(1);
  });

  it('complete: bắt buộc uploadId; thiếu phần hoặc sai cỡ thì lỗi và giữ nguyên để tải lại', async () => {
    const { attachments, storage, store } = setup();
    const { attachmentId, multipart } = await attachments.initiate(alice, video);
    const uploadId = multipart?.uploadId as string;

    await expectCode(attachments.complete(alice, attachmentId), 'VALIDATION');
    await expectCode(attachments.complete(alice, attachmentId, { uploadId }), 'UPLOAD_MISMATCH');

    storage.putPart(uploadId, 1, 8 * MB);
    storage.putPart(uploadId, 2, 8 * MB);
    await expectCode(attachments.complete(alice, attachmentId, { uploadId }), 'UPLOAD_MISMATCH'); // thiếu phần 3

    storage.putPart(uploadId, 3, 3 * MB);
    await expectCode(attachments.complete(alice, attachmentId, { uploadId }), 'UPLOAD_MISMATCH'); // phần 3 sai cỡ
    expect(store.attachments_.has(attachmentId)).toBe(true);
    expect(storage.deleted).toEqual([]);
    expect(storage.completedMultipart).toEqual([]);

    storage.putPart(uploadId, 3, 4 * MB);
    const done = await attachments.complete(alice, attachmentId, { uploadId });
    expect(done).toMatchObject({ fileName: 'clip.mp4', sizeBytes: 20 * MB });
    expect(storage.completedMultipart).toEqual([uploadId]);
  });

  it('complete: uploadId của phiên khác thì không ghép được', async () => {
    const { attachments, storage } = setup();
    const a = await attachments.initiate(alice, video);
    const b = await attachments.initiate(alice, video);
    for (const part of [1, 2]) storage.putPart(b.multipart?.uploadId as string, part, 8 * MB);
    storage.putPart(b.multipart?.uploadId as string, 3, 4 * MB);
    await expectCode(
      attachments.complete(alice, a.attachmentId, { uploadId: b.multipart?.uploadId }),
      'UPLOAD_MISMATCH',
    );
  });

  it('complete gọi lại sau khi kho đã ghép xong (mất kết nối) vẫn hoàn tất được', async () => {
    const { attachments, storage } = setup();
    const { attachmentId, multipart } = await attachments.initiate(alice, video);
    const uploadId = multipart?.uploadId as string;
    storage.putPart(uploadId, 1, 8 * MB);
    storage.putPart(uploadId, 2, 8 * MB);
    storage.putPart(uploadId, 3, 4 * MB);
    // Lần 1: kho ghép xong nhưng dòng chưa được đánh dấu.
    await storage.completeMultipartUpload(await findKey(attachments, attachmentId), uploadId, [
      { partNumber: 1 },
      { partNumber: 2 },
      { partNumber: 3 },
    ]);
    const done = await attachments.complete(alice, attachmentId, { uploadId });
    expect(done.sizeBytes).toBe(20 * MB);
  });

  it('abort: chỉ chủ tệp, huỷ phiên nhiều phần, xoá object và dòng; gọi lại thì coi như xong', async () => {
    const { attachments, storage, store } = setup();
    const { attachmentId, multipart } = await attachments.initiate(alice, video);
    const uploadId = multipart?.uploadId as string;
    const key = await findKey(attachments, attachmentId);

    await expectCode(attachments.abort(bob, attachmentId, { uploadId }), 'ATTACHMENT_NOT_FOUND');
    expect(store.attachments_.has(attachmentId)).toBe(true);

    await attachments.abort(alice, attachmentId, { uploadId });
    expect(storage.aborted).toEqual([uploadId]);
    expect(storage.deleted).toEqual([key]);
    expect(store.attachments_.has(attachmentId)).toBe(false);

    await attachments.abort(alice, attachmentId, { uploadId });
    await attachments.abort(bob, attachmentId);
  });

  it('abort: tệp một lệnh PUT không cần uploadId; tệp đã hoàn tất thì không huỷ được', async () => {
    const { attachments, storage, store } = setup();
    const pending = await attachments.initiate(alice, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 5 });
    await attachments.abort(alice, pending.attachmentId);
    expect(store.attachments_.has(pending.attachmentId)).toBe(false);
    expect(storage.aborted).toEqual([]);

    const done = await attachments.initiate(alice, { fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 5 });
    await uploadAndComplete(attachments, storage, alice, done.attachmentId, 5);
    await expectCode(attachments.abort(alice, done.attachmentId), 'ATTACHMENT_ALREADY_COMPLETED');
    expect(store.attachments_.has(done.attachmentId)).toBe(true);
  });

  it('abort: kho không huỷ được phiên thì báo lỗi và giữ dòng để thử lại', async () => {
    const { attachments, storage, store } = setup();
    const { attachmentId, multipart } = await attachments.initiate(alice, video);
    storage.failAbortMultipart = true;
    await expect(attachments.abort(alice, attachmentId, { uploadId: multipart?.uploadId })).rejects.toThrow('S3 down');
    expect(store.attachments_.has(attachmentId)).toBe(true);
  });

  it('dọn tệp mồ côi: xoá object và dòng; object bị kho từ chối thì giữ dòng', async () => {
    const { attachments, storage, store } = setup();
    const a = await attachments.initiate(alice, { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    const b = await attachments.initiate(alice, { fileName: 'b.pdf', contentType: 'application/pdf', sizeBytes: 1 });
    const stuckKey = await findKey(attachments, b.attachmentId);
    const keyA = await findKey(attachments, a.attachmentId);
    storage.failDelete.add(stuckKey);

    expect(await attachments.cleanupOrphans(TENANT)).toBe(1);
    expect(storage.deleted).toEqual([keyA]);
    expect(store.attachments_.has(a.attachmentId)).toBe(false);
    expect(store.attachments_.has(b.attachmentId)).toBe(true);
  });
});

describe('chuyên mục', () => {
  it('chỉ người có social.manage mới tạo và sửa; tên trùng bị từ chối', async () => {
    const { topics } = setup();
    const manager = actor(ALICE, { canManage: true });
    await expectCode(topics.create(alice, { name: 'Tin' }), 'FORBIDDEN');
    const topic = await topics.create(manager, { name: 'Tin tức' });
    await expectCode(topics.create(manager, { name: 'tin TỨC' }), 'TOPIC_NAME_TAKEN');
    expect((await topics.update(manager, topic.id, { name: 'Tin nội bộ' })).name).toBe('Tin nội bộ');
    await expectCode(topics.update(alice, topic.id, { name: 'x' }), 'FORBIDDEN');
  });

  it('người thường chỉ thấy chuyên mục đang dùng, kèm số bài', async () => {
    const { topics, posts } = setup();
    const manager = actor(ALICE, { canManage: true });
    const live = await topics.create(manager, { name: 'Đang dùng' });
    const dead = await topics.create(manager, { name: 'Ngừng' });
    await topics.update(manager, dead.id, { isActive: false });
    await posts.create(alice, { bodyHtml: '<p>x</p>', topicId: live.id });

    expect((await topics.list(bob)).items).toEqual([{ id: live.id, name: 'Đang dùng', isActive: true, postCount: 1 }]);
    expect((await topics.list(manager)).items).toHaveLength(2);
  });
});

describe('me và gợi ý người', () => {
  it('me trả người dùng theo danh bạ và các quyền đang có', async () => {
    const { me } = setup();
    const result = await me.me(moderator);
    expect(result.user.name).toBe('Carol Lê');
    expect(result.permissions).toEqual(['social.read', 'social.post.write', 'social.post.moderate']);
  });

  it('people: truy vấn rỗng trả rỗng, người chỉ đọc bị từ chối', async () => {
    const { me } = setup();
    expect((await me.people(alice, '  ')).items).toEqual([]);
    expect((await me.people(alice, 'bob')).items.map((u) => u.id)).toEqual([BOB]);
    await expectCode(me.people(readOnly, 'bob'), 'FORBIDDEN');
  });
});
