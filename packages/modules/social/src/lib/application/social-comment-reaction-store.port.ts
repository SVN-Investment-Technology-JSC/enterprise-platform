import type { SocialReactionType } from '@enterprise-platform/contracts-social';
import type { ReactionSummaryRow, ReactorRow } from './social-store.port.js';

/** Token DI của store phản ứng trên bình luận. */
export const SOCIAL_COMMENT_REACTION_STORE = Symbol('SOCIAL_COMMENT_REACTION_STORE');

/** Phản ứng trên bình luận: mỗi người một phản ứng cho mỗi bình luận. */
export interface SocialCommentReactionStore {
  set(tenantId: string, commentId: string, userId: string, type: SocialReactionType): Promise<void>;
  remove(tenantId: string, commentId: string, userId: string): Promise<void>;
  /** Người đã phản ứng, mới nhất trước; tối đa `limit`. */
  list(tenantId: string, commentId: string, limit: number): Promise<ReactorRow[]>;
  /** Số phản ứng theo loại và phản ứng của `viewerId`, cho mọi bình luận trong `commentIds`. */
  summaries(
    tenantId: string,
    commentIds: readonly string[],
    viewerId: string,
  ): Promise<ReadonlyMap<string, ReactionSummaryRow>>;
}
