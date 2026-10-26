'use client';

import type {
  SocialFeedPage,
  SocialMe,
  SocialPost,
  SocialTopic,
} from '@enterprise-platform/contracts-social';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import extras from '../post-extras.module.scss';
import { errorMessage, loadMe, loadTopics } from '../social-api';
import { useSocialSession } from '../social-context';
import { mergePages, replacePost } from '../social.model';
import styles from '../social.module.scss';
import { ComposerDialog } from './composer-dialog';
import { BookmarkDialog } from './library/bookmark-dialog';
import { PostCard } from './post-card';

export interface PostListActions {
  /** Thay bài trong danh sách bằng bản mới. */
  readonly update: (post: SocialPost) => void;
  /** Bỏ bài khỏi danh sách. */
  readonly remove: (postId: string) => void;
  /** Mở hộp thoại sửa bài. */
  readonly edit: (post: SocialPost) => void;
  readonly fail: (message: string) => void;
  readonly me: SocialMe;
}

export interface PostListProps {
  /** Đổi hàm này (đổi tab) thì danh sách tải lại; nên bọc `useCallback`. */
  readonly fetchPage: (cursor?: string) => Promise<SocialFeedPage>;
  readonly emptyTitle: string;
  readonly emptyHint?: string;
  /** Khối thao tác dưới mỗi thẻ bài. */
  readonly renderActions?: (
    post: SocialPost,
    actions: PostListActions,
  ) => ReactNode;
  /** Bỏ bài khi nó không còn thuộc danh sách này (ví dụ bỏ lưu trong Đã lưu). */
  readonly keep?: (post: SocialPost) => boolean;
  /** Báo cho nơi cha khi số lượng đổi (cập nhật chấm số). */
  readonly onCountChange?: (count: number) => void;
  /**
   * Chế độ thư mục đã lưu: bấm Lưu bài mở hộp thoại chọn thư mục (thay vì bật/tắt ngay). Gọi sau khi lưu hoặc bỏ lưu
   * xong để nơi cha tải lại số bài của từng thư mục.
   */
  readonly onBookmarkChanged?: () => void;
  readonly bookmarkFolders?: boolean;
}

/** Danh sách bài có phân trang cho các màn Đã lưu, Chờ duyệt, Hẹn giờ. */
export function PostList({
  fetchPage,
  emptyTitle,
  emptyHint,
  renderActions,
  keep,
  onCountChange,
  bookmarkFolders = false,
  onBookmarkChanged,
}: PostListProps) {
  const session = useSocialSession();
  const [ownMe, setMe] = useState<SocialMe>();
  const me = session?.me ?? ownMe;
  const [items, setItems] = useState<readonly SocialPost[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [topics, setTopics] = useState<readonly SocialTopic[]>([]);
  const [editing, setEditing] = useState<SocialPost>();
  const [bookmarking, setBookmarking] = useState<SocialPost>();

  useEffect(() => {
    if (session) return;
    let alive = true;
    loadMe()
      .then((value) => alive && setMe(value))
      .catch(
        (cause) =>
          alive &&
          setError(errorMessage(cause, 'Không tải được thông tin tài khoản.')),
      );
    return () => {
      alive = false;
    };
  }, [session]);

  const load = useCallback(
    async (next?: string) => {
      setLoading(true);
      try {
        const page = await fetchPage(next);
        setItems((current) =>
          next ? mergePages(current, page.items) : page.items,
        );
        setCursor(page.nextCursor);
        setError(undefined);
      } catch (cause) {
        setError(errorMessage(cause, 'Không tải được danh sách bài viết.'));
      } finally {
        setLoading(false);
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    setItems([]);
    void load();
  }, [load]);

  useEffect(() => {
    onCountChange?.(items.length);
  }, [items.length, onCountChange]);

  const update = useCallback(
    (post: SocialPost) => {
      setItems((current) =>
        keep && !keep(post)
          ? current.filter((item) => item.id !== post.id)
          : replacePost(current, post),
      );
    },
    [keep],
  );
  const remove = useCallback(
    (postId: string) =>
      setItems((current) => current.filter((item) => item.id !== postId)),
    [],
  );

  const edit = (post: SocialPost) => {
    setEditing(post);
    if (!session && topics.length === 0)
      loadTopics()
        .then(setTopics)
        .catch(() => undefined);
  };

  if (!me) {
    return error ? (
      <p role="alert" className={styles.alert}>
        {error}
      </p>
    ) : (
      <p className={styles.muted}>Đang tải…</p>
    );
  }

  const actions: PostListActions = { update, remove, edit, fail: setToast, me };

  return (
    <div className={extras.view}>
      {toast ? (
        <p role="alert" className={styles.alert}>
          <span>{toast}</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setToast(undefined)}
          >
            Đóng
          </button>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.alert}>
          <span>{error}</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => void load()}
          >
            Thử lại
          </button>
        </p>
      ) : null}

      {items.map((post) => (
        <div key={post.id} className={extras.listItem}>
          <PostCard
            post={post}
            me={me}
            onChange={update}
            onEdit={edit}
            onDeleted={remove}
            onOpenTopic={() => undefined}
            onError={setToast}
            onPickBookmarkFolder={bookmarkFolders ? setBookmarking : undefined}
          />
          {renderActions ? renderActions(post, actions) : null}
        </div>
      ))}

      {loading && items.length === 0 ? (
        <p className={styles.muted}>Đang tải…</p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <div className={styles.stateBox}>
          <p>
            <strong>{emptyTitle}</strong>
          </p>
          {emptyHint ? <p>{emptyHint}</p> : null}
        </div>
      ) : null}
      {cursor ? (
        <button
          type="button"
          className={`${styles.buttonGhost} ${extras.loadMore}`}
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          {loading ? 'Đang tải…' : 'Xem thêm'}
        </button>
      ) : null}

      {bookmarking ? (
        <BookmarkDialog
          post={bookmarking}
          onClose={() => setBookmarking(undefined)}
          onDone={(next) => {
            setBookmarking(undefined);
            update(next);
            onBookmarkChanged?.();
          }}
        />
      ) : null}

      {editing ? (
        <ComposerDialog
          me={me}
          topics={session?.topics ?? topics}
          editing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={(saved) => {
            setEditing(undefined);
            // Sửa bài bị từ chối thì bài sang chờ duyệt: `keep` quyết định còn ở danh sách này không.
            update(saved);
          }}
        />
      ) : null}
    </div>
  );
}
