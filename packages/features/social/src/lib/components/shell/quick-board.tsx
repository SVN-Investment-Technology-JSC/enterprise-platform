'use client';

import type { SocialPost, SocialUserRef } from '@enterprise-platform/contracts-social';
import { Bookmark, Megaphone, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadReactors, loadScopedFeed } from '../../social-api';
import { formatFullTime, formatRelativeTime, postHeadline, postTopics } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { PersonHover } from '../person-card';
import { Avatar } from '../ui';
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

/** Số ảnh người thả cảm xúc hiện dưới mỗi thông báo; còn lại gộp thành "+N". */
const REACTOR_AVATARS = 5;

/** Ảnh những người đã thả cảm xúc cho bài (không có ai thì không hiện gì); rê chuột vào ảnh để xem hồ sơ rút gọn. */
function NoticeReactors({ postId }: { readonly postId: string }) {
  const [users, setUsers] = useState<readonly SocialUserRef[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadReactors(postId)
      .then((items) => {
        if (cancelled) return;
        const seen = new Set<string>();
        setUsers(items.map((item) => item.user).filter((user) => !seen.has(user.id) && seen.add(user.id)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (users.length === 0) return null;
  const shown = users.slice(0, REACTOR_AVATARS);
  const rest = users.length - shown.length;
  return (
    <span className={styles.noticeReactors} aria-label={`${users.length} người đã thả cảm xúc`}>
      {shown.map((user) => (
        <PersonHover key={user.id} userId={user.id} name={user.name} label={user.name} className={styles.noticeReactor}>
          <Avatar user={user} size={24} />
        </PersonHover>
      ))}
      {rest > 0 ? <span className={styles.noticeReactorMore}>+{rest}</span> : null}
    </span>
  );
}

/** "Thông báo công ty": các thông báo đã ghim, mỗi dòng có ảnh người đăng, tiêu đề, thời gian và chuyên mục. */
function CompanyNotices({ refreshKey }: { readonly refreshKey: number }) {
  const items = useBoardPosts(loadAnnouncements, refreshKey);
  const pinned = items?.filter((post) => post.pinned).slice(0, PINNED_LIMIT);
  if (!pinned || pinned.length === 0) return null;
  return (
    <section className={`${styles.panel} ${styles.noticePanel}`} aria-label="Thông báo công ty">
      <header className={styles.noticeHead}>
        <Megaphone size={18} aria-hidden="true" />
        <h2>Thông báo công ty</h2>
        <SocialLink className={styles.panelLink} to={{ name: 'wall', announcementsOnly: true }}>
          Xem tất cả
        </SocialLink>
      </header>
      <ul className={styles.noticeList}>
        {pinned.map((post) => {
          const topicNames = postTopics(post).map((topic) => topic.name);
          return (
            <li key={post.id} className={styles.noticeItem}>
              <Avatar user={post.author} size={36} />
              <div className={styles.noticeText}>
                <SocialLink className={styles.noticeTitle} to={{ name: 'post', postId: post.id }}>
                  {postHeadline(post)}
                </SocialLink>
                <span className={styles.noticeMeta}>
                  <time dateTime={post.publishedAt} title={formatRelativeTime(post.publishedAt)}>
                    {formatFullTime(post.publishedAt)}
                  </time>
                  {/* Nhiều chuyên mục mà hết chỗ thì cắt bằng "…"; rê chuột xem đủ. */}
                  {topicNames.length > 0 ? (
                    <span className={styles.noticeTopic} title={topicNames.join(', ')}>
                      {topicNames.join(', ')}
                    </span>
                  ) : null}
                </span>
                {post.reactionTotal > 0 ? <NoticeReactors postId={post.id} /> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SavedRecent({ refreshKey }: { readonly refreshKey: number }) {
  const items = useBoardPosts(loadSaved, refreshKey);
  const recent = items?.slice(0, SAVED_LIMIT);
  if (!recent || recent.length === 0) return null;
  return <HeadlinePanel label="Bài đã lưu gần đây" items={recent} icon="bookmark" moreLabel="Xem tất cả" />;
}

/** Cột phải "bảng nhanh": sinh nhật, thông báo công ty (đã ghim), bài đã lưu gần đây. */
export function QuickBoard({ refreshKey }: { readonly refreshKey: number }) {
  return (
    <aside className={styles.rail} aria-label="Bảng nhanh">
      <BirthdayWidget />
      <CompanyNotices refreshKey={refreshKey} />
      <SavedRecent refreshKey={refreshKey} />
    </aside>
  );
}
