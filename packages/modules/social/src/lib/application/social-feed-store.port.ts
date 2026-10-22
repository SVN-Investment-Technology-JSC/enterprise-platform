import type { SocialFeedSource, SocialPostKind } from '@enterprise-platform/contracts-social';
import type { ExtendedPostRow } from './ports/post-read-model.js';
import type { PostVisibilityScope } from './ports/post-visibility.port.js';

/** Token DI của store bảng tin P2. */
export const SOCIAL_FEED_STORE = Symbol('SOCIAL_FEED_STORE');

export interface FeedRead {
  /** Luật nhìn thấy của người xem; store AND mệnh đề `postVisibilitySql`. */
  readonly visibility: PostVisibilityScope;
  readonly source: SocialFeedSource;
  /** Có `groupId` thì bỏ qua `source`. */
  readonly groupId?: string;
  readonly topicId?: string;
  /** `post` gồm cả bài tự sinh (kind `activity` trong DB). */
  readonly kind?: SocialPostKind;
  readonly authorId?: string;
  /** Đợt 2: chủ đề của nhóm; chỉ có nghĩa khi có `groupId`. */
  readonly groupTopicId?: string;
}

export interface FeedPageRead extends FeedRead {
  readonly limit: number;
  readonly cursor?: { readonly at: string; readonly id: string };
}

/**
 * Truy vấn đọc bảng tin P2 (bài đã đăng). Trả `ExtendedPostRow`; `SocialPost` do
 * `PostViewAssembler` dựng. Không trả bài `pending|scheduled|rejected` (chúng có đường đọc riêng).
 */
export interface SocialFeedStore {
  /** Bài ghim (đã đăng, thấy được), mới nhất trước; tối đa `limit`. */
  pinned(tenantId: string, read: FeedRead, limit: number): Promise<ExtendedPostRow[]>;
  /** Bài đã đăng, không ghim, `(publishedAt, id)` giảm dần; tối đa `read.limit` dòng. */
  page(tenantId: string, read: FeedPageRead): Promise<ExtendedPostRow[]>;
}
