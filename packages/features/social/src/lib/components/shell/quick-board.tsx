'use client';

import type { SocialPost, SocialUserRef } from '@enterprise-platform/contracts-social';
import { Bookmark, FileText, Megaphone, Pin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { loadReactors, loadScopedFeed } from '../../social-api';
import { onReactionChanged } from '../../reaction-events';
import { formatFullTime, formatRelativeTime, postHeadline, postTopics } from '../../social.model';
import { SocialLink } from '../../social-navigation';
import styles from '../../social-shell.module.scss';
import { UserAvatar } from '../user-avatar';
import { MyGroupsCard } from './my-groups';
import { BirthdayWidget } from '../widgets/birthday-widget';

/** Số thông báo và số bài đã lưu tối đa hiện ở bảng nhanh. */
const NOTICE_LIMIT = 4;
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
    <section className={`${styles.panel} ${styles.panelSaved}`} aria-label={label}>
      <header className={styles.panelHead}>
        <Icon size={17} aria-hidden="true" />
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
              <FileText size={13} aria-hidden="true" />
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

// Thông báo của Tường công ty, bài ghim đứng đầu rồi đến bài mới nhất (bài thông báo chưa ghim vẫn được lấy).
const loadAnnouncements = () => loadScopedFeed({ source: 'wall', kind: 'announcement' }, { limit: NOTICE_LIMIT });
const loadSaved = () => loadScopedFeed({ bookmarked: true }, { limit: SAVED_LIMIT });

/** Số ảnh người thả cảm xúc hiện dưới mỗi thông báo; còn lại gộp thành "+N". */
const REACTOR_AVATARS = 5;

/** Ảnh những người đã thả cảm xúc cho bài (không có ai thì không hiện gì); rê chuột vào ảnh để xem hồ sơ rút gọn. */
function NoticeReactors({ postId, initialTotal }: { readonly postId: string; readonly initialTotal: number }) {
  const [users, setUsers] = useState<readonly SocialUserRef[]>([]);
  // Chỉ quyết định có tải lần đầu hay không; lần sau tải theo sự kiện.
  const initialTotalRef = useRef(initialTotal);

  useEffect(() => {
    let cancelled = false;
    // Số lần tải mới nhất mới được ghi vào, tránh kết quả cũ về muộn đè kết quả mới.
    let latest = 0;
    const load = () => {
      const ticket = ++latest;
      loadReactors(postId)
        .then((items) => {
          if (cancelled || ticket !== latest) return;
          const seen = new Set<string>();
          setUsers(items.map((item) => item.user).filter((user) => !seen.has(user.id) && seen.add(user.id)));
        })
        .catch(() => undefined);
    };
    if (initialTotalRef.current > 0) load();
    // Ai đó thả hoặc bỏ phản ứng cho bài này (ở bảng tin, tường, chi tiết bài...) thì tải lại ngay.
    const off = onReactionChanged((changedId) => {
      if (changedId === postId) load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [postId]);

  if (users.length === 0) return null;
  const shown = users.slice(0, REACTOR_AVATARS);
  const rest = users.length - shown.length;
  return (
    <span className={styles.noticeReactors} aria-label={`${users.length} người đã thả cảm xúc`}>
      {shown.map((user) => (
        <UserAvatar key={user.id} user={user} size={24} className={styles.noticeReactor} />
      ))}
      {rest > 0 ? <span className={styles.noticeReactorMore}>+{rest}</span> : null}
    </span>
  );
}

/** "Thông báo công ty": các bài thông báo (ghim trước), mỗi dòng có ảnh người đăng, tiêu đề, thời gian và chuyên mục. */
function CompanyNotices({ refreshKey }: { readonly refreshKey: number }) {
  const items = useBoardPosts(loadAnnouncements, refreshKey);
  const notices = items?.slice(0, NOTICE_LIMIT);
  if (!notices || notices.length === 0) return null;
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
        {notices.map((post) => {
          const topicNames = postTopics(post).map((topic) => topic.name);
          return (
            <li key={post.id} className={styles.noticeItem}>
              <UserAvatar user={post.author} size={36} className={styles.noticeAuthor} />
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
                <NoticeReactors postId={post.id} initialTotal={post.reactionTotal} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SavedRecent({ refreshKey }: { readonly refreshKey: number }) {
  const items = useBoardPosts(loadSaved, refreshKey);
  const recent = items?.slice(0, SAVED_LIMIT);
  if (!recent || recent.length === 0) return null;
  return <HeadlinePanel label="Bài đã lưu gần đây" items={recent} icon="bookmark" moreLabel="Xem tất cả" />;
}

/** Cột phải "bảng nhanh": sinh nhật, thông báo công ty, nhóm của bạn. */
export function QuickBoard({ refreshKey }: { readonly refreshKey: number }) {
  return (
    <aside className={styles.rail} aria-label="Bảng nhanh">
      <BirthdayWidget />
      <CompanyNotices refreshKey={refreshKey} />
      <MyGroupsCard />
    </aside>
  );
}
