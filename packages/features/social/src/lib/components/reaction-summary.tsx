'use client';

import { SOCIAL_REACTION_TYPES, type SocialReactionType, type SocialReactor } from '@enterprise-platform/contracts-social';
import { useState } from 'react';
import styles from '../social.module.scss';
import { ReactionIcon } from './reaction-icon';
import { ReactorsDialog } from './reactors-dialog';

/**
 * Tổng số phản ứng của một bài hoặc bình luận: chồng tối đa 3 loại nhiều nhất cùng tổng số; bấm để xem hộp
 * "Người đã bày tỏ phản ứng". Dùng chung cho bài viết và bình luận (chỉ khác dữ liệu và hàm tải người thả).
 */
export function ReactionSummary({
  counts,
  total,
  load,
  iconSize = 18,
  className,
}: {
  readonly counts: Partial<Record<SocialReactionType, number>>;
  readonly total: number;
  readonly load: () => Promise<readonly SocialReactor[]>;
  readonly iconSize?: number;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (total <= 0) return null;

  const top = SOCIAL_REACTION_TYPES.filter((type) => (counts[type] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
    .slice(0, 3);

  return (
    <>
      <button
        type="button"
        className={[styles.reactionSummary, className].filter(Boolean).join(' ')}
        aria-label={`${total.toLocaleString('vi-VN')} phản ứng, bấm để xem người đã bày tỏ`}
        onClick={() => setOpen(true)}
      >
        <span className={styles.reactionIcons}>
          {top.map((type) => (
            <span key={type} className={styles.reactionDot} style={{ width: iconSize, height: iconSize }}>
              <ReactionIcon type={type} size={iconSize} />
            </span>
          ))}
        </span>
        {total.toLocaleString('vi-VN')}
      </button>
      {open ? <ReactorsDialog load={load} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
