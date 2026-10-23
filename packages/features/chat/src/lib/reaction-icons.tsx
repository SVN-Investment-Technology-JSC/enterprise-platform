import type { ChatReaction } from '@enterprise-platform/contracts-chat';
import { Angry, Frown, Heart, Laugh, Sparkles, ThumbsUp, type LucideIcon } from 'lucide-react';

/** Cảm xúc dạng khối (tim, like) tô đặc như Zalo; mặt cười giữ nét để còn thấy mắt, miệng. */
export const FILLED_REACTIONS: ReadonlySet<ChatReaction> = new Set(['like', 'love']);

/** Cảm xúc thả nhanh: bấm nút tim cạnh tin hoặc bấm đúp vào tin. */
export const QUICK_REACTION: ChatReaction = 'love';

/** Cảm xúc thả vào tin vẽ bằng icon SVG (không dùng emoji), cùng cách với Mạng nội bộ. */
export const REACTION_ICONS: Readonly<Record<ChatReaction, LucideIcon>> = {
  like: ThumbsUp,
  love: Heart,
  haha: Laugh,
  wow: Sparkles,
  sad: Frown,
  angry: Angry,
};
