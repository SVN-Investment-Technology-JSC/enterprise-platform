import type { ChatReaction } from '@enterprise-platform/contracts-chat';
import { Angry, Frown, Heart, Laugh, Sparkles, ThumbsUp, type LucideIcon } from 'lucide-react';

/** Cảm xúc thả vào tin vẽ bằng icon SVG (không dùng emoji), cùng cách với Mạng nội bộ. */
export const REACTION_ICONS: Readonly<Record<ChatReaction, LucideIcon>> = {
  like: ThumbsUp,
  love: Heart,
  haha: Laugh,
  wow: Sparkles,
  sad: Frown,
  angry: Angry,
};
