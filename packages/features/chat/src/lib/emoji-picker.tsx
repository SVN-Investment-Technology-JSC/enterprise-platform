'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './chat.module.scss';
import { EMOJI_CATEGORIES, emojiOf, recentEmoji, rememberEmoji } from './emoji-palette';

/** Bảng chọn biểu tượng cảm xúc để chèn vào tin; nhớ các biểu tượng vừa dùng. */
export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const recent = recentEmoji();
  const [tab, setTab] = useState(recent.length > 0 ? 'recent' : EMOJI_CATEGORIES[0].id);
  const ref = useRef<HTMLDivElement>(null);
  const codePoints = tab === 'recent' ? recent : (EMOJI_CATEGORIES.find((category) => category.id === tab)?.codePoints ?? []);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`${styles.popover} ${styles.emojiPanel}`} role="dialog" aria-label="Chọn biểu tượng cảm xúc">
      <div className={styles.emojiTabs} role="tablist">
        {recent.length > 0 ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'recent'}
            className={tab === 'recent' ? `${styles.emojiTab} ${styles.emojiTabActive}` : styles.emojiTab}
            onClick={() => setTab('recent')}
          >
            Gần đây
          </button>
        ) : null}
        {EMOJI_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={tab === category.id}
            className={tab === category.id ? `${styles.emojiTab} ${styles.emojiTabActive}` : styles.emojiTab}
            onClick={() => setTab(category.id)}
          >
            {category.label}
          </button>
        ))}
      </div>
      <div className={styles.emojiGrid}>
        {codePoints.map((codePoint) => (
          <button
            key={codePoint}
            type="button"
            className={styles.emojiCell}
            onClick={() => {
              rememberEmoji(codePoint);
              onPick(emojiOf(codePoint));
            }}
          >
            {emojiOf(codePoint)}
          </button>
        ))}
      </div>
    </div>
  );
}
