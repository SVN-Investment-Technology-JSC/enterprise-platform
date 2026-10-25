import type { SocialPost, SocialReactionSummary } from '@enterprise-platform/contracts-social';

/**
 * Áp kết quả thả hoặc bỏ phản ứng vào bài. Khi bỏ phản ứng, server trả tóm tắt KHÔNG có `myReaction` (JSON bỏ khoá
 * vắng), nên gộp bằng `{ ...post, ...summary }` sẽ giữ lại `myReaction` cũ và nút vẫn hiện là đã thả. Vì vậy `myReaction`
 * luôn được đặt tường minh từ tóm tắt, kể cả khi vắng.
 */
export function applyReactionSummary(post: SocialPost, summary: SocialReactionSummary): SocialPost {
  return {
    ...post,
    reactionCounts: summary.reactionCounts,
    reactionTotal: summary.reactionTotal,
    myReaction: summary.myReaction,
  };
}
