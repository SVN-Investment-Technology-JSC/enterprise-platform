'use client';

import type { SocialPost } from '@enterprise-platform/contracts-social';
import { Bookmark, ClipboardCheck, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadScopedFeed } from '../../social-api';
import { postHeadline } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { BirthdayWidget } from '../widgets/birthday-widget';

/** Số thông báo ghim và số bài đã lưu tối đa hiện ở bảng nhanh. */
const PINNED_LIMIT = 4;
const SAVED_LIMIT = 4;

interface HeadlineListProps {
  readonly label: string;
  readonly items: readonly SocialPost[];
  readonly icon: 'pin' | 'bookmark';
  readonly moreLabel?: string;
}

function HeadlinePanel({ label, items, icon, moreLabel }: HeadlineListProps) {
  const Icon = icon === 'pin' ? Pin : Bookmark;
  return (
    <section className={styles.panel} aria-label={label}>
      <header className={styles.panelHead}>
        <h2>{label}</h2>
        {moreLabel ? (
          <SocialLink className={styles.panelLink} to={{ name: 'saved' }}>
            {moreLabel}
          </SocialLink>
        ) : null}
      </header>
      <ul className={styles.pinnedList}>
        {items.map((post) => (
          <li key={post.id}>
            <SocialLink to={{ name: 'post', postId: post.id }}>
              <Icon size={13} aria-hidden="true" />
              <span>{postHeadline(post)}</span>
            </SocialLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Nạp một danh sách bài ngắn cho cột phải; lỗi hoặc rỗng thì trả mảng rỗng (khối tự ẩn). */
function useBoardPosts(
  load: () => Promise<{ readonly items: readonly SocialPost[] }>,
  refreshKey: number,
): readonly SocialPost[] | undefined {
  const [items, setItems] = useState<readonly SocialPost[]>();
  useEffect(() => {
    let cancelled = false;
    load()
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [load, refreshKey]);
  return items;
}

// Bài ghim đứng đầu trang đầu của Tường công ty; lấy một trang thông báo rồi giữ bài đã ghim.
const loadAnnouncements = () => loadScopedFeed({ source: 'wall', kind: 'announcement' }, { limit: 20 });
const loadSaved = () => loadScopedFeed({ bookmarked: true }, { limit: SAVED_LIMIT });

function PinnedAnnouncements({ refreshKey }: { readonly refreshKey: number }) {
  const items = useBoardPosts(loadAnnouncements, refreshKey);
  const pinned = items?.filter((post) => post.pinned).slice(0, PINNED_LIMIT);
  if (!pinned || pinned.length === 0) return null;
  return <HeadlinePanel label="Thông báo đã ghim" items={pinned} icon="pin" />;
}

function SavedRecent({ refreshKey }: { readonly refreshKey: number }) {
  const items = useBoardPosts(loadSaved, refreshKey);
  const recent = items?.slice(0, SAVED_LIMIT);
  if (!recent || recent.length === 0) return null;
  return <HeadlinePanel label="Bài đã lưu gần đây" items={recent} icon="bookmark" moreLabel="Xem tất cả" />;
}

/** Chỉ moderator có `toModerate` > 0 mới thấy; dẫn tới trang Chờ duyệt. */
function ToModerate({ count }: { readonly count: number }) {
  if (count <= 0) return null;
  return (
    <section className={styles.panel} aria-label="Chờ xử lý">
      <header className={styles.panelHead}>
        <h2>Chờ xử lý</h2>
      </header>
      <SocialLink className={styles.todoLink} to={{ name: 'pending' }}>
        <ClipboardCheck size={15} aria-hidden="true" />
        <span className={styles.groupName}>Bài chờ duyệt</span>
        <span className={styles.pillBadge}>{count.toLocaleString('vi-VN')}</span>
      </SocialLink>
    </section>
  );
}

/** Cột phải "bảng nhanh": sinh nhật, thông báo đã ghim, chờ xử lý (moderator), bài đã lưu gần đây. */
export function QuickBoard({ refreshKey, toModerate }: { readonly refreshKey: number; readonly toModerate: number }) {
  return (
    <aside className={styles.rail} aria-label="Bảng nhanh">
      <BirthdayWidget />
      <PinnedAnnouncements refreshKey={refreshKey} />
      <ToModerate count={toModerate} />
      <SavedRecent refreshKey={refreshKey} />
    </aside>
  );
}
