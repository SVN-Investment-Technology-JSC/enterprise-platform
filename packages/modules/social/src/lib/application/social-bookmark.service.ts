import {
  SOCIAL_BOOKMARK_FOLDERS_MAX,
  SOCIAL_BOOKMARK_FOLDER_NAME_MAX,
  type CreateSocialBookmarkFolderRequest,
  type SetSocialBookmarkRequest,
  type SocialBookmarkFolder,
  type SocialBookmarkFolderList,
  type SocialBookmarkState,
  type SocialFeedPage,
} from '@enterprise-platform/contracts-social';
import { decodeCursor, encodeCursor, isUuid, normalizeLimit } from '../domain/social-rules.js';
import { SocialBookmarkFolderNotFoundError, SocialValidationError } from '../domain/social.error.js';
import type { PostViewAssembler } from './ports/post-view-assembler.port.js';
import type { PostVisibilityPort } from './ports/post-visibility.port.js';
import type { SocialActor } from './social-actor.js';
import type { SocialPostAccess } from './social-post-access.js';
import type { SocialPublishingStore } from './social-publishing-store.port.js';

export interface SocialBookmarkDeps {
  readonly store: SocialPublishingStore;
  readonly access: SocialPostAccess;
  readonly visibility: PostVisibilityPort;
  readonly assembler: PostViewAssembler;
}

/** Bài đã lưu: lưu/bỏ lưu bài thấy được; danh sách lưu gần nhất trước, bài không còn thấy được bị bỏ. */
export class SocialBookmarkService {
  constructor(private readonly deps: SocialBookmarkDeps) {}

  async set(actor: SocialActor, postId: string, request: SetSocialBookmarkRequest): Promise<SocialBookmarkState> {
    if (typeof request?.bookmarked !== 'boolean') throw new SocialValidationError('Thiếu trạng thái lưu bài.');
    await this.deps.access.requirePublished(actor, postId);
    const folderId = request.bookmarked ? await this.resolveFolder(actor, request.folderId) : undefined;
    await this.deps.store.setBookmark(actor.tenantId, postId, actor.userId, request.bookmarked, folderId);
    return { bookmarked: request.bookmarked, ...(folderId ? { folderId } : {}) };
  }

  /** `undefined` giữ thư mục cũ, `null` về chưa phân loại; thư mục không phải của người dùng thì báo không tồn tại. */
  private async resolveFolder(actor: SocialActor, folderId: string | null | undefined): Promise<string | null | undefined> {
    if (folderId === undefined || folderId === null) return folderId;
    if (!isUuid(folderId) || !(await this.deps.store.bookmarkFolderExists(actor.tenantId, actor.userId, folderId))) {
      throw new SocialBookmarkFolderNotFoundError();
    }
    return folderId.toLowerCase();
  }

  async listFolders(actor: SocialActor): Promise<SocialBookmarkFolderList> {
    const { folders, unfiledCount } = await this.deps.store.listBookmarkFolders(actor.tenantId, actor.userId);
    const sorted = [...folders].sort(
      (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id),
    );
    return {
      items: sorted,
      unfiledCount,
      total: sorted.reduce((sum, folder) => sum + folder.count, unfiledCount),
    };
  }

  async createFolder(actor: SocialActor, request: CreateSocialBookmarkFolderRequest): Promise<SocialBookmarkFolder> {
    const name = typeof request?.name === 'string' ? request.name.trim() : '';
    if (!name) throw new SocialValidationError('Vui lòng nhập tên thư mục.');
    if (name.length > SOCIAL_BOOKMARK_FOLDER_NAME_MAX) {
      throw new SocialValidationError(`Tên thư mục tối đa ${SOCIAL_BOOKMARK_FOLDER_NAME_MAX} ký tự.`);
    }
    const { folders } = await this.deps.store.listBookmarkFolders(actor.tenantId, actor.userId);
    const existing = folders.find((folder) => folder.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    if (folders.length >= SOCIAL_BOOKMARK_FOLDERS_MAX) {
      throw new SocialValidationError(`Mỗi người chỉ tạo tối đa ${SOCIAL_BOOKMARK_FOLDERS_MAX} thư mục đã lưu.`);
    }
    return this.deps.store.createBookmarkFolder(actor.tenantId, actor.userId, name);
  }

  async list(
    actor: SocialActor,
    query: { cursor?: string; limit?: number | string; folderId?: string } = {},
  ): Promise<SocialFeedPage> {
    const folderId = query.folderId?.trim() ? query.folderId.trim().toLowerCase() : undefined;
    if (folderId !== undefined && folderId !== 'none' && !isUuid(folderId)) {
      throw new SocialValidationError('Thư mục đã lưu không hợp lệ.');
    }
    const limit = normalizeLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const scope = await this.deps.visibility.scopeFor(actor);
    const rows = await this.deps.store.listBookmarks(actor.tenantId, actor.userId, scope, {
      limit: limit + 1,
      cursor,
      ...(folderId ? { folderId } : {}),
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: await this.deps.assembler.assemble(
        actor,
        page.map((entry) => entry.post),
      ),
      ...(hasMore && last ? { nextCursor: encodeCursor({ at: last.bookmarkedAt, id: last.post.id }) } : {}),
    };
  }
}
