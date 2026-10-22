'use client';

import {
  SOCIAL_FEED_PAGE_SIZE,
  type SocialFeedSignal,
  type SocialMe,
  type SocialPost,
} from '@enterprise-platform/contracts-social';
import { useRealtimeEvent } from '@enterprise-platform/shared-ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, loadMe, loadScopedFeed } from '../../social-api';
import { useSocialSession } from '../../social-context';
import { mergePages, replacePost, type SocialFeedScope } from '../../social.model';
import styles from '../../social.module.scss';
import { PostCard } from '../post-card';

export type { SocialFeedScope } from '../../social.model';

export interface SocialFeedProps {
  readonly scope?: SocialFeedScope;
  /** Chữ khi danh sách rỗng; mặc định theo phạm vi. */
  readonly emptyText?: string;
  /** Bỏ một bài khỏi danh sách (bài đang được mở riêng ở trên). */
  readonly excludePostId?: string;
}

function defaultEmptyText(scope: SocialFeedScope): string {
  if (scope.bookmarked) return 'Bạn chưa lưu bài viết nào.';
  if (scope.groupId) return 'Nhóm này chưa có bài viết nào.';
  if (scope.authorId) return 'Chưa có bài viết nào.';
  if (scope.topicId) return 'Chuyên mục này chưa có bài viết.';
  if (scope.kind === 'announcement') return 'Chưa có thông báo nào.';
  return 'Chưa có bài viết nào.';
}

/**
 * Danh sách bài theo phạm vi, cuộn vô hạn. Dùng `GET /feed` (hoặc `GET /bookmarks` khi `bookmarked`).
 * Cần `SocialSessionContext` do `SocialScreen` cung cấp để có người dùng, hộp soạn bài và báo lỗi;
 * dùng ngoài màn hình đó thì tự tải thông tin người dùng và không sửa được bài.
 */
export function SocialFeed({ scope = {}, emptyText, excludePostId }: SocialFeedProps) {
  const session = useSocialSession();
  const [ownMe, setOwnMe] = useState<SocialMe>();
  const [ownNotice, setOwnNotice] = useState<string>();
  useEffect(() => {
    if (session) return;
    loadMe()
      .then(setOwnMe)
      .catch((cause) => setOwnNotice(errorMessage(cause, 'Không tải được thông tin Mạng nội bộ.')));
  }, [session]);
  const me = session?.me ?? ownMe;
  const ready = Boolean(me);

  const { groupId, groupTopicId, authorId, topicId, kind, bookmarked, source } = scope;
  const activeScope = useMemo<SocialFeedScope>(
    () => ({ groupId, groupTopicId, authorId, topicId, kind, bookmarked, source }),
    [groupId, groupTopicId, authorId, topicId, kind, bookmarked, source],
  );

  const [posts, setPosts] = useState<readonly SocialPost[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [moreError, setMoreError] = useState<string>();
  /** Số bài mới người khác vừa đăng (từ `social.feed.changed`); không tự chèn, chờ người dùng bấm. */
  const [freshCount, setFreshCount] = useState(0);
  /** Mỗi lần nạp lại tăng một bậc để bỏ kết quả của lần nạp cũ. */
  const generation = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const notify = session?.notify;

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    setError(undefined);
    setMoreError(undefined);
    setFreshCount(0);
    try {
      const page = await loadScopedFeed(activeScope, { limit: SOCIAL_FEED_PAGE_SIZE });
      if (mine !== generation.current) return;
      setPosts(page.items);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (mine !== generation.current) return;
      setPosts([]);
      setCursor(undefined);
      setError(errorMessage(cause, 'Không tải được bài viết.'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [activeScope]);

  useEffect(() => {
    if (ready) void reload();
  }, [ready, reload]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await loadScopedFeed(activeScope, { limit: SOCIAL_FEED_PAGE_SIZE, cursor });
      if (mine !== generation.current) return;
      setPosts((list) => mergePages(list, page.items));
      setCursor(page.nextCursor);
    } catch (cause) {
      if (mine === generation.current) setMoreError(errorMessage(cause, 'Không tải thêm được bài viết.'));
    } finally {
      setLoadingMore(false);
    }
  }, [activeScope, cursor, loading, loadingMore]);

  // Cuộn gần đáy thì nạp trang kế tiếp. Lỗi tải thêm dừng tự nạp; bấm "Thử lại" để nạp tiếp.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !cursor || moreError || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [cursor, loadMore, moreError]);

  useRealtimeEvent('social.feed.changed', (event) => {
    const signal = event.data as Partial<SocialFeedSignal> | undefined;
    if (!signal || signal.change !== 'post.created' || !me || signal.actorUserId === me.user.id) return;
    if (activeScope.bookmarked) return;
    if (activeScope.groupId) {
      if (signal.groupId !== activeScope.groupId) return;
    } else {
      const feedSource = activeScope.source ?? (activeScope.authorId ? 'all' : 'wall');
      if (feedSource === 'wall' && signal.groupId) return;
      if (feedSource === 'groups' && !signal.groupId) return;
      if (activeScope.authorId && signal.actorUserId !== activeScope.authorId) return;
    }
    setFreshCount((count) => count + 1);
  });

  // Bài vừa soạn/sửa xong từ hộp thoại của màn hình: sửa thì thay tại chỗ, đăng mới thì nạp lại.
  const saved = session?.saved;
  const lastSeq = useRef(saved?.seq);
  useEffect(() => {
    if (!saved || saved.seq === lastSeq.current) return;
    lastSeq.current = saved.seq;
    if (saved.edited) {
      // Bài chờ duyệt/hẹn giờ/bị từ chối không thuộc bảng tin công khai: bỏ khỏi danh sách thay vì thay thế.
      setPosts((list) =>
        (saved.post.status ?? 'published') === 'published'
          ? replacePost(list, saved.post)
          : list.filter((item) => item.id !== saved.post.id),
      );
    } else void reload();
  }, [saved, reload]);

  if (!me) {
    return ownNotice ? (
      <p role="alert" className={styles.alert}>
        {ownNotice}
      </p>
    ) : (
      <div className={styles.skeletons} aria-busy="true" aria-label="Đang tải">
        <div className={styles.skeleton} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.skeletons} aria-busy="true" aria-label="Đang tải bài viết">
        {[0, 1, 2].map((key) => (
          <div key={key} className={styles.skeleton} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.stateBox} role="alert">
        <p>{error}</p>
        <button type="button" className={styles.buttonGhost} onClick={() => void reload()}>
          Thử lại
        </button>
      </div>
    );
  }

  const freshBanner =
    freshCount > 0 ? (
      <button type="button" className={styles.freshButton} onClick={() => void reload()}>
        {freshCount === 1 ? 'Có bài mới' : `Có ${freshCount} bài mới`}, bấm để xem
      </button>
    ) : null;

  if (posts.length === 0) {
    return (
      <>
        {freshBanner}
        <div className={styles.stateBox}>
          <p>{emptyText ?? defaultEmptyText(activeScope)}</p>
        </div>
      </>
    );
  }

  return (
    <div className={styles.feed}>
      {freshBanner}
      {posts
        .filter((post) => post.id !== excludePostId)
        .map((post) => (
        <PostCard
          key={post.id}
          post={post}
          me={me}
          onChange={(next) => setPosts((list) => replacePost(list, next))}
          onEdit={(target) => session?.openComposer(target)}
          onDeleted={(id) => setPosts((list) => list.filter((item) => item.id !== id))}
          onOpenTopic={(topicId) => session?.openTopic(topicId)}
          onError={(message) => (notify ? notify(message) : setOwnNotice(message))}
        />
      ))}
      <div ref={sentinel} className={styles.sentinel} />
      {loadingMore ? <p className={styles.muted}>Đang tải thêm…</p> : null}
      {moreError ? (
        <div className={styles.stateBox} role="alert">
          <p>{moreError}</p>
          <button type="button" className={styles.buttonGhost} onClick={() => void loadMore()}>
            Thử lại
          </button>
        </div>
      ) : null}
      {!cursor && !moreError ? <p className={styles.feedEnd}>Đã xem hết bài viết.</p> : null}
    </div>
  );
}
