'use client';

import {
  SOCIAL_REACTION_LABELS,
  SOCIAL_REACTION_TYPES,
  type SocialReactionType,
  type SocialReactor,
} from '@enterprise-platform/contracts-social';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../social-api';
import styles from '../social.module.scss';
import { Avatar, Dialog, REACTION_ICONS, userSubtitle } from './ui';

/**
 * Hộp thoại "Người đã bày tỏ phản ứng", dùng chung cho bài viết và bình luận: thẻ lọc theo loại
 * (chỉ biểu tượng và số), danh sách người, chiều cao cố định.
 */
export function ReactorsDialog({
  load,
  onClose,
}: {
  /** Tải danh sách người phản ứng của bài hoặc bình luận đang xem. */
  readonly load: () => Promise<readonly SocialReactor[]>;
  readonly onClose: () => void;
}) {
  const [items, setItems] = useState<readonly SocialReactor[]>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<'all' | SocialReactionType>('all');

  useEffect(() => {
    load()
      .then(setItems)
      .catch((cause) =>
        setError(
          errorMessage(cause, 'Không tải được danh sách người phản ứng.'),
        ),
      );
    // Chỉ tải một lần khi mở hộp thoại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chỉ hiện thẻ lọc cho loại phản ứng đang có người chọn.
  const counts = useMemo(() => {
    const result: Partial<Record<SocialReactionType, number>> = {};
    for (const item of items ?? []) result[item.type] = (result[item.type] ?? 0) + 1;
    return result;
  }, [items]);
  const presentTypes = SOCIAL_REACTION_TYPES.filter((type) => counts[type]);
  const visible =
    filter === 'all' ? items : items?.filter((item) => item.type === filter);

  return (
    <Dialog
      open
      title="Người đã bày tỏ phản ứng"
      error={error}
      onClose={onClose}
    >
      <div className={styles.reactorBody}>
      {!items && !error ? <p className={styles.muted}>Đang tải…</p> : null}
      {items && items.length === 0 ? (
        <p className={styles.muted}>Chưa có phản ứng nào.</p>
      ) : null}
      {items && items.length > 0 ? (
        <div className={styles.reactorTabs} role="tablist" aria-label="Lọc theo phản ứng">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={styles.reactorTab}
            onClick={() => setFilter('all')}
          >
            Tất cả
            <span className={styles.reactorTabCount}>{items.length}</span>
          </button>
          {presentTypes.map((type) => {
            const TabIcon = REACTION_ICONS[type];
            return (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={filter === type}
                aria-label={`${SOCIAL_REACTION_LABELS[type]}: ${counts[type]}`}
                title={SOCIAL_REACTION_LABELS[type]}
                data-type={type}
                className={styles.reactorTab}
                onClick={() => setFilter(type)}
              >
                <TabIcon size={18} aria-hidden="true" />
                <span className={styles.reactorTabCount}>{counts[type]}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {visible && visible.length > 0 ? (
        <ul className={styles.reactorList}>
          {visible.map((item) => {
            const Icon = REACTION_ICONS[item.type];
            return (
              <li
                key={`${item.user.id}-${item.type}`}
                className={styles.reactor}
              >
                <Avatar user={item.user} size={32} />
                <span className={styles.suggestText}>
                  <span className={styles.suggestName}>{item.user.name}</span>
                  {userSubtitle(item.user) ? (
                    <span className={styles.suggestMeta}>
                      {userSubtitle(item.user)}
                    </span>
                  ) : null}
                </span>
                <span
                  className={styles.reactorType}
                  data-type={item.type}
                  title={SOCIAL_REACTION_LABELS[item.type]}
                >
                  <Icon size={14} />
                  {SOCIAL_REACTION_LABELS[item.type]}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      </div>
    </Dialog>
  );
}
