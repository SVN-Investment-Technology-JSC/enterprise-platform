export const EMOJI_RECENT_LIMIT = 16;
const RECENT_KEY = 'social.emoji.recent';
const SKIN_KEY = 'social.emoji.skin-tone';

const SKIN_TONES = ['none', 'light', 'medium-light', 'medium', 'medium-dark', 'dark'] as const;
export type EmojiSkinTone = (typeof SKIN_TONES)[number];

/** Đưa `emoji` lên đầu danh sách gần đây, bỏ bản trùng và cắt theo giới hạn. */
export function pushRecentEmoji(list: readonly string[], emoji: string, limit = EMOJI_RECENT_LIMIT): string[] {
  return [emoji, ...list.filter((item) => item !== emoji)].slice(0, limit);
}

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadRecentEmojis(): string[] {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(RECENT_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, EMOJI_RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function saveRecentEmojis(list: readonly string[]): void {
  try {
    storage()?.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Trình duyệt chặn lưu trữ cục bộ: bỏ qua, danh sách chỉ sống trong phiên.
  }
}

export function loadSkinTone(): EmojiSkinTone {
  const value = storage()?.getItem(SKIN_KEY);
  return SKIN_TONES.find((tone) => tone === value) ?? 'none';
}

export function saveSkinTone(tone: EmojiSkinTone): void {
  try {
    storage()?.setItem(SKIN_KEY, tone);
  } catch {
    // Như trên.
  }
}
