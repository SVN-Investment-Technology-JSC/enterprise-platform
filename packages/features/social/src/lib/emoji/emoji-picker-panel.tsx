'use client';

import { defaultEmojiDataResolver, EmojiPicker, type EmojiDataResolver } from 'frimousse';
import { Flag, Hand, Hash, Lightbulb, PawPrint, Plane, Smile, Trophy, Utensils } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { SOCIAL_BASE_PATH } from '../social.model';
import { categoryScrollTop } from './emoji-position';
import { loadRecentEmojis, loadSkinTone, pushRecentEmoji, saveRecentEmojis, saveSkinTone, type EmojiSkinTone } from './emoji-preferences';
import styles from './emoji-picker.module.scss';

const COLUMNS = 9;
const EMOJIBASE_URL = `${SOCIAL_BASE_PATH}/emoji-data`;
const COMPONENT_GROUP = 2;

/** Biểu tượng cho tab, theo chỉ số nhóm của emojibase. */
const GROUP_ICONS: Record<number, ComponentType<{ size?: number }>> = {
  0: Smile,
  1: Hand,
  3: PawPrint,
  4: Utensils,
  5: Plane,
  6: Trophy,
  7: Lightbulb,
  8: Hash,
  9: Flag,
};

interface JumpTarget {
  readonly group: number;
  readonly label: string;
  readonly rowsBefore: number;
  readonly position: number;
}

export interface EmojiPickerPanelProps {
  readonly onPick: (emoji: string) => void;
}

/** Hộp chọn emoji: ô tìm kiếm, tab danh mục, dòng "gần đây", chọn tông da, danh sách ảo hoá của frimousse. */
export function EmojiPickerPanel({ onPick }: EmojiPickerPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [tone, setTone] = useState<EmojiSkinTone>('none');
  const [recents, setRecents] = useState<string[]>([]);
  const [targets, setTargets] = useState<readonly JumpTarget[]>([]);
  const [activeGroup, setActiveGroup] = useState<number | undefined>(undefined);

  // Đọc lưu trữ cục bộ sau khi dựng để HTML ban đầu giống phía server.
  useEffect(() => {
    setTone(loadSkinTone());
    setRecents(loadRecentEmojis());
  }, []);

  // Bọc bộ nạp mặc định chỉ để biết mỗi danh mục có bao nhiêu emoji (tính vị trí nhảy của tab).
  const resolveEmojiData = useCallback<EmojiDataResolver>(async (locale, options) => {
    const data = await defaultEmojiDataResolver(locale, options);
    const counts = new Map<number, number>();
    for (const emoji of data.emojis) counts.set(emoji.category, (counts.get(emoji.category) ?? 0) + 1);
    let rows = 0;
    const next: JumpTarget[] = [];
    for (const category of data.categories) {
      const count = counts.get(category.index) ?? 0;
      if (category.index === COMPONENT_GROUP || count === 0) continue;
      next.push({ group: category.index, label: category.label, rowsBefore: rows, position: next.length });
      rows += Math.ceil(count / COLUMNS);
    }
    setTargets(next);
    return data;
  }, []);

  const choose = useCallback(
    (emoji: string) => {
      setRecents((list) => {
        const next = pushRecentEmoji(list, emoji);
        saveRecentEmojis(next);
        return next;
      });
      onPick(emoji);
    },
    [onPick],
  );

  const measure = () => {
    const root = rootRef.current;
    if (!root) return undefined;
    const row = parseFloat(root.style.getPropertyValue('--frimousse-row-height'));
    const header = parseFloat(root.style.getPropertyValue('--frimousse-category-header-height'));
    return Number.isFinite(row) && Number.isFinite(header) ? { row, header } : undefined;
  };

  const jump = (target: JumpTarget) => {
    const sizes = measure();
    const viewport = viewportRef.current;
    if (!sizes || !viewport) return;
    viewport.scrollTop = categoryScrollTop(target.position, target.rowsBefore, sizes.row, sizes.header);
    setActiveGroup(target.group);
  };

  // Tab đang sáng theo vị trí cuộn. `frimousse` giữ `onScroll` của nó nên nghe trực tiếp trên phần tử.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || targets.length === 0) return;
    const onScroll = () => {
      const sizes = measure();
      if (!sizes) return;
      let current = targets[0];
      const atEnd = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 1;
      for (const target of targets) {
        if (categoryScrollTop(target.position, target.rowsBefore, sizes.row, sizes.header) <= viewport.scrollTop + 1) current = target;
      }
      // Cuối danh sách: danh mục cuối không thể cuộn tới đỉnh nên coi như đang ở đó.
      if (atEnd) current = targets[targets.length - 1];
      setActiveGroup(current.group);
    };
    onScroll();
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [targets]);

  const searching = query.trim().length > 0;
  const tabs = useMemo(() => targets.filter((target) => GROUP_ICONS[target.group]), [targets]);

  return (
    <EmojiPicker.Root
      ref={rootRef}
      className={styles.root}
      columns={COLUMNS}
      locale="vi"
      emojibaseUrl={EMOJIBASE_URL}
      resolveEmojiData={resolveEmojiData}
      skinTone={tone}
      onEmojiSelect={({ emoji }) => choose(emoji)}
    >
      <div className={styles.searchBar}>
        <EmojiPicker.Search
          className={styles.search}
          placeholder="Tìm biểu tượng cảm xúc"
          aria-label="Tìm biểu tượng cảm xúc"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <EmojiPicker.SkinTone>
          {({ skinTone, setSkinTone, skinToneVariations }) => {
            const index = Math.max(
              skinToneVariations.findIndex((item) => item.skinTone === skinTone),
              0,
            );
            return (
              <button
                type="button"
                className={styles.tone}
                aria-label="Đổi tông màu da"
                title="Đổi tông màu da"
                onClick={() => {
                  const next = skinToneVariations[(index + 1) % skinToneVariations.length];
                  if (!next) return;
                  setSkinTone(next.skinTone);
                  setTone(next.skinTone as EmojiSkinTone);
                  saveSkinTone(next.skinTone as EmojiSkinTone);
                }}
              >
                {skinToneVariations[index]?.emoji}
              </button>
            );
          }}
        </EmojiPicker.SkinTone>
      </div>
      {!searching && tabs.length > 0 ? (
        <div className={styles.tabs} role="tablist" aria-label="Danh mục biểu tượng cảm xúc">
          {tabs.map((target) => {
            const Icon = GROUP_ICONS[target.group];
            return (
              <button
                key={target.group}
                type="button"
                role="tab"
                className={styles.tab}
                aria-selected={activeGroup === target.group}
                aria-label={target.label}
                title={target.label}
                onClick={() => jump(target)}
              >
                <Icon size={16} />
              </button>
            );
          })}
        </div>
      ) : null}
      {!searching && recents.length > 0 ? (
        <div className={styles.recents} role="group" aria-label="Dùng gần đây">
          {recents.map((emoji) => (
            <button key={emoji} type="button" className={styles.recent} aria-label={emoji} onClick={() => choose(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <EmojiPicker.Viewport ref={viewportRef} className={styles.viewport}>
        <EmojiPicker.Loading className={styles.note}>Đang tải…</EmojiPicker.Loading>
        <EmojiPicker.Empty className={styles.note}>Không tìm thấy biểu tượng nào.</EmojiPicker.Empty>
        <EmojiPicker.List
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div {...props} className={styles.categoryHeader}>
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div {...props} className={styles.row}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button {...props} className={styles.emoji}>
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}
